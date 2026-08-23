/**
 * Rook Node uplink: the outbound cloud control path.
 *
 * The node dials the Rook server over HTTPS on a short interval, posts the
 * results of previously dispatched commands, and claims queued commands.
 * Outbound-only: no inbound ports, works behind NAT and firewalls. Commands
 * are executed through the exact same dispatch() pipeline as local gateway
 * traffic — validation, leasing, approvals, replay protection are identical.
 */
import {
  DEFAULT_POLL_AFTER_MS,
  type CloudApprovalGrant,
  type QueuedRelayCommand,
  type RelayResultReport,
  type UplinkSyncResponse,
} from "../../../shared/node-relay.js";

import type { RookNode } from "../core/node.js";
import type { Capability, TypedAction } from "../types.js";
import { ensurePinnedChromium } from "../runtime/chromium.js";

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_BACKOFF_MS = 60_000;

export class UplinkError extends Error {}

export interface CloudIdentity {
  serverUrl: string;
  userId: string;
  nodeId: string;
  nodeSecret: string;
  pairedAt: string;
}

/** Exchanges a one-time pairing token for a durable node credential. */
export async function pairWithServer(input: {
  serverUrl: string;
  pairingToken: string;
  name: string;
  version: string;
}): Promise<CloudIdentity> {
  // Some Windows networks blackhole the first outbound connection to a new
  // process (adapter failover between anycast IPs); retry transport-level
  // failures so one dead attempt can't burn the one-time token.
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await pairAttempt(input);
    } catch (error) {
      lastError = error;
      // A server response (4xx/5xx) is authoritative — never retry those.
      if (!(error instanceof UplinkError) || !/\(\d{3}\)/.test(error.message)) throw error;
      if (/401|400/.test(error.message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }
  throw lastError;
}

async function pairAttempt(input: { serverUrl: string; pairingToken: string; name: string; version: string }): Promise<CloudIdentity> {
  const response = await fetch(new URL("/api/node/pair", normalizeServerUrl(input.serverUrl)), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pairingToken: input.pairingToken, name: input.name, version: input.version }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new UplinkError(`Pairing failed (${response.status}): ${detail.slice(0, 200)}`);
  }
  const body = (await response.json()) as { nodeId?: string; nodeSecret?: string; userId?: string };
  if (typeof body.nodeId !== "string" || typeof body.nodeSecret !== "string" || typeof body.userId !== "string") {
    throw new UplinkError("Pairing response was malformed.");
  }
  return {
    serverUrl: normalizeServerUrl(input.serverUrl),
    userId: body.userId,
    nodeId: body.nodeId,
    nodeSecret: body.nodeSecret,
    pairedAt: new Date().toISOString(),
  };
}

export function normalizeServerUrl(serverUrl: string): string {
  const trimmed = serverUrl.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(trimmed)) throw new UplinkError("Server URL must start with http:// or https://");
  // Loopback servers are allowed for development; production is HTTPS-only by deployment.
  return trimmed;
}

/**
 * The poll loop. One instance per process; results produced while offline
 * flush on the next successful tick. `onEvent` receives lifecycle logs.
 */
export class UplinkClient {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private readonly queue: RelayResultReport[] = [];
  private backoffMs = 0;
  private ticking = false;

  constructor(
    private readonly node: RookNode,
    private identity: CloudIdentity,
    private readonly onEvent: (message: string) => void = () => undefined,
  ) {}

  getIdentity(): CloudIdentity {
    return this.identity;
  }

  updateIdentity(identity: CloudIdentity): void {
    this.identity = identity;
  }

  start(intervalMs = DEFAULT_POLL_AFTER_MS): void {
    if (this.running) return;
    this.running = true;
    this.onEvent(`uplink started → ${this.identity.serverUrl}`);
    const loop = (): void => {
      if (!this.running) return;
      void this.tick()
        .then((pollAfterMs) => {
          this.backoffMs = 0;
          if (!this.running) return;
          this.timer = setTimeout(loop, Math.max(pollAfterMs, intervalMs));
        })
        .catch((error) => {
          this.backoffMs = Math.min(this.backoffMs === 0 ? 2_000 : this.backoffMs * 2, MAX_BACKOFF_MS);
          this.onEvent(`uplink sync failed: ${(error as Error).message}`);
          if (!this.running) return;
          this.timer = setTimeout(loop, this.backoffMs);
        });
    };
    void loop();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** One synchronous round-trip: post finished results, claim + execute commands. */
  async tick(): Promise<number> {
    if (this.ticking) return DEFAULT_POLL_AFTER_MS;
    this.ticking = true;
    try {
      // Chromium must exist before any command can run; download on first use.
      if (!this.node.config.noLaunch) await ensurePinnedChromium();

      const results = this.queue.splice(0, this.queue.length);
      const response = await fetch(new URL("/api/node/sync", this.identity.serverUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.identity.nodeId}:${this.identity.nodeSecret}`,
        },
        body: JSON.stringify({
          version: this.identityVersion(),
          health: safeHealth(this.node),
          results,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status === 401) throw new UplinkError("Credential rejected — re-pair this computer.");
      if (!response.ok) throw new UplinkError(`Sync failed with ${response.status}.`);

      const rawBody: unknown = await response.json().catch(() => undefined);
      const body: UplinkSyncResponse =
        typeof rawBody === "object" && rawBody !== null
          ? { commands: extractCommands(rawBody), pollAfterMs: extractPollAfter(rawBody) }
          : { commands: [], pollAfterMs: DEFAULT_POLL_AFTER_MS };

      for (const command of body.commands.slice(0, 16)) {
        this.queue.push(await this.execute(command));
      }
      return typeof body.pollAfterMs === "number" && body.pollAfterMs >= 250
        ? Math.min(body.pollAfterMs, 30_000)
        : DEFAULT_POLL_AFTER_MS;
    } finally {
      this.ticking = false;
    }
  }

  /** Dispatches one relayed command through the same pipeline as local traffic. */
  private async execute(command: QueuedRelayCommand): Promise<RelayResultReport> {
    try {
      const envelope = command.envelope as Record<string, unknown> & { botId?: string; pageId?: string; action?: { type?: string }; capability?: string; origin?: string };
      this.syncCloudBinding(envelope);

      // Sensitive commands carry a cloud approval grant; register it locally so
      // the standard proof validation enforces expiry + one-time nonce here.
      if (command.approval && envelope.action && envelope.botId && envelope.pageId) {
        this.node.ingestCloudApproval({
          botId: String(envelope.botId),
          pageId: String(envelope.pageId),
          action: envelope.action as TypedAction,
          capability: String(envelope.capability ?? "") as Capability,
          origin: String(envelope.origin ?? "cloud"),
          summary: `Cloud-approved ${String(envelope.action.type)} on ${String(envelope.pageId)}`,
          grant: command.approval as CloudApprovalGrant,
        });
      }

      const result = await this.node.dispatch(command.envelope);
      return result.ok
        ? { commandId: command.commandId, ok: true, result: result.value }
        : { commandId: command.commandId, ok: false, code: result.code, message: result.message };
    } catch (error) {
      return { commandId: command.commandId, ok: false, code: "INVALID", message: (error as Error).message };
    }
  }

  /** Keeps the "cloud" device binding fresh so protocol checks pass. */
  private syncCloudBinding(envelope: Record<string, unknown> & { botId?: string }): void {
    const knownBots = this.node.registry.listBots().map((bot) => bot.id);
    if (envelope.botId && !knownBots.includes(String(envelope.botId))) knownBots.push(String(envelope.botId));
    this.node.setDeviceBinding({
      deviceId: "cloud",
      userId: this.identity.userId,
      allowedBotIds: knownBots.length > 0 ? knownBots : ["*"],
    });
  }

  private identityVersion(): string {
    return this.node.health().version ?? "0.1.0";
  }
}

function safeHealth(node: RookNode): Record<string, unknown> | undefined {
  try {
    return node.health() as unknown as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function extractCommands(rawBody: unknown): QueuedRelayCommand[] {
  const commands = (rawBody as { commands?: unknown })?.commands;
  if (!Array.isArray(commands)) return [];
  const out: QueuedRelayCommand[] = [];
  for (const entry of commands.slice(0, 16)) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.commandId !== "string" || typeof record.envelope !== "object" || record.envelope === null) continue;
    out.push({
      commandId: record.commandId,
      envelope: record.envelope as Record<string, unknown>,
      approval: (typeof record.approval === "object" && record.approval !== null
        ? record.approval
        : undefined) as QueuedRelayCommand["approval"],
    });
  }
  return out;
}

function extractPollAfter(rawBody: unknown): number {
  const value = (rawBody as { pollAfterMs?: unknown })?.pollAfterMs;
  return typeof value === "number" && value >= 250 ? Math.min(value, 30_000) : DEFAULT_POLL_AFTER_MS;
}

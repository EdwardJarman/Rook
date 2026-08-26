/**
 * Shared Rook Node relay protocol.
 *
 * Used by BOTH the Rook server (relay endpoints) and rook-node (uplink
 * client). Dependency-free so both sides and the test suites can import it.
 *
 * Transport decision: HTTPS polling queue. The web app deploys to Vercel
 * serverless functions which cannot hold long-lived WebSocket connections,
 * so the node dials OUT over HTTPS on an interval (default ~3s), picking up
 * queued commands and posting results. Outbound-only means no port
 * forwarding and NAT/firewall friendliness. A dedicated WS relay can replace
 * this transport later without changing the message shapes.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const PAIRING_TOKEN_TTL_MS = 10 * 60_000;
/** Maximum time from desktop request creation to successful code exchange. */
export const DESKTOP_PAIRING_REQUEST_TTL_MS = 10 * 60_000;
export const DESKTOP_PAIRING_MAX_ATTEMPTS = 6;
export const COMMAND_TTL_MS = 15 * 60_000;
export const APPROVAL_GRANT_TTL_MS = 5 * 60_000;
export const DEFAULT_POLL_AFTER_MS = 3_000;
/** How long a browser-pairing handshake may take from click to callback. */
export const CONNECT_STATE_TTL_MS = 15 * 60_000;

/** Normalizes a Rook server base URL (protocol required). */
export function normalizeServerUrl(serverUrl: string): string {
  const trimmed = serverUrl.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(trimmed)) throw new Error("Server URL must start with http:// or https://");
  return trimmed;
}

/** The web page that authenticates the owner and shows a one-time desktop code. */
export function buildDesktopPairingUrl(input: { serverUrl: string; requestId: string }): string {
  const url = new URL("/connect-node", normalizeServerUrl(input.serverUrl));
  url.searchParams.set("request", input.requestId);
  return url.toString();
}

/** Legacy browser callback URL builder, retained only for older Node installations. */
export function buildConnectNodeUrl(input: { serverUrl: string; state: string; port: number }): string {
  const url = new URL("/connect-node", normalizeServerUrl(input.serverUrl));
  url.searchParams.set("state", input.state);
  url.searchParams.set("port", String(input.port));
  return url.toString();
}

/** The loopback callback the browser is redirected to after pairing is minted. */
export function buildPairCallbackUrl(input: { port: number; token: string; state: string }): string {
  // 127.0.0.1, not `localhost`: the node's gateway binds only the IPv4
  // loopback. Browsers resolve `localhost` to ::1 too, and hitting [::1]
  // would fail the handoff, so point the redirect at the IPv4 loopback.
  return `http://127.0.0.1:${input.port}/pair?token=${encodeURIComponent(input.token)}&state=${encodeURIComponent(input.state)}`;
}

/** Validates the callback query the node receives from the browser redirect. */
export function parsePairCallback(query: URLSearchParams): { token: string; state: string } | undefined {
  const token = query.get("token");
  const state = query.get("state");
  if (!token || !state) return undefined;
  if (!token.startsWith("rkp-") || token.length < 8 || token.length > 120) return undefined;
  if (state.length < 16 || state.length > 128) return undefined;
  return { token, state };
}

/** Only loopback ports in the ephemeral/user range may be redirected to. */
export function validateConnectPort(port: unknown): number | undefined {
  const n =
    typeof port === "string" ? Number.parseInt(port, 10) : typeof port === "number" ? port : NaN;
  return Number.isInteger(n) && n >= 1024 && n <= 65535 ? n : undefined;
}

/** One-time pairing token shown in the app; the node exchanges it for a credential. */
export function generatePairingToken(): string {
  return `rkp-${randomBytes(24).toString("hex")}`;
}

/** Opaque identifier handed from a desktop install to the authenticated web page. */
export function generateDesktopPairingRequestId(): string {
  return `rkd-${randomBytes(24).toString("hex")}`;
}

const DESKTOP_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Eight easy-to-type characters, displayed as ABCD-EFGH. */
export function generateDesktopPairingCode(): string {
  const bytes = randomBytes(8);
  const characters = Array.from(bytes, (byte) => DESKTOP_CODE_ALPHABET[byte % DESKTOP_CODE_ALPHABET.length]);
  return `${characters.slice(0, 4).join("")}-${characters.slice(4).join("")}`;
}

/** Accept spaces and dashes but never ambiguous characters or arbitrary input. */
export function normalizeDesktopPairingCode(value: string): string | undefined {
  const normalized = value.trim().toUpperCase().replace(/[\s-]/g, "");
  if (normalized.length !== 8) return undefined;
  return [...normalized].every((character) => DESKTOP_CODE_ALPHABET.includes(character))
    ? normalized
    : undefined;
}

export function desktopPairingCodeDigest(code: string): string | undefined {
  const normalized = normalizeDesktopPairingCode(code);
  return normalized ? hashToken(`desktop-code:${normalized}`) : undefined;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token.trim()).digest("hex");
}

export function generateNodeSecret(): string {
  return `rks-${randomBytes(32).toString("hex")}`;
}

export function generateNodeId(): string {
  return `node-${randomBytes(12).toString("hex")}`;
}

export function generateCommandId(): string {
  return `cmd-${randomBytes(10).toString("hex")}`;
}

export function generateApprovalId(): string {
  return `apr-${randomBytes(10).toString("hex")}`;
}

/** Constant-time comparison of two hex digests / secrets. */
export function secretsMatch(a: string, b: string): boolean {
  const left = Buffer.from(createHash("sha256").update(a).digest("hex"));
  const right = Buffer.from(createHash("sha256").update(b).digest("hex"));
  return timingSafeEqual(left, right);
}

/** Timing-safe check of a plaintext credential against a stored sha256 hex digest. */
export function verifyStoredSecret(plaintext: string, storedDigestHex: string): boolean {
  const computed = Buffer.from(hashToken(plaintext));
  const expected = Buffer.from(storedDigestHex.trim().toLowerCase());
  if (computed.length !== expected.length) return false;
  return timingSafeEqual(computed, expected);
}

/** Parses the uplink's Authorization header: "Bearer <nodeId>:<secret>". */
export function parseUplinkAuth(header: string | undefined): { nodeId: string; secret: string } | undefined {
  if (!header?.startsWith("Bearer ")) return undefined;
  const parts = header.slice(7).split(":");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return undefined;
  return { nodeId: parts[0], secret: parts[1] };
}

/** The approval grant the cloud attaches to a sensitive command once approved. */
export type CloudApprovalGrant = {
  approvalId: string;
  nonce: string;
  expiresAt: number;
  pageRevision: number;
};

/** A command queued by the app, delivered to the node verbatim. */
export type QueuedRelayCommand = {
  commandId: string;
  /** Full CommandEnvelope as defined by the node protocol (version 1). */
  envelope: Record<string, unknown>;
  approval?: CloudApprovalGrant;
};

/** Result report posted back by the node after dispatching a command. */
export type RelayResultReport = {
  commandId: string;
  ok: boolean;
  result?: unknown;
  code?: string;
  message?: string;
};

/** Node → server sync body. */
export type UplinkSyncRequest = {
  version: string;
  health?: Record<string, unknown>;
  results: RelayResultReport[];
};

/** Server → node sync response. */
export type UplinkSyncResponse = {
  commands: QueuedRelayCommand[];
  pollAfterMs: number;
};

/** Node → server pairing body. */
export type PairRequestBody = {
  pairingToken: string;
  name: string;
  version: string;
};

/** Server → node pairing response. */
export type PairResponse = {
  nodeId: string;
  nodeSecret: string;
  /** The owning Rook account id; the node binds the "cloud" device to it. */
  userId: string;
};

/** Desktop → server request to begin a browser-login / code-entry pairing flow. */
export type DesktopPairingStartBody = { name: string; version: string };
export type DesktopPairingStartResponse = { requestId: string; expiresAt: string; connectUrl: string };

/** Desktop → server request to exchange one user-entered code for a credential. */
export type DesktopPairingCompleteBody = {
  requestId: string;
  code: string;
  name: string;
  version: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Capabilities whose actions touch real-world state and need an explicit approval. */
export const RELAY_SENSITIVE_CAPABILITIES: readonly string[] = [
  "form",
  "upload",
  "message",
  "account",
  "purchase",
  "delete",
  "security",
  "irreversible",
];

/**
 * Builds a version-1 CommandEnvelope for relay delivery. `seq` is owned by
 * the caller (the app increments it per page, exactly like the local gateway
 * contract); the node rejects replays and out-of-order sequences itself.
 */
export function buildCommandEnvelope(input: {
  userId: string;
  botId: string;
  pageId: string;
  pageRevision: number;
  capability: string;
  action: Record<string, unknown>;
  seq: number;
  ttlMs?: number;
}): Record<string, unknown> {
  const issuedAt = Date.now();
  return {
    version: 1,
    deviceId: "cloud",
    userId: input.userId,
    botId: input.botId,
    pageId: input.pageId,
    seq: input.seq,
    nonce: randomBytes(16).toString("hex"),
    issuedAt,
    deadline: issuedAt + Math.min(Math.max(input.ttlMs ?? 60_000, 5_000), 120_000),
    pageRevision: input.pageRevision,
    capability: input.capability,
    action: input.action,
  };
}

export function isSensitiveCapability(capability: string): boolean {
  return RELAY_SENSITIVE_CAPABILITIES.includes(capability);
}

/** Validates an incoming sync body without pulling zod into shared code. */
export function validateSyncRequest(body: unknown): UplinkSyncRequest | undefined {
  if (!isRecord(body)) return undefined;
  if (typeof body.version !== "string" || body.version.length === 0 || body.version.length > 32) return undefined;
  if (!Array.isArray(body.results)) return undefined;
  const results: RelayResultReport[] = [];
  for (const entry of body.results) {
    if (!isRecord(entry) || typeof entry.commandId !== "string") return undefined;
    if (typeof entry.ok !== "boolean") return undefined;
    results.push({
      commandId: entry.commandId.slice(0, 80),
      ok: entry.ok,
      result: entry.result ?? undefined,
      code: typeof entry.code === "string" ? entry.code : undefined,
      message: typeof entry.message === "string" ? entry.message.slice(0, 2000) : undefined,
    });
    if (results.length > 64) break;
  }
  return {
    version: body.version,
    health: isRecord(body.health) ? body.health : undefined,
    results,
  };
}

export function validatePairRequest(body: unknown): PairRequestBody | undefined {
  if (!isRecord(body)) return undefined;
  if (typeof body.pairingToken !== "string" || !body.pairingToken.startsWith("rkp-")) return undefined;
  if (typeof body.name !== "string" || body.name.length === 0 || body.name.length > 80) return undefined;
  if (typeof body.version !== "string" || body.version.length === 0 || body.version.length > 32) return undefined;
  return {
    pairingToken: body.pairingToken.trim().slice(0, 120),
    name: body.name.trim(),
    version: body.version,
  };
}

function pairingDevice(input: unknown): { name: string; version: string } | undefined {
  if (!isRecord(input)) return undefined;
  if (typeof input.name !== "string" || input.name.trim().length === 0 || input.name.trim().length > 80) return undefined;
  if (typeof input.version !== "string" || input.version.trim().length === 0 || input.version.trim().length > 32) return undefined;
  return { name: input.name.trim(), version: input.version.trim() };
}

export function validateDesktopPairingStart(body: unknown): DesktopPairingStartBody | undefined {
  return pairingDevice(body);
}

export function validateDesktopPairingComplete(body: unknown): DesktopPairingCompleteBody | undefined {
  const device = pairingDevice(body);
  if (!device || !isRecord(body) || typeof body.requestId !== "string" || typeof body.code !== "string") return undefined;
  if (!/^rkd-[a-f0-9]{48}$/i.test(body.requestId)) return undefined;
  const code = normalizeDesktopPairingCode(body.code);
  if (!code) return undefined;
  return { requestId: body.requestId.toLowerCase(), code, ...device };
}

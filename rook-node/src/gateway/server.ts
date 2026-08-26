/**
 * Local control gateway.
 *
 * A loopback-bound WebSocket server carrying encrypted JSON messages. Only
 * loopback/private connections are accepted; remote access is a later phase
 * and uses a separate authenticated WebRTC path, never this socket.
 *
 * Message framing:
 *   { "t": "auth",   "secret": "...", "deviceId": "..." }
 *   { "t": "command", "envelope": {...} }
 *   { "t": "takeover" } | { "t": "release" } | { "t": "pause" }
 *   { "t": "approval", "approvalId": "...", "decision": "approved"|"declined" }
 *   -> { "t": "result", "ok": true, "value": ..., "ref": "..." }
 */
import http from "node:http";
import os from "node:os";
import { randomBytes } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";

import {
  buildConnectNodeUrl,
  CONNECT_STATE_TTL_MS,
  parsePairCallback,
} from "../../../shared/node-relay.js";

import type { RookConfig } from "../config.js";
import { ROOK_NODE_VERSION } from "../config.js";
import type { RookNode } from "../core/node.js";
import { pairWithServer, type CloudIdentity } from "../uplink/uplink.js";
import type { CommandRejectCode, CommandResult } from "../types.js";

export interface GatewayEvent {
  type: "command" | "takeover" | "release" | "pause" | "approval" | "auth" | "result" | "rejected";
  botId?: string;
  ref?: string;
}

export interface GatewayHooks {
  /** Called once the browser pairing flow stores a fresh cloud identity. */
  onPaired?: (identity: CloudIdentity) => void;
}

export class Gateway {
  private readonly wss: WebSocketServer;
  private readonly http: http.Server;
  /** IPv6 loopback twin of `http`, so browsers resolving `localhost` to ::1
   * still reach the pairing endpoints. Loopback-only is preserved by
   * `isLoopbackAddress`. */
  private readonly http6: http.Server;
  private readonly clients = new Map<WebSocket, { deviceId: string; authenticated: boolean }>();
  /** state -> created at; single-use, pruned by TTL. */
  private readonly connectStates = new Map<string, number>();
  private closed = false;

  constructor(
    private readonly config: RookConfig,
    private readonly node: RookNode,
    private readonly hooks: GatewayHooks = {},
  ) {
    this.http = http.createServer((request, response) => {
      void this.onHttpRequest(request, response);
    });
    this.wss = new WebSocketServer({ noServer: true });

    this.http.on("upgrade", (request, socket, head) => this.onUpgrade(request, socket, head));
    // Second loopback listener on ::1 with the same handlers. `ipv6Only` keeps
    // it from claiming the IPv4-mapped space already used by `http`.
    this.http6 = http.createServer((request, response) => {
      void this.onHttpRequest(request, response);
    });
    this.http6.on("upgrade", (request, socket, head) => this.onUpgrade(request, socket, head));
  }

  private onUpgrade(request: http.IncomingMessage, socket: import("node:stream").Duplex, head: Buffer): void {
    const remote: string | undefined = request.socket.remoteAddress ?? undefined;
    if (!isLoopbackAddress(remote)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    this.wss.handleUpgrade(request, socket, head, (ws) => this.onConnection(ws, remote ?? ""));
  }

  /** ---- browser pairing (loopback HTTP) ---- */

  private async onHttpRequest(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const remote: string | undefined = request.socket.remoteAddress ?? undefined;
    if (!isLoopbackAddress(remote)) {
      response.writeHead(403, { "Content-Type": "text/plain" });
      response.end("Forbidden");
      return;
    }
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${this.config.gatewayPort}`);
    try {
      if (url.pathname === "/connect") {
        this.serveConnectPage(response);
        return;
      }
      if (url.pathname === "/pair") {
        await this.servePairCallback(url, response);
        return;
      }
      if (url.pathname === "/healthz") {
        // Permissive CORS is safe here (the gateway refuses non-loopback
        // connections): the desktop shell's own window polls this endpoint
        // cross-origin as a fallback when the Tauri bridge is unavailable.
        response.writeHead(200, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
        });
        response.end(JSON.stringify({ ok: true, paired: Boolean(this.node.db.getCloudIdentity()) }));
        return;
      }
      response.writeHead(404, { "Content-Type": "text/plain" });
      response.end("Not found");
    } catch (error) {
      this.html(response, 500, "Something went wrong", escapeHtml((error as Error).message));
    }
  }

  /** Local landing page with the single "Connect account" button. */
  private serveConnectPage(response: http.ServerResponse): void {
    const state = this.beginConnectState();
    const connectUrl = buildConnectNodeUrl({
      serverUrl: this.config.serverUrl,
      state,
      port: this.address().port,
    });
    this.html(
      response,
      200,
      "Connect Rook Node",
      `
      <p>This computer wants to join your Rook account.</p>
      <p class="muted">You'll sign in on ${escapeHtml(this.config.serverUrl)} and come right back.</p>
      <a class="btn" href="${escapeHtml(connectUrl)}">Connect account</a>`,
    );
  }

  /** The redirect target after the web app mints a pairing token. */
  private async servePairCallback(url: URL, response: http.ServerResponse): Promise<void> {
    const parsed = parsePairCallback(url.searchParams);
    const createdAt = parsed ? this.connectStates.get(parsed.state) : undefined;
    if (!parsed || createdAt === undefined || Date.now() - createdAt > CONNECT_STATE_TTL_MS) {
      this.html(response, 400, "Link expired", "This connect link is invalid or was already used. Start again from the Rook Node app.");
      return;
    }
    this.connectStates.delete(parsed.state);
    const identity = await pairWithServer({
      serverUrl: this.config.serverUrl,
      pairingToken: parsed.token,
      name: hostName(),
      version: ROOK_NODE_VERSION,
    });
    this.node.db.saveCloudIdentity(identity);
    this.html(response, 200, "Connected", `<p><strong>${escapeHtml(hostName())}</strong> is now connected to your Rook account.</p><p class="muted">You can close this window.</p>`);
    this.hooks.onPaired?.(identity);
  }

  private beginConnectState(): string {
    for (const [state, createdAt] of this.connectStates) {
      if (Date.now() - createdAt > CONNECT_STATE_TTL_MS) this.connectStates.delete(state);
    }
    const state = randomBytes(24).toString("hex");
    this.connectStates.set(state, Date.now());
    return state;
  }

  private html(response: http.ServerResponse, status: number, title: string, bodyHtml: string): void {
    response.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)} · Rook</title>
<style>
  body{font-family:-apple-system,'Segoe UI',Roboto,sans-serif;background:#f6f5f1;color:#1a1d23;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
  .card{background:#fff;border:1px solid #e9e8e2;border-radius:20px;padding:38px 42px;max-width:430px;box-shadow:0 10px 30px rgba(0,0,0,.06)}
  h1{font-size:20px;margin:0 0 10px}
  p{font-size:14.5px;line-height:1.5;margin:8px 0}
  .muted{color:#8a887f;font-size:12.5px}
  .btn{display:inline-block;margin-top:14px;background:#1a1d23;color:#fff;text-decoration:none;padding:11px 22px;border-radius:12px;font-weight:600;font-size:14px}
</style></head><body><div class="card"><h1>${escapeHtml(title)}</h1>${bodyHtml}</div></body></html>`);
  }

  private onConnection(ws: WebSocket, remoteAddress: string): void {
    this.clients.set(ws, { deviceId: "", authenticated: false });
    ws.on("message", (data) => {
      void this.onMessage(ws, data.toString());
    });
    ws.on("close", () => {
      const entry = this.clients.get(ws);
      if (entry?.deviceId) this.node.removeDeviceBinding(entry.deviceId);
      this.clients.delete(ws);
    });
    ws.on("error", () => {
      /* handled by close */
    });
  }

  private async onMessage(ws: WebSocket, raw: string): Promise<void> {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      this.send(ws, { type: "rejected", code: "INVALID", message: "Malformed JSON", ref: undefined });
      return;
    }
    const kind = typeof message.t === "string" ? message.t : "";
    const entry = this.clients.get(ws);
    if (!entry) return;

    switch (kind) {
      case "auth": {
        if (entry.authenticated) {
          this.send(ws, { type: "rejected", code: "INVALID", message: "Already authenticated", ref: undefined });
          return;
        }
        const secret = typeof message.secret === "string" ? message.secret : "";
        const deviceId = typeof message.deviceId === "string" ? message.deviceId : "";
        const userId = typeof message.userId === "string" ? message.userId : "";
        const botIds = Array.isArray(message.botIds) ? message.botIds.filter((b): b is string => typeof b === "string") : [];
        if (!secret || !deviceId) {
          this.send(ws, { type: "rejected", code: "INVALID", message: "Missing credentials", ref: undefined });
          return;
        }
        if (!this.config.requireAuth || secret === this.nodeSecret()) {
          entry.authenticated = true;
          entry.deviceId = deviceId;
          this.node.setDeviceBinding({ deviceId, userId, allowedBotIds: botIds });
          this.send(ws, { type: "auth", ok: true, nodeId: this.nodeIdentity(), ref: undefined });
          return;
        }
        this.send(ws, { type: "rejected", code: "UNAUTHORIZED", message: "Bad secret", ref: undefined });
        return;
      }
      case "command": {
        if (!entry.authenticated) {
          this.send(ws, { type: "rejected", code: "UNAUTHORIZED", message: "Not authenticated", ref: undefined });
          return;
        }
        const envelope = message.envelope;
        const result = await this.node.dispatch(envelope);
        this.send(ws, this.resultMessage(result, message.ref));
        return;
      }
      case "takeover": {
        if (!entry.authenticated) {
          this.send(ws, { type: "rejected", code: "UNAUTHORIZED", message: "Not authenticated", ref: undefined });
          return;
        }
        const botId = typeof message.botId === "string" ? message.botId : "";
        if (!botId) {
          this.send(ws, { type: "rejected", code: "INVALID", message: "Missing botId", ref: undefined });
          return;
        }
        const lease = this.node.leases.takeOver(botId, entry.deviceId);
        this.node.recordEvent(botId, "takeover", { deviceId: entry.deviceId, fencing: lease.fencing });
        this.send(ws, { type: "takeover", ok: true, botId, fencing: lease.fencing, ref: message.ref });
        return;
      }
      case "release": {
        if (!entry.authenticated) {
          this.send(ws, { type: "rejected", code: "UNAUTHORIZED", message: "Not authenticated", ref: undefined });
          return;
        }
        const botId = typeof message.botId === "string" ? message.botId : "";
        if (!botId) {
          this.send(ws, { type: "rejected", code: "INVALID", message: "Missing botId", ref: undefined });
          return;
        }
        const lease = this.node.leases.giveToBot(botId);
        this.node.recordEvent(botId, "release", { deviceId: entry.deviceId, fencing: lease.fencing });
        this.send(ws, { type: "release", ok: true, botId, fencing: lease.fencing, ref: message.ref });
        return;
      }
      case "pause": {
        if (!entry.authenticated) {
          this.send(ws, { type: "rejected", code: "UNAUTHORIZED", message: "Not authenticated", ref: undefined });
          return;
        }
        const botId = typeof message.botId === "string" ? message.botId : "";
        if (!botId) {
          this.send(ws, { type: "rejected", code: "INVALID", message: "Missing botId", ref: undefined });
          return;
        }
        this.node.leases.pause(botId);
        this.node.recordEvent(botId, "pause", { deviceId: entry.deviceId });
        this.send(ws, { type: "pause", ok: true, botId, ref: message.ref });
        return;
      }
      case "approval": {
        if (!entry.authenticated) {
          this.send(ws, { type: "rejected", code: "UNAUTHORIZED", message: "Not authenticated", ref: undefined });
          return;
        }
        const approvalId = typeof message.approvalId === "string" ? message.approvalId : "";
        const decision = message.decision === "approved" || message.decision === "declined" ? message.decision : undefined;
        if (!approvalId || !decision) {
          this.send(ws, { type: "rejected", code: "INVALID", message: "Invalid approval decision", ref: undefined });
          return;
        }
        const record = await this.node.resolveApproval(approvalId, decision);
        this.send(ws, { type: "approval", ok: Boolean(record), approvalId, decision, ref: message.ref });
        return;
      }
      default: {
        this.send(ws, { type: "rejected", code: "INVALID", message: `Unknown message type: ${kind}`, ref: undefined });
      }
    }
  }

  private resultMessage(result: CommandResult, ref: unknown): { type: string; ok: boolean; ref: unknown; value?: unknown; code?: CommandRejectCode; message?: string } {
    if (result.ok) {
      return { type: "result", ok: true, ref, value: result.value };
    }
    return { type: "result", ok: false, ref, code: result.code, message: result.message };
  }

  private nodeSecret(): string {
    return this.config.nodeSecret ?? process.env.ROOK_NODE_SECRET ?? "";
  }

  private nodeIdentity(): string {
    return this.node.db.getNodeIdentity()?.nodeId ?? "";
  }

  private send(ws: WebSocket, payload: unknown): void {
    if (this.closed) return;
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
  }

  async listen(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.http.once("error", reject);
      this.http.listen(this.config.gatewayPort, "127.0.0.1", () => resolve());
    });
    // Best-effort IPv6 loopback twin: browsers resolving `localhost` to ::1
    // reach the node here too. Never blocks startup and never crashes a node
    // on a machine with IPv6 disabled — degrade gracefully to IPv4-only.
    (() => {
      this.http6.once("error", (error) => {
        console.warn(`[gateway] IPv6 loopback unavailable — serving IPv4-only: ${(error as Error).message}`);
      });
      this.http6.listen({ port: this.config.gatewayPort || 0, host: "::1", ipv6Only: true });
    })();
  }

  /** The actual bound loopback port (useful when configured as 0 for tests). */
  address(): { port: number } {
    const addr = this.http.address();
    if (typeof addr === "object" && addr !== null) return { port: addr.port };
    return { port: this.config.gatewayPort };
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const ws of this.clients.keys()) {
      ws.close();
    }
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
    await Promise.all([
      new Promise<void>((resolve) => this.http.close(() => resolve())),
      new Promise<void>((resolve) => this.http6.close(() => resolve())),
    ]);
  }
}

function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function hostName(): string {
  const raw = os.hostname().trim() || "This computer";
  return raw.length > 40 ? `${raw.slice(0, 37)}…` : raw;
}
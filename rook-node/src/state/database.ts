/**
 * Durable local state for Rook Node using node:sqlite (no native build step).
 *
 * Tables:
 *   node_identity      - node id + device key id
 *   bots               - the logical Bots running on this computer
 *   tabs               - durable Bot-to-page registry
 *   files              - content-addressed file manifest
 *   approvals          - pending/resolved approvals
 *   jobs               - unfinished jobs
 *   events             - append-only computer events
 *   leases             - control lease per Bot
 *   commands_seen      - replay protection (nonce + per-device seq)
 *   checkpoints        - logical checkpoint markers
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { DatabaseSync } from "node:sqlite";

import type {
  ApprovalRecord,
  BotRecord,
  EventRecord,
  FileRecord,
  JobRecord,
  LeaseRecord,
  NodeIdentity,
  TabRecord,
} from "../types.js";
import type { RookConfig } from "../config.js";

// node:sqlite is still flagged experimental in some Node majors; load it through
// createRequire so neither bundlers nor test runners try to resolve it as an
// external package. Bundlers that rewrite import.meta (esbuild CJS) leave it
// undefined, so fall back to the process cwd as the resolution base.
const require = createRequire(
  (import.meta as { url?: string }).url ?? "file:///" + process.cwd().replace(/\\/g, "/") + "/",
);
const { DatabaseSync: SqliteDatabaseSync } = require("node:sqlite") as { DatabaseSync: typeof DatabaseSync };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS node_identity (
  node_id TEXT PRIMARY KEY,
  device_key_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bots (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  identity TEXT NOT NULL DEFAULT 'shared',
  profile_dir TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tabs (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  group_index INTEGER NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tabs_bot_idx ON tabs(bot_id);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  name TEXT NOT NULL,
  scope TEXT NOT NULL,
  bot_id TEXT,
  size_bytes INTEGER NOT NULL,
  rel_path TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS files_scope_idx ON files(scope);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  action TEXT NOT NULL,
  origin TEXT NOT NULL,
  recipient TEXT,
  summary TEXT NOT NULL,
  file_hashes TEXT NOT NULL,
  page_revision INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS approvals_bot_idx ON approvals(bot_id);
CREATE INDEX IF NOT EXISTS approvals_state_idx ON approvals(state);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL,
  progress TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_bot_idx ON jobs(bot_id);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_bot_idx ON events(bot_id);

CREATE TABLE IF NOT EXISTS leases (
  bot_id TEXT PRIMARY KEY,
  state TEXT NOT NULL DEFAULT 'NONE',
  fencing INTEGER NOT NULL DEFAULT 0,
  holder_device_id TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS commands_seen (
  device_id TEXT NOT NULL,
  bot_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  last_seq INTEGER NOT NULL DEFAULT 0,
  nonce TEXT NOT NULL,
  seen_at TEXT NOT NULL,
  PRIMARY KEY (device_id, bot_id, page_id)
);

CREATE TABLE IF NOT EXISTS checkpoints (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cloud_identity (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  server_url TEXT NOT NULL,
  user_id TEXT NOT NULL DEFAULT '',
  node_id TEXT NOT NULL,
  node_secret TEXT NOT NULL,
  paired_at TEXT NOT NULL
);
`;

type Row = Record<string, unknown>;

export class RookDatabase {
  private readonly db: DatabaseSync;

  constructor(private readonly config: RookConfig) {
    fs.mkdirSync(config.dataHome, { recursive: true });
    const dbPath = path.join(config.dataHome, "node.sqlite");
    this.db = new SqliteDatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  private get<T>(sql: string, ...params: unknown[]): T | undefined {
    const row = this.db.prepare(sql).get(...params.map((p) => this.quote(p))) as Row | undefined;
    return row as T | undefined;
  }

  private all<T>(sql: string, ...params: unknown[]): T[] {
    const rows = this.db.prepare(sql).all(...params.map((p) => this.quote(p))) as Row[];
    return rows as T[];
  }

  private run(sql: string, ...params: unknown[]): void {
    this.db.prepare(sql).run(...params.map((p) => this.quote(p)));
  }

  private quote(value: unknown): string | number | null | Uint8Array {
    if (value === null || value === undefined) return null;
    if (typeof value === "number" || typeof value === "string" || value instanceof Uint8Array) return value;
    if (typeof value === "boolean") return value ? 1 : 0;
    return String(value);
  }

  /* ---- node identity ---- */

  ensureNodeIdentity(identity: NodeIdentity): NodeIdentity {
    const existing = this.get<Row>("SELECT node_id, device_key_id, created_at FROM node_identity");
    if (existing) {
      return { nodeId: existing.node_id as string, deviceKeyId: existing.device_key_id as string, createdAt: existing.created_at as string };
    }
    this.run("INSERT INTO node_identity (node_id, device_key_id, created_at) VALUES (?, ?, ?)", identity.nodeId, identity.deviceKeyId, identity.createdAt);
    return identity;
  }

  getNodeIdentity(): NodeIdentity | undefined {
    const row = this.get<Row>("SELECT node_id, device_key_id, created_at FROM node_identity");
    if (!row) return undefined;
    return { nodeId: row.node_id as string, deviceKeyId: row.device_key_id as string, createdAt: row.created_at as string };
  }

  /* ---- bots ---- */

  upsertBot(bot: BotRecord): void {
    this.run(
      "INSERT INTO bots (id, name, role, identity, profile_dir, created_at) VALUES (?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(id) DO UPDATE SET name=excluded.name, role=excluded.role, identity=excluded.identity, profile_dir=excluded.profile_dir",
      bot.id,
      bot.name,
      bot.role,
      bot.identity,
      bot.profileDir ?? null,
      bot.createdAt,
    );
  }

  listBots(): BotRecord[] {
    return this.all<Row>("SELECT id, name, role, identity, profile_dir, created_at FROM bots").map((row) => ({
      id: row.id as string,
      name: row.name as string,
      role: row.role as string,
      identity: (row.identity as "shared" | "private") ?? "shared",
      profileDir: (row.profile_dir as string | null) ?? undefined,
      createdAt: row.created_at as string,
    }));
  }

  getBot(botId: string): BotRecord | undefined {
    return this.listBots().find((bot) => bot.id === botId);
  }

  removeBot(botId: string): void {
    this.run("DELETE FROM tabs WHERE bot_id = ?", botId);
    this.run("DELETE FROM jobs WHERE bot_id = ?", botId);
    this.run("DELETE FROM approvals WHERE bot_id = ?", botId);
    this.run("DELETE FROM events WHERE bot_id = ?", botId);
    this.run("DELETE FROM leases WHERE bot_id = ?", botId);
    this.run("DELETE FROM bots WHERE id = ?", botId);
  }

  /* ---- tabs ---- */

  upsertTab(tab: TabRecord): void {
    this.run(
      "INSERT INTO tabs (id, bot_id, group_index, url, title, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(id) DO UPDATE SET url=excluded.url, title=excluded.title, revision=excluded.revision, updated_at=excluded.updated_at",
      tab.id,
      tab.botId,
      tab.groupIndex,
      tab.url,
      tab.title,
      tab.revision,
      tab.createdAt,
      tab.updatedAt,
    );
  }

  listTabs(botId?: string): TabRecord[] {
    const rows = botId
      ? this.all<Row>("SELECT * FROM tabs WHERE bot_id = ? ORDER BY group_index", botId)
      : this.all<Row>("SELECT * FROM tabs ORDER BY group_index");
    return rows.map((row) => ({
      id: row.id as string,
      botId: row.bot_id as string,
      groupIndex: row.group_index as number,
      url: row.url as string,
      title: row.title as string,
      revision: row.revision as number,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    }));
  }

  getTab(tabId: string): TabRecord | undefined {
    return this.listTabs().find((tab) => tab.id === tabId);
  }

  removeTab(tabId: string): void {
    this.run("DELETE FROM tabs WHERE id = ?", tabId);
  }

  clearTabs(): void {
    this.run("DELETE FROM tabs");
  }

  /* ---- files ---- */

  upsertFile(file: FileRecord): void {
    this.run(
      "INSERT INTO files (id, hash, name, scope, bot_id, size_bytes, rel_path, version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(id) DO UPDATE SET hash=excluded.hash, name=excluded.name, scope=excluded.scope, bot_id=excluded.bot_id, " +
        "size_bytes=excluded.size_bytes, rel_path=excluded.rel_path, version=excluded.version",
      file.id,
      file.hash,
      file.name,
      file.scope,
      file.botId ?? null,
      file.sizeBytes,
      file.relPath,
      file.version,
      file.createdAt,
    );
  }

  getFile(fileId: string): FileRecord | undefined {
    const row = this.get<Row>("SELECT * FROM files WHERE id = ?", fileId);
    if (!row) return undefined;
    return this.mapFileRow(row);
  }

  listFiles(scope?: string, botId?: string): FileRecord[] {
    let sql = "SELECT * FROM files";
    const params: unknown[] = [];
    const where: string[] = [];
    if (scope) where.push("scope = ?"), params.push(scope);
    if (botId) where.push("bot_id = ?"), params.push(botId);
    if (where.length) sql += " WHERE " + where.join(" AND ");
    sql += " ORDER BY created_at DESC";
    return this.all<Row>(sql, ...params).map((row) => this.mapFileRow(row));
  }

  private mapFileRow(row: Row): FileRecord {
    return {
      id: row.id as string,
      hash: row.hash as string,
      name: row.name as string,
      scope: row.scope as FileRecord["scope"],
      botId: (row.bot_id as string | null) ?? undefined,
      sizeBytes: row.size_bytes as number,
      relPath: row.rel_path as string,
      version: row.version as number,
      createdAt: row.created_at as string,
    };
  }

  /* ---- approvals ---- */

  insertApproval(approval: ApprovalRecord): void {
    this.run(
      "INSERT INTO approvals (id, bot_id, page_id, capability, action, origin, recipient, summary, file_hashes, page_revision, state, expires_at, created_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      approval.id,
      approval.botId,
      approval.pageId,
      approval.capability,
      JSON.stringify(approval.action),
      approval.origin,
      approval.recipient ?? null,
      approval.summary,
      JSON.stringify(approval.fileHashes),
      approval.pageRevision,
      approval.state,
      approval.expiresAt,
      approval.createdAt,
    );
  }

  listApprovals(state?: string): ApprovalRecord[] {
    const rows = state
      ? this.all<Row>("SELECT * FROM approvals WHERE state = ? ORDER BY created_at DESC", state)
      : this.all<Row>("SELECT * FROM approvals ORDER BY created_at DESC");
    return rows.map((row) => this.mapApprovalRow(row));
  }

  getApproval(id: string): ApprovalRecord | undefined {
    const row = this.get<Row>("SELECT * FROM approvals WHERE id = ?", id);
    return row ? this.mapApprovalRow(row) : undefined;
  }

  resolveApproval(id: string, state: "approved" | "declined" | "expired"): void {
    this.run("UPDATE approvals SET state = ?, resolved_at = ? WHERE id = ?", state, new Date().toISOString(), id);
  }

  private mapApprovalRow(row: Row): ApprovalRecord {
    return {
      id: row.id as string,
      botId: row.bot_id as string,
      pageId: row.page_id as string,
      capability: row.capability as ApprovalRecord["capability"],
      action: JSON.parse(row.action as string) as ApprovalRecord["action"],
      origin: row.origin as string,
      recipient: (row.recipient as string | null) ?? undefined,
      summary: row.summary as string,
      fileHashes: JSON.parse(row.file_hashes as string) as string[],
      pageRevision: row.page_revision as number,
      state: row.state as ApprovalRecord["state"],
      expiresAt: row.expires_at as string,
      createdAt: row.created_at as string,
      resolvedAt: (row.resolved_at as string | null) ?? undefined,
    };
  }

  /* ---- jobs ---- */

  upsertJob(job: JobRecord): void {
    this.run(
      "INSERT INTO jobs (id, bot_id, description, status, progress, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(id) DO UPDATE SET status=excluded.status, progress=excluded.progress, updated_at=excluded.updated_at",
      job.id,
      job.botId,
      job.description,
      job.status,
      job.progress ?? null,
      job.createdAt,
      job.updatedAt,
    );
  }

  listJobs(botId?: string): JobRecord[] {
    const rows = botId
      ? this.all<Row>("SELECT * FROM jobs WHERE bot_id = ? ORDER BY created_at DESC", botId)
      : this.all<Row>("SELECT * FROM jobs ORDER BY created_at DESC");
    return rows.map((row) => ({
      id: row.id as string,
      botId: row.bot_id as string,
      description: row.description as string,
      status: row.status as JobRecord["status"],
      progress: (row.progress as string | null) ?? undefined,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    }));
  }

  /* ---- events ---- */

  appendEvent(event: EventRecord): void {
    this.run(
      "INSERT INTO events (id, bot_id, kind, payload, created_at) VALUES (?, ?, ?, ?, ?)",
      event.id,
      event.botId,
      event.kind,
      event.payload,
      event.createdAt,
    );
  }

  listEvents(botId?: string, limit = 200): EventRecord[] {
    const rows = botId
      ? this.all<Row>("SELECT * FROM events WHERE bot_id = ? ORDER BY created_at DESC LIMIT ?", botId, limit)
      : this.all<Row>("SELECT * FROM events ORDER BY created_at DESC LIMIT ?", limit);
    return rows.map((row) => ({
      id: row.id as string,
      botId: row.bot_id as string,
      kind: row.kind as string,
      payload: row.payload as string,
      createdAt: row.created_at as string,
    }));
  }

  /* ---- leases ---- */

  getLease(botId: string): LeaseRecord {
    const row = this.get<Row>("SELECT bot_id, state, fencing, holder_device_id, updated_at FROM leases WHERE bot_id = ?", botId);
    if (row) {
      return {
        botId: row.bot_id as string,
        state: row.state as LeaseRecord["state"],
        fencing: row.fencing as number,
        holderDeviceId: row.holder_device_id as string,
        updatedAt: row.updated_at as string,
      };
    }
    return { botId, state: "NONE", fencing: 0, holderDeviceId: "", updatedAt: new Date().toISOString() };
  }

  saveLease(lease: LeaseRecord): void {
    this.run(
      "INSERT INTO leases (bot_id, state, fencing, holder_device_id, updated_at) VALUES (?, ?, ?, ?, ?) " +
        "ON CONFLICT(bot_id) DO UPDATE SET state=excluded.state, fencing=excluded.fencing, holder_device_id=excluded.holder_device_id, updated_at=excluded.updated_at",
      lease.botId,
      lease.state,
      lease.fencing,
      lease.holderDeviceId,
      lease.updatedAt,
    );
  }

  listLeases(): LeaseRecord[] {
    return this.all<Row>("SELECT bot_id, state, fencing, holder_device_id, updated_at FROM leases").map((row) => ({
      botId: row.bot_id as string,
      state: row.state as LeaseRecord["state"],
      fencing: row.fencing as number,
      holderDeviceId: row.holder_device_id as string,
      updatedAt: row.updated_at as string,
    }));
  }

  /* ---- replay protection ---- */

  /** Returns true if the command's nonce+seq are new; records them atomically. */
  recordCommandSeen(deviceId: string, botId: string, pageId: string, seq: number, nonce: string): boolean {
    const row = this.get<Row>(
      "SELECT last_seq, nonce FROM commands_seen WHERE device_id = ? AND bot_id = ? AND page_id = ?",
      deviceId,
      botId,
      pageId,
    );
    if (row) {
      if ((row.last_seq as number) >= seq) return false;
      if (row.nonce === nonce) return false;
      this.run(
        "UPDATE commands_seen SET last_seq = ?, nonce = ?, seen_at = ? WHERE device_id = ? AND bot_id = ? AND page_id = ?",
        seq,
        nonce,
        new Date().toISOString(),
        deviceId,
        botId,
        pageId,
      );
      return true;
    }
    this.run(
      "INSERT INTO commands_seen (device_id, bot_id, page_id, last_seq, nonce, seen_at) VALUES (?, ?, ?, ?, ?, ?)",
      deviceId,
      botId,
      pageId,
      seq,
      nonce,
      new Date().toISOString(),
    );
    return true;
  }

  /** Global nonce lookup used for approval one-time nonces. */
  hasSeenApprovalNonce(nonce: string): boolean {
    const row = this.get<Row>("SELECT nonce FROM commands_seen WHERE nonce = ? LIMIT 1", nonce);
    return Boolean(row);
  }

  markApprovalNonce(nonce: string): void {
    // Reuse the commands_seen table with sentinel keys so a replay check is a single query.
    this.run(
      "INSERT INTO commands_seen (device_id, bot_id, page_id, last_seq, nonce, seen_at) VALUES (?, ?, ?, ?, ?, ?)",
      "approval-nonce",
      "approval-nonce",
      "approval-nonce",
      0,
      nonce,
      new Date().toISOString(),
    );
  }

  /* ---- checkpoints ---- */

  saveCheckpoint(label: string, payload: unknown): void {
    this.run(
      "INSERT INTO checkpoints (id, label, payload, created_at) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT(id) DO UPDATE SET label=excluded.label, payload=excluded.payload, created_at=excluded.created_at",
      label,
      label,
      JSON.stringify(payload),
      new Date().toISOString(),
    );
  }

  getCheckpoint(label: string): unknown {
    const row = this.get<Row>("SELECT payload FROM checkpoints WHERE id = ?", label);
    return row ? JSON.parse(row.payload as string) : undefined;
  }

  listCheckpoints(): { id: string; label: string; createdAt: string }[] {
    return this.all<Row>("SELECT id, label, created_at FROM checkpoints").map((row) => ({
      id: row.id as string,
      label: row.label as string,
      createdAt: row.created_at as string,
    }));
  }

  /* ---- cloud identity (uplink credentials) ---- */

  saveCloudIdentity(identity: { serverUrl: string; userId: string; nodeId: string; nodeSecret: string; pairedAt: string }): void {
    this.run(
      "INSERT INTO cloud_identity (id, server_url, user_id, node_id, node_secret, paired_at) VALUES (1, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(id) DO UPDATE SET server_url=excluded.server_url, user_id=excluded.user_id, node_id=excluded.node_id, node_secret=excluded.node_secret, paired_at=excluded.paired_at",
      identity.serverUrl,
      identity.userId,
      identity.nodeId,
      identity.nodeSecret,
      identity.pairedAt,
    );
  }

  getCloudIdentity(): { serverUrl: string; userId: string; nodeId: string; nodeSecret: string; pairedAt: string } | undefined {
    const row = this.get<Row>("SELECT server_url, user_id, node_id, node_secret, paired_at FROM cloud_identity WHERE id = 1");
    if (!row) return undefined;
    return {
      serverUrl: String(row.server_url ?? ""),
      userId: String(row.user_id ?? ""),
      nodeId: String(row.node_id ?? ""),
      nodeSecret: String(row.node_secret ?? ""),
      pairedAt: String(row.paired_at ?? ""),
    };
  }

  clearCloudIdentity(): void {
    this.run("DELETE FROM cloud_identity WHERE id = 1");
  }
}

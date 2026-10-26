/**
 * File broker: the only filesystem authority for the workspace.
 *
 * - Web pages and AI tools receive opaque content-addressed file IDs, never
 *   arbitrary host paths.
 * - Paths are normalized and traversal / symlink escapes rejected.
 * - Downloads land in quarantine and are only promoted after approval.
 * - The owner's home directory, SSH keys, password stores, and cloud folders
 *   are never exposed.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import type { RookConfig } from "../config.js";
import { botWorkspaceDir, ensureWorkspace, workspaceDir } from "../config.js";
import { MAX_FILE_BYTES } from "../types.js";
import type { FileRecord } from "../types.js";
import type { RookDatabase } from "../state/database.js";

export class BrokerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrokerError";
  }
}

const FILE_ID_PREFIX = "file";

/** Normalizes a client-supplied relative path, rejecting traversal and escaping. */
export function normalizeRelPath(input: string): string {
  if (!input || input.includes("\0")) throw new BrokerError("Invalid file path");
  const trimmed = input.trim();
  // Reject absolute paths outright rather than silently re-rooting them.
  if (
    trimmed.startsWith("/") ||
    trimmed.startsWith("\\") ||
    /^[a-zA-Z]:[\\/]/.test(trimmed) ||
    trimmed.startsWith("\\\\") ||
    trimmed.startsWith("//")
  ) {
    throw new BrokerError("Absolute file paths are not allowed");
  }
  const normalized = path.posix.normalize(trimmed.replace(/\\/g, "/")).replace(/^[/\\]+/, "");
  if (normalized === "." || normalized === "") throw new BrokerError("Invalid file path");
  const parts = normalized.split("/");
  if (parts.some((part) => part === "..")) throw new BrokerError("Path traversal rejected");
  if (parts.some((part) => part === "." || part === "")) throw new BrokerError("Invalid file path");
  return normalized;
}

/** Verifies a resolved absolute path stays inside a trusted root. */
export function assertWithinRoot(absolute: string, root: string): string {
  const resolvedRoot = fs.realpathSync.native(root);
  const resolved = fs.realpathSync.native(absolute);
  const relative = path.relative(resolvedRoot, resolved);
  if (relative === "" || (relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative))) {
    return resolved;
  }
  throw new BrokerError("Path escapes the Rook workspace");
}

/** Rejects a candidate path if it is a symlink or would traverse out of root. */
export function safeResolve(root: string, relPath: string): string {
  const normalized = normalizeRelPath(relPath);
  const candidate = path.resolve(root, normalized);
  const rel = path.relative(root, candidate);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new BrokerError("Path traversal rejected");
  // Resolve realpath of the existing parent to catch symlinked directories.
  const parent = path.dirname(candidate);
  const realParent = fs.existsSync(parent) ? fs.realpathSync.native(parent) : parent;
  if (path.relative(root, realParent).startsWith("..") && path.relative(root, realParent) !== "") {
    throw new BrokerError("Symlink escape rejected");
  }
  return candidate;
}

export class FileBroker {
  constructor(
    private readonly config: RookConfig,
    private readonly db: RookDatabase,
  ) {
    ensureWorkspace(config);
  }

  private rootFor(scope: FileRecord["scope"], botId?: string): string {
    switch (scope) {
      case "shared":
        return workspaceDir(this.config, "shared");
      case "bot":
        return botWorkspaceDir(this.config, botId ?? "");
      case "download":
        return path.join(workspaceDir(this.config, "bots"), botId ?? "", "downloads");
      case "upload":
        return path.join(workspaceDir(this.config, "bots"), botId ?? "", "uploads");
      case "quarantine":
        return workspaceDir(this.config, "quarantine");
    }
  }

  private scopeRoot(scope: FileRecord["scope"], botId?: string): string {
    const root = this.rootFor(scope, botId);
    fs.mkdirSync(root, { recursive: true });
    return root;
  }

  /** Registers content already stored on disk. Returns the opaque file record. */
  registerFile(opts: {
    scope: FileRecord["scope"];
    botId?: string;
    relPath: string;
    sourcePath?: string;
  }): FileRecord {
    if (opts.scope === "bot" && !opts.botId) throw new BrokerError("A Bot file requires a botId");
    const root = this.scopeRoot(opts.scope, opts.botId);
    const rel = normalizeRelPath(opts.relPath);
    const abs = safeResolve(root, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new BrokerError("File not found");
    const size = fs.statSync(abs).size;
    if (size > MAX_FILE_BYTES) throw new BrokerError(`File exceeds the ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB limit`);
    const hash = sha256File(abs);
    const id = `${FILE_ID_PREFIX}-${hash.slice(0, 20)}-${rel.length}-${crypto.randomBytes(4).toString("hex")}`;
    const existing = this.db.getFile(id);
    if (existing) return existing;
    const record: FileRecord = {
      id,
      hash,
      name: path.basename(rel),
      scope: opts.scope,
      botId: opts.botId,
      sizeBytes: size,
      relPath: rel,
      version: 1,
      createdAt: new Date().toISOString(),
    };
    this.db.upsertFile(record);
    return record;
  }

  /** Ingests raw bytes into the workspace and returns an opaque file id. */
  ingestBytes(opts: {
    scope: FileRecord["scope"];
    botId?: string;
    name: string;
    bytes: Buffer;
  }): FileRecord {
    if (opts.bytes.byteLength > MAX_FILE_BYTES) {
      throw new BrokerError(`File exceeds the ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB limit`);
    }
    if (opts.scope === "bot" && !opts.botId) throw new BrokerError("A Bot file requires a botId");
    const hash = sha256Buffer(opts.bytes);
    const id = `${FILE_ID_PREFIX}-${hash.slice(0, 20)}-${Buffer.byteLength(opts.bytes)}-${crypto.randomBytes(4).toString("hex")}`;
    const existing = this.db.getFile(id);
    if (existing) return existing;
    const rel = normalizeRelPath(opts.name);
    const root = this.scopeRoot(opts.scope, opts.botId);
    const abs = safeResolve(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, opts.bytes, { flag: "wx" });
    const record: FileRecord = {
      id,
      hash,
      name: path.basename(rel),
      scope: opts.scope,
      botId: opts.botId,
      sizeBytes: opts.bytes.byteLength,
      relPath: rel,
      version: 1,
      createdAt: new Date().toISOString(),
    };
    this.db.upsertFile(record);
    return record;
  }

  /** Reads a file by opaque id, never by host path. Returns content bytes. */
  readById(fileId: string): { record: FileRecord; bytes: Buffer } {
    const record = this.db.getFile(fileId);
    if (!record) throw new BrokerError("Unknown file id");
    // Quarantine files are not readable until promoted after approval.
    if (record.scope === "quarantine") throw new BrokerError("Quarantined file must be promoted before reading");
    const root = this.scopeRoot(record.scope, record.botId);
    const abs = safeResolve(root, record.relPath);
    if (!fs.existsSync(abs)) throw new BrokerError("File content missing");
    return { record, bytes: fs.readFileSync(abs) };
  }

  /** Provides a safe absolute path to the broker owner (never handed to web/AI). */
  resolvePath(fileId: string): string {
    const record = this.db.getFile(fileId);
    if (!record) throw new BrokerError("Unknown file id");
    return safeResolve(this.scopeRoot(record.scope, record.botId), record.relPath);
  }

  /** Quarantine a downloaded file. Returns the record with scope "quarantine". */
  quarantine(name: string, bytes: Buffer, botId?: string): FileRecord {
    const rel = normalizeRelPath(name);
    const root = this.scopeRoot("quarantine");
    const abs = safeResolve(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, bytes, { flag: "wx" });
    const hash = sha256Buffer(bytes);
    const id = `${FILE_ID_PREFIX}-${hash.slice(0, 20)}-${bytes.byteLength}-${crypto.randomBytes(4).toString("hex")}`;
    const record: FileRecord = {
      id,
      hash,
      name: path.basename(rel),
      scope: "quarantine",
      botId,
      sizeBytes: bytes.byteLength,
      relPath: rel,
      version: 1,
      createdAt: new Date().toISOString(),
    };
    this.db.upsertFile(record);
    return record;
  }

  /** Promotes a quarantined file into a target scope after approval. */
  promote(fileId: string, targetScope: "shared" | "bot", botId?: string): FileRecord {
    if (targetScope === "bot" && !botId) throw new BrokerError("A Bot file requires a botId");
    const quarantined = this.db.getFile(fileId);
    if (!quarantined || quarantined.scope !== "quarantine") throw new BrokerError("Only quarantined downloads can be promoted");
    const sourceAbs = safeResolve(this.scopeRoot("quarantine"), quarantined.relPath);
    const root = this.scopeRoot(targetScope, botId);
    const targetAbs = safeResolve(root, quarantined.relPath);
    fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
    fs.copyFileSync(sourceAbs, targetAbs);
    const promoted: FileRecord = { ...quarantined, scope: targetScope, botId, version: quarantined.version + 1 };
    this.db.upsertFile(promoted);
    return promoted;
  }

  list(scope?: FileRecord["scope"], botId?: string): FileRecord[] {
    return this.db.listFiles(scope, botId);
  }
}

function sha256File(abs: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
}

function sha256Buffer(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}
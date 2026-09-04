import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defaultConfig, type RookConfig } from "../src/config.js";
import { RookDatabase } from "../src/state/database.js";
import { FileBroker, BrokerError, normalizeRelPath, safeResolve } from "../src/files/broker.js";

describe("file broker", () => {
  let config: RookConfig;
  let db: RookDatabase;
  let broker: FileBroker;
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rook-node-test-"));
    config = defaultConfig({ dataHome: path.join(tempRoot, "data"), workspaceRoot: path.join(tempRoot, "Rook"), requireAuth: false });
    db = new RookDatabase(config);
    broker = new FileBroker(config, db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("normalizes relative paths and rejects traversal", () => {
    expect(normalizeRelPath("a/b.txt")).toBe("a/b.txt");
    expect(() => normalizeRelPath("..\\..\\secret.txt")).toThrow(BrokerError);
    expect(() => normalizeRelPath("../../etc/passwd")).toThrow(BrokerError);
    expect(() => normalizeRelPath("a/../../b")).toThrow(BrokerError);
    expect(() => normalizeRelPath("")).toThrow(BrokerError);
    expect(() => normalizeRelPath("C:\\Windows\\System32")).toThrow(BrokerError);
    expect(() => normalizeRelPath("/etc/passwd")).toThrow(BrokerError);
    expect(() => normalizeRelPath("\\\\server\\share")).toThrow(BrokerError);
  });

  it("rejects absolute and traversal paths in safeResolve", () => {
    const root = path.join(tempRoot, "Rook", "shared");
    fs.mkdirSync(root, { recursive: true });
    expect(() => safeResolve(root, "../../outside.txt")).toThrow(BrokerError);
    expect(() => safeResolve(root, "/etc/passwd")).toThrow(BrokerError);
  });

  it("stores and retrieves bytes by opaque id", () => {
    const record = broker.ingestBytes({ scope: "shared", name: "notes.md", bytes: Buffer.from("hello world") });
    expect(record.id.startsWith("file-")).toBe(true);
    const { record: read, bytes } = broker.readById(record.id);
    expect(read.relPath).toBe("notes.md");
    expect(bytes.toString()).toBe("hello world");
  });

  it("returns opaque ids, never host paths", () => {
    const record = broker.ingestBytes({ scope: "shared", name: "doc.txt", bytes: Buffer.from("x") });
    expect(record.id).not.toContain(tempRoot);
    expect(record.relPath).not.toContain(":");
  });

  it("rejects files over the size limit", () => {
    const big = Buffer.alloc(201 * 1024 * 1024, 1);
    expect(() => broker.ingestBytes({ scope: "shared", name: "big.bin", bytes: big })).toThrow(BrokerError);
  });

  it("requires botId for bot-scoped files", () => {
    expect(() => broker.ingestBytes({ scope: "bot", name: "f.txt", bytes: Buffer.from("x") })).toThrow(BrokerError);
  });

  it("quarantines downloads and only promotes after resolution", () => {
    const record = broker.quarantine("payload.exe", Buffer.from("MZ...."), "bot-1");
    expect(record.scope).toBe("quarantine");
    expect(() => broker.readById(record.id)).toThrow(BrokerError); // quarantine is read-only until promoted
    const promoted = broker.promote(record.id, "bot", "bot-1");
    expect(promoted.scope).toBe("bot");
    expect(promoted.version).toBe(2);
    expect(broker.readById(record.id).bytes.toString()).toBe("MZ....");
  });

  it("registers existing files from disk", () => {
    const shared = path.join(tempRoot, "Rook", "shared");
    fs.mkdirSync(shared, { recursive: true });
    const file = path.join(shared, "existing.txt");
    fs.writeFileSync(file, "content");
    const record = broker.registerFile({ scope: "shared", relPath: "existing.txt" });
    expect(record.hash).toHaveLength(64);
  });

  it("does not expose the owner's home directory", () => {
    const homeFiles = ["id_rsa", ".ssh/id_ed25519", "AppData/Local/Google/Chrome/User Data/Default/Login Data"];
    for (const f of homeFiles) {
      expect(() => normalizeRelPath(f)).not.toThrow();
      // The broker never resolves against the home directory root.
      const record = broker.ingestBytes({ scope: "shared", name: f, bytes: Buffer.from("x") });
      expect(record.relPath.includes("..")).toBe(false);
    }
  });
});
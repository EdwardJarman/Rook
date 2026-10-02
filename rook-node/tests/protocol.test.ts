import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defaultConfig } from "../src/config.js";
import { RookDatabase } from "../src/state/database.js";
import { CommandValidator } from "../src/control/protocol.js";
import type { CommandEnvelope } from "../src/types.js";

describe("command protocol validator", () => {
  let db: RookDatabase;
  let validator: CommandValidator;
  let tabId: string;

  const makeEnvelope = (overrides: Partial<CommandEnvelope> = {}): CommandEnvelope => ({
    version: 1,
    deviceId: "dev-1",
    userId: "user-1",
    botId: "bot-1",
    pageId: tabId,
    seq: 1,
    nonce: `nonce-${Math.random().toString(36).slice(2, 12)}`,
    issuedAt: Date.now(),
    deadline: Date.now() + 60_000,
    pageRevision: 1,
    capability: "read",
    action: { type: "readUrl" },
    ...overrides,
  });

  beforeEach(() => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rook-node-test-"));
    const config = defaultConfig({ dataHome: path.join(tempRoot, "data"), requireAuth: false });
    db = new RookDatabase(config);
    // Seed a tab with revision 1.
    const now = new Date().toISOString();
    db.upsertTab({ id: "tab-1", botId: "bot-1", groupIndex: 0, url: "https://example.com", title: "Example", revision: 1, createdAt: now, updatedAt: now });
    tabId = "tab-1";
    validator = new CommandValidator({
      db,
      bindingForDevice: (deviceId) =>
        deviceId === "dev-1" ? { deviceId: "dev-1", userId: "user-1", allowedBotIds: ["bot-1"] } : undefined,
      tabRevision: (pageId) => (pageId === "tab-1" ? 1 : undefined),
      validateApproval: (proof, action, capability) => {
        if (proof.approvalId !== "approval-1") return "APPROVAL_INVALID";
        if (proof.expiresAt <= Date.now()) return "APPROVAL_EXPIRED";
        return undefined;
      },
    });
  });

  afterEach(() => {
    db.close();
  });

  it("accepts a valid read command", () => {
    const result = validator.validate(makeEnvelope());
    expect(result.ok).toBe(true);
  });

  it("rejects malformed envelopes", () => {
    expect(validator.validate(null).ok).toBe(false);
    expect(validator.validate({}).ok).toBe(false);
    const badVersion = makeEnvelope();
    badVersion.version = 2;
    expect(validator.validate(badVersion).ok).toBe(false);
  });

  it("rejects expired and stale commands", () => {
    expect(validator.validate(makeEnvelope({ deadline: Date.now() - 1000 })).ok).toBe(false);
    expect(validator.validate(makeEnvelope({ issuedAt: Date.now() - 10 * 60_000 })).ok).toBe(false);
    expect(validator.validate(makeEnvelope({ issuedAt: Date.now() + 60_000 })).ok).toBe(false);
  });

  it("rejects replayed commands via nonce", () => {
    const envelope = makeEnvelope();
    expect(validator.validate(envelope).ok).toBe(true);
    const replayed = validator.validate(makeEnvelope({ nonce: envelope.nonce, seq: envelope.seq }));
    expect(replayed.ok).toBe(false);
    if (!replayed.ok) expect(replayed.code).toBe("REPLAYED");
  });

  it("rejects out-of-order sequence numbers", () => {
    expect(validator.validate(makeEnvelope({ seq: 5 })).ok).toBe(true);
    expect(validator.validate(makeEnvelope({ seq: 3 })).ok).toBe(false);
  });

  it("rejects cross-user and cross-bot commands", () => {
    const crossUser = validator.validate(makeEnvelope({ userId: "user-2" }));
    expect(crossUser.ok).toBe(false);
    if (!crossUser.ok) expect(crossUser.code).toBe("CROSS_USER");

    const crossBot = validator.validate(makeEnvelope({ botId: "bot-2" }));
    expect(crossBot.ok).toBe(false);
    if (!crossBot.ok) expect(crossBot.code).toBe("CROSS_BOT");
  });

  it("rejects unknown devices", () => {
    const result = validator.validate(makeEnvelope({ deviceId: "evil-device" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("CROSS_USER");
  });

  it("rejects commands against an unknown page or stale revision", () => {
    expect(validator.validate(makeEnvelope({ pageId: "tab-999" })).ok).toBe(false);
    expect(validator.validate(makeEnvelope({ pageRevision: 0 })).ok).toBe(false);
  });

  it("rejects capability mismatches", () => {
    const result = validator.validate(makeEnvelope({ capability: "navigate", action: { type: "readUrl" } }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("UNAUTHORIZED_CAPABILITY");
  });

  it("requires approval for sensitive actions", () => {
    const sensitive = makeEnvelope({
      capability: "delete",
      action: { type: "click", selector: "#delete-button" },
    });
    expect(validator.validate(sensitive).ok).toBe(false);

    const withApproval = makeEnvelope({
      capability: "delete",
      action: { type: "click", selector: "#delete-button" },
      approval: {
        approvalId: "approval-1",
        origin: "https://example.com",
        actionSummary: "click",
        fileHashes: [],
        pageRevision: 1,
        expiresAt: Date.now() + 60_000,
        nonce: "proof-nonce-1",
      },
    });
    expect(validator.validate(withApproval).ok).toBe(true);
  });

  it("rejects sensitive actions with missing approvals", () => {
    const result = validator.validate(makeEnvelope({
      capability: "purchase",
      action: { type: "press", key: "Enter" },
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("APPROVAL_MISSING");
  });
});
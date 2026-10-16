import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defaultConfig } from "../src/config.js";
import { RookDatabase } from "../src/state/database.js";
import { ApprovalManager } from "../src/control/approvals.js";

describe("approval manager", () => {
  let db: RookDatabase;
  let approvals: ApprovalManager;

  beforeEach(() => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rook-node-test-"));
    const config = defaultConfig({ dataHome: path.join(tempRoot, "data"), requireAuth: false });
    db = new RookDatabase(config);
    approvals = new ApprovalManager(db);
  });

  afterEach(() => {
    db.close();
  });

  const base = () => ({
    botId: "bot-1",
    pageId: "tab-1",
    action: { type: "click", selector: "#submit" } as const,
    capability: "form" as const,
    origin: "https://example.com",
    summary: "Submit payment form",
    pageRevision: 1,
  });

  it("creates pending approvals bound to the exact action", () => {
    const record = approvals.request(base());
    expect(record.state).toBe("pending");
    expect(record.capability).toBe("form");
    expect(record.action).toEqual({ type: "click", selector: "#submit" });
    expect(approvals.list(undefined, "pending")).toHaveLength(1);
  });

  it("approves and records the decision", async () => {
    const record = approvals.request(base());
    const resolved = await approvals.resolve(record.id, { state: "approved" });
    expect(resolved?.state).toBe("approved");
    expect(resolved?.resolvedAt).toBeTruthy();
    expect(approvals.list(undefined, "pending")).toHaveLength(0);
  });

  it("cannot approve twice", async () => {
    const record = approvals.request(base());
    await approvals.resolve(record.id, { state: "approved" });
    const second = await approvals.resolve(record.id, { state: "declined" });
    expect(second?.state).toBe("approved");
  });

  it("expires overdue approvals", async () => {
    const record = approvals.request({ ...base(), ttlMs: 5 });
    // Wait past the 5ms TTL — same-millisecond checks race on fast CI machines.
    await new Promise((resolve) => setTimeout(resolve, 20));
    approvals.expireOverdue();
    const stored = db.getApproval(record.id);
    expect(stored?.state).toBe("expired");
  });

  it("validates a proof bound to the exact action and capability", async () => {
    const record = approvals.request(base());
    await approvals.resolve(record.id, { state: "approved" });
    const proof = {
      approvalId: record.id,
      origin: "https://example.com",
      actionSummary: "click",
      fileHashes: [],
      pageRevision: 1,
      expiresAt: Date.now() + 60_000,
      nonce: "n1",
    };
    expect(approvals.validateProof(proof, { type: "click", selector: "#submit" }, "form")).toBeUndefined();
    // Wrong action → invalid.
    expect(approvals.validateProof(proof, { type: "click", selector: "#other" }, "form")).toBe("APPROVAL_INVALID");
    // Wrong capability → invalid.
    expect(approvals.validateProof(proof, { type: "click", selector: "#submit" }, "delete")).toBe("APPROVAL_INVALID");
    // Unknown approval → invalid.
    expect(approvals.validateProof({ ...proof, approvalId: "nope" }, { type: "click", selector: "#submit" }, "form")).toBe("APPROVAL_INVALID");
    // Expired proof → expired.
    expect(approvals.validateProof({ ...proof, expiresAt: Date.now() - 1 }, { type: "click", selector: "#submit" }, "form")).toBe("APPROVAL_EXPIRED");
  });

  it("prevents approval nonce replay", async () => {
    const record = approvals.request(base());
    await approvals.resolve(record.id, { state: "approved" });
    const proof = {
      approvalId: record.id,
      origin: "https://example.com",
      actionSummary: "click",
      fileHashes: [],
      pageRevision: 1,
      expiresAt: Date.now() + 60_000,
      nonce: "n1",
    };
    expect(approvals.validateProof(proof, { type: "click", selector: "#submit" }, "form")).toBeUndefined();
    approvals.consumeNonce(proof);
    expect(approvals.validateProof(proof, { type: "click", selector: "#submit" }, "form")).toBe("APPROVAL_REPLAYED");
  });
});
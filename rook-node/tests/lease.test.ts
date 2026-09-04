import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defaultConfig } from "../src/config.js";
import { RookDatabase } from "../src/state/database.js";
import { LeaseManager } from "../src/control/lease.js";
import { LeaseRejectedError } from "../src/control/lease.js";

describe("lease manager", () => {
  let db: RookDatabase;
  let leases: LeaseManager;

  beforeEach(() => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rook-node-test-"));
    const config = defaultConfig({ dataHome: path.join(tempRoot, "data"), requireAuth: false });
    db = new RookDatabase(config);
    leases = new LeaseManager(db);
  });

  afterEach(() => {
    db.close();
  });

  it("starts in NONE with fencing 0", () => {
    expect(leases.get("bot-1")).toMatchObject({ botId: "bot-1", state: "NONE", fencing: 0 });
  });

  it("grants the Bot control and bumps fencing", () => {
    const lease = leases.giveToBot("bot-1");
    expect(lease.state).toBe("BOT");
    expect(lease.fencing).toBe(1);
    expect(leases.botHoldsControl("bot-1")).toBe(true);
  });

  it("human takeover fences out the Bot", () => {
    leases.giveToBot("bot-1");
    const lease = leases.takeOver("bot-1", "device-9");
    expect(lease.state).toBe("HUMAN");
    expect(lease.fencing).toBe(2);
    expect(leases.botHoldsControl("bot-1")).toBe(false);
    expect(() => leases.assertBotMutationAllowed("bot-1", 1)).toThrow(LeaseRejectedError);
    expect(() => leases.assertBotMutationAllowed("bot-1", 2)).toThrow(LeaseRejectedError); // human holds
  });

  it("paused never silently returns control to the Bot", () => {
    leases.giveToBot("bot-1");
    leases.pause("bot-1");
    expect(leases.get("bot-1").state).toBe("PAUSED");
    expect(() => leases.assertBotMutationAllowed("bot-1", 1)).toThrow(LeaseRejectedError);
    // Only an explicit giveToBot resumes the Bot.
    leases.giveToBot("bot-1");
    expect(leases.get("bot-1").state).toBe("BOT");
  });

  it("stale fencing is rejected", () => {
    leases.giveToBot("bot-1"); // fencing 1
    leases.giveToBot("bot-1"); // fencing 2
    expect(() => leases.assertBotMutationAllowed("bot-1", 1)).toThrow("superseded");
    expect(() => leases.assertBotMutationAllowed("bot-1", 2)).not.toThrow();
  });

  it("release returns to NONE", () => {
    leases.giveToBot("bot-1");
    const lease = leases.release("bot-1");
    expect(lease.state).toBe("NONE");
    expect(lease.holderDeviceId).toBe("");
  });

  it("read/view is blocked while a human controls", () => {
    leases.giveToBot("bot-1");
    leases.takeOver("bot-1", "device-9");
    expect(() => leases.assertViewAllowed("bot-1")).toThrow(LeaseRejectedError);
  });

  it("persists across database instances", () => {
    leases.giveToBot("bot-1");
    const second = new LeaseManager(db);
    expect(second.get("bot-1").state).toBe("BOT");
    expect(second.get("bot-1").fencing).toBe(1);
  });
});
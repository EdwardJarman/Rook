/**
 * Control lease state machine. Only one actor may mutate a page at a time.
 *
 * States: NONE -> BOT -> HUMAN -> PAUSED -> ...
 *
 * The fencing number increments on every takeover. Commands carrying a fencing
 * value lower than the current value are rejected as stale, which guarantees
 * that a human takeover invalidates every older Bot action even if the network
 * delayed them. Losing the controller connection leaves the page PAUSED rather
 * than silently returning control to the Bot.
 */
import type { LeaseRecord, LeaseState } from "../types.js";
import type { RookDatabase } from "../state/database.js";

export class LeaseRejectedError extends Error {
  constructor(
    public readonly code: "LEASE" | "STALE_FENCE",
    message: string,
  ) {
    super(message);
    this.name = "LeaseRejectedError";
  }
}

export class LeaseManager {
  constructor(private readonly db: RookDatabase) {}

  get(botId: string): LeaseRecord {
    return this.db.getLease(botId);
  }

  /** True when the Bot holds control and may run mutating actions. */
  botHoldsControl(botId: string): boolean {
    return this.db.getLease(botId).state === "BOT";
  }

  /** Human takeover: atomically pause Bot input, revoke the Bot lease, bump fencing. */
  takeOver(botId: string, deviceId: string): LeaseRecord {
    const current = this.db.getLease(botId);
    const next: LeaseRecord = {
      botId,
      state: "HUMAN",
      fencing: current.fencing + 1,
      holderDeviceId: deviceId,
      updatedAt: new Date().toISOString(),
    };
    this.db.saveLease(next);
    return next;
  }

  /** Grant the Bot control. Fences out any older commands. */
  giveToBot(botId: string): LeaseRecord {
    const current = this.db.getLease(botId);
    const next: LeaseRecord = {
      botId,
      state: "BOT",
      fencing: current.fencing + 1,
      holderDeviceId: "",
      updatedAt: new Date().toISOString(),
    };
    this.db.saveLease(next);
    return next;
  }

  /** Pause everything. Never auto-resumes to the Bot. */
  pause(botId: string): LeaseRecord {
    const current = this.db.getLease(botId);
    const next: LeaseRecord = {
      botId,
      state: "PAUSED",
      fencing: current.fencing,
      holderDeviceId: current.holderDeviceId,
      updatedAt: new Date().toISOString(),
    };
    this.db.saveLease(next);
    return next;
  }

  /** Release to NONE (device disconnected, Bot removed). */
  release(botId: string): LeaseRecord {
    const current = this.db.getLease(botId);
    const next: LeaseRecord = {
      botId,
      state: "NONE",
      fencing: current.fencing,
      holderDeviceId: "",
      updatedAt: new Date().toISOString(),
    };
    this.db.saveLease(next);
    return next;
  }

  /**
   * Validates a command's fencing claim. A Bot mutation is only allowed when:
   *   - the lease is BOT, or
   *   - the lease is NONE and this is the first Bot action (fencing 0).
   */
  assertBotMutationAllowed(botId: string, claimedFencing: number): void {
    const current = this.db.getLease(botId);
    if (current.state === "HUMAN") throw new LeaseRejectedError("LEASE", "A human is controlling this computer");
    if (current.state === "PAUSED") throw new LeaseRejectedError("LEASE", "This computer is paused");
    if (claimedFencing !== current.fencing) {
      throw new LeaseRejectedError("STALE_FENCE", "This action was superseded by a newer takeover");
    }
  }

  /** Every command — even reads — checks that control is not actively held by a human. */
  assertViewAllowed(botId: string): void {
    const current = this.db.getLease(botId);
    if (current.state === "HUMAN") throw new LeaseRejectedError("LEASE", "A human is controlling this computer");
  }

  all(): LeaseRecord[] {
    return this.db.listLeases();
  }
}
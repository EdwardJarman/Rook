import { id } from "@instantdb/admin";
import { getDb } from "../db";
import type { CreateResult, ForegroundTurnStore, TurnEvent } from "./foreground-replay";

type Row = { id: string; eventKey: string; kind: string; at: number; expiresAt: number; payload: unknown };
const toEvent = (row: Row): TurnEvent => ({
  key: row.eventKey,
  kind: row.kind as TurnEvent["kind"],
  at: row.at,
  expiresAt: row.expiresAt,
  payload: row.payload,
});

/** InstantDB-backed log. Requires the `foregroundTurnEvents` entity (`pnpm db:push`). */
export class InstantForegroundTurnStore implements ForegroundTurnStore {
  private async database() {
    const db = await getDb();
    if (!db) throw new Error("Foreground replay persistence is unavailable.");
    return db;
  }

  async list(owner: string, turn: string, now: number): Promise<TurnEvent[]> {
    const db = await this.database();
    const data = await db.query({ foregroundTurnEvents: { $: { where: { owner, turn } } } });
    const rows = data.foregroundTurnEvents as Row[];
    const live = rows.filter((row) => row.expiresAt > now);
    await this.prune(owner, now).catch(() => undefined);
    return live.map(toEvent);
  }

  async create(owner: string, turn: string, event: TurnEvent): Promise<CreateResult> {
    const db = await this.database();
    try {
      await db.transact(
        db.tx.foregroundTurnEvents[id()].create({
          eventKey: event.key,
          owner,
          turn,
          kind: event.kind,
          at: event.at,
          expiresAt: event.expiresAt,
          payload: event.payload,
        }),
      );
      return { created: true };
    } catch (error) {
      // A uniqueness violation and a transport failure look alike; only a
      // committed row with our key proves another attempt won the claim.
      const data = await db.query({ foregroundTurnEvents: { $: { where: { eventKey: event.key }, limit: 1 } } });
      const existing = (data.foregroundTurnEvents as Row[])[0];
      if (existing) return { created: false, existing: toEvent(existing) };
      throw error;
    }
  }

  private async prune(owner: string, now: number): Promise<void> {
    const db = await this.database();
    const data = await db.query({
      foregroundTurnEvents: { $: { where: { owner, expiresAt: { $lt: now } }, limit: 50 } },
    });
    const stale = data.foregroundTurnEvents as Row[];
    if (stale.length) await db.transact(stale.map((row) => db.tx.foregroundTurnEvents[row.id].delete()));
  }
}

export const instantForegroundTurnStore = new InstantForegroundTurnStore();

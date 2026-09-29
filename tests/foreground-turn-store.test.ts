import { describe, expect, it, vi } from "vitest";

type Row = { id: string; eventKey: string; owner: string; turn: string; kind: string; at: number; expiresAt: number; payload: unknown };
type Op = { op: string; id: string; data?: Omit<Row, "id"> };
const rows: Row[] = [];
let failNextTransact = false;
const fakeDb = {
  query: async (q: { foregroundTurnEvents: { $: { where: Record<string, unknown> } } }) => {
    const where = q.foregroundTurnEvents.$.where;
    return { foregroundTurnEvents: rows.filter((row) => Object.entries(where).every(([key, value]) =>
      value && typeof value === "object" && "$lt" in value
        ? ((row as Record<string, unknown>)[key] as number) < (value as { $lt: number }).$lt
        : (row as Record<string, unknown>)[key] === value)) };
  },
  transact: async (ops: Op[] | Op) => {
    if (failNextTransact) { failNextTransact = false; throw new Error("network"); }
    for (const op of Array.isArray(ops) ? ops : [ops]) {
      if (op.op === "delete") { rows.splice(rows.findIndex((row) => row.id === op.id), 1); continue; }
      if (rows.some((row) => row.eventKey === op.data!.eventKey)) throw new Error("record-not-unique");
      rows.push({ id: op.id, ...op.data! });
    }
  },
  tx: { foregroundTurnEvents: new Proxy({}, { get: (_t, id: string) => ({
    create: (data: Omit<Row, "id">) => ({ op: "create", id, data }),
    delete: () => ({ op: "delete", id }),
  }) }) },
};
vi.mock("../server/db", () => ({ getDb: async () => fakeDb }));
import { InstantForegroundTurnStore } from "../server/ai/foreground-turn-store";

const event = (key: string, expiresAt = 10_000) => ({ key, kind: "intent" as const, at: 0, expiresAt, payload: { name: "x" } });

describe("InstantForegroundTurnStore", () => {
  const store = new InstantForegroundTurnStore();

  it("creates once, reports the winner on a unique conflict, and scopes lists by owner and turn", async () => {
    expect(await store.create("alice", "t1", event("t1:intent:a"))).toEqual({ created: true });
    const lost = await store.create("alice", "t1", { ...event("t1:intent:a"), payload: { name: "y" } });
    expect(lost).toMatchObject({ created: false, existing: { payload: { name: "x" } } });
    expect(await store.list("alice", "t1", 0)).toHaveLength(1);
    expect(await store.list("bob", "t1", 0)).toHaveLength(0);
    expect(await store.list("alice", "t2", 0)).toHaveLength(0);
  });

  it("surfaces transport failures instead of claiming a conflict", async () => {
    failNextTransact = true;
    await expect(store.create("alice", "t3", event("t3:intent:a"))).rejects.toThrow("network");
  });

  it("hides expired events and prunes them", async () => {
    await store.create("alice", "t4", event("t4:intent:old", 50));
    expect(await store.list("alice", "t4", 100)).toHaveLength(0);
    expect(rows.some((row) => row.eventKey === "t4:intent:old")).toBe(false);
  });
});

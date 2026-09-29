import { describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db", () => ({ getDb: async () => mock.db }));
import { InstantJobStore } from "./store";
import type { Job } from "./model";

function database() {
  const claims = new Map<string, any>();
  const jobs = new Map<string, any>();
  const tx = Object.fromEntries(
    ["backgroundRevisions", "backgroundJobs"].map((entity) => [
      entity,
      new Proxy(
        {},
        {
          get: (_target, id) => ({
            create: (data: unknown) => ({ entity, id, data }),
            update: (data: unknown) => ({ entity, id, data }),
          }),
        },
      ),
    ]),
  );
  return {
    tx,
    claims,
    jobs,
    query: vi.fn(async (query: any) => {
      if (query.backgroundRevisions) {
        const where = query.backgroundRevisions.$.where;
        const rows = [...claims.values()]
          .filter((row) =>
            where.key ? row.key === where.key : row.owner === where.owner,
          )
          .sort((a, b) => b.revision - a.revision);
        return { backgroundRevisions: rows.slice(0, 1) };
      }
      return {
        backgroundJobs: [...jobs.values()].filter(
          (row) => row.owner === query.backgroundJobs.$.where.owner,
        ),
      };
    }),
    transact: vi.fn(async (ops: any[]) => {
      const claim = ops[0];
      if (claims.has(claim.data.key)) throw new Error("unique constraint");
      claims.set(claim.data.key, { id: claim.id, ...claim.data });
      jobs.set(ops[1].id, { id: ops[1].id, ...structuredClone(ops[1].data) });
    }),
  };
}
describe("InstantDB revision arbitration", () => {
  const job = { id: "job", owner: "owner", state: "queued" } as Job;
  it("commits reservation and payload together, with one winner across two stores", async () => {
    mock.db = database();
    const a = new InstantJobStore(),
      b = new InstantJobStore();
    expect(
      await Promise.all([
        a.commit("owner", 0, job),
        b.commit("owner", 0, { ...job, id: "other" }),
      ]),
    ).toEqual([true, false]);
    expect(await a.load("owner")).toEqual({ revision: 1, jobs: [job] });
    expect(mock.db.transact.mock.calls[0][0]).toHaveLength(2);
  });
  it("distinguishes a lost successful response from a competing reservation", async () => {
    mock.db = database();
    const transact = mock.db.transact;
    mock.db.transact = async (ops: unknown) => {
      await transact(ops);
      throw new Error("connection dropped after commit");
    };
    expect(await new InstantJobStore().commit("owner", 0, job)).toBe(true);
  });
  it("surfaces storage failure without disguising it as contention", async () => {
    mock.db = database();
    mock.db.transact.mockRejectedValue(new Error("offline"));
    await expect(new InstantJobStore().commit("owner", 0, job)).rejects.toThrow(
      "offline",
    );
    mock.db = null;
    await expect(new InstantJobStore().load("owner")).rejects.toMatchObject({
      code: "STORE_UNAVAILABLE",
    });
  });
});

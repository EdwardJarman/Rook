import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createBackgroundRouter } from "./router";
import { BackgroundRuntime, type RuntimeDeps } from "./runtime";
import { MemoryJobStore } from "./store";
import { LEASE_TTL, JOB_TTL } from "./model";
import type { TrpcContext } from "../_core/context";
const ctx = { user: { id: "owner" }, req: {}, res: {} } as TrpcContext;
const input = {
  bot: { id: "bot", name: "Scout", role: "Analyst", purpose: "Work" },
  prompt: "Read then write 42",
};
const result = {
  traceStep: { kind: "tool" as const, title: "Stub" },
  resultPayload: { value: 42 },
};
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
it("serves schedule/list/detail/recovery/approval/result through the real router", async () => {
  let now = 1000,
    checkpoint = false,
    release!: () => void;
  const hang = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reads = vi.fn(async () => result),
    writes = vi.fn(async () => result);
  const store = new MemoryJobStore();
  const run: RuntimeDeps["run"] = async (job, turn) => {
    const tool = {
      userId: job.owner,
      botId: job.bot.id,
      taskId: job.id,
      name: "github_read_file",
      rawArgs: "{}",
      excelConnected: true,
      githubConnected: true,
      computerOnline: true,
      approvals: [],
      computerProposals: [],
    };
    await turn.execute(tool, reads);
    if (!checkpoint) {
      checkpoint = true;
      await hang;
    }
    const write: Parameters<typeof turn.execute>[0] = {
      ...tool,
      name: "excel_update_range",
    };
    await turn.execute(write, async () =>
      write.prepareBackgroundApproval!(
        write.name,
        { values: [[42]] },
        "Write 42",
      ),
    );
    return { text: "Done" };
  };
  const deps: RuntimeDeps = {
    store,
    now: () => now,
    id: randomUUID,
    holder: "first",
    run,
    resolve: async (_job, _tool, guard) => {
      await guard();
      return writes();
    },
    notify: async () => true,
  };
  const first = new BackgroundRuntime(deps),
    owner = createBackgroundRouter(first).createCaller(ctx);
  const scheduled = await owner.schedule(input);
  if (!scheduled.ok) throw Error("schedule");
  const id = scheduled.value.id;
  expect(await owner.list()).toMatchObject({
    ok: true,
    value: [{ id, state: "queued" }],
  });
  const firing = first.fire("owner", id);
  for (let i = 0; i < 200 && !checkpoint; i++) await Promise.resolve();
  expect(checkpoint).toBe(true);
  const before = await owner.inspect({ id });
  if (!before.ok) throw Error("inspect");
  now += LEASE_TTL + 1;
  const recovered = new BackgroundRuntime({ ...deps, holder: "second" }),
    caller = createBackgroundRouter(recovered).createCaller(ctx);
  await recovered.fire("owner", id);
  release();
  await firing;
  const waiting = await caller.inspect({ id });
  if (!waiting.ok) throw Error("inspect");
  expect(waiting.value.state).toBe("awaiting_approval");
  expect(waiting.value.attempt.id).toBe(before.value.attempt.id);
  expect(reads).toHaveBeenCalledTimes(1);
  expect(writes).not.toHaveBeenCalled();
  const pending = waiting.value.attempt.tools.find(
    (t) => t.phase === "approval",
  )!;
  expect(
    await caller.approve({
      id,
      approvalId: pending.approval!.id,
      decision: "approve",
    }),
  ).toMatchObject({ ok: true });
  await recovered.fire("owner", id);
  const done = await caller.inspect({ id });
  if (!done.ok) throw Error("inspect");
  expect(done.value).toMatchObject({
    state: "done",
    result: { text: "Done" },
    attempt: { id: before.value.attempt.id },
  });
  expect(done.value.journal.map((e) => e.kind)).toEqual(
    expect.arrayContaining(["recovery", "grant", "result"]),
  );
  expect(reads).toHaveBeenCalledTimes(1);
  expect(writes).toHaveBeenCalledTimes(1);
  expect(
    await caller.approve({
      id,
      approvalId: pending.approval!.id,
      decision: "approve",
    }),
  ).toMatchObject({ ok: false });
});
it("exposes cancel, expiry and typed errors without pretending success", async () => {
  let now = 1000;
  const runtime = new BackgroundRuntime({
    store: new MemoryJobStore(),
    now: () => now,
    id: randomUUID,
    holder: "one",
    run: async () => ({}),
    resolve: async () => result,
    notify: async () => true,
  });
  const caller = createBackgroundRouter(runtime).createCaller(ctx);
  const first = await caller.schedule(input);
  if (!first.ok) throw Error("schedule");
  expect(await caller.cancel({ id: first.value.id })).toMatchObject({
    ok: true,
    value: { state: "cancelled" },
  });
  const second = await caller.schedule(input);
  if (!second.ok) throw Error("schedule");
  now += JOB_TTL + 1;
  await runtime.reconcile();
  expect(await caller.inspect({ id: second.value.id })).toMatchObject({
    ok: true,
    value: { state: "expired" },
  });
  expect(await caller.inspect({ id: randomUUID() })).toMatchObject({
    ok: false,
    error: { code: "NOT_FOUND" },
  });
});

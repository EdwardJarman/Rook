import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BackgroundRuntime,
  type RuntimeDeps,
  type DurableTurn,
} from "./runtime";
import { MemoryJobStore } from "./store";
import {
  ACTIVE_CAP,
  APPROVAL_TTL,
  GRANT_TTL,
  JOB_TTL,
  LEASE_TTL,
  RUN_BUDGET,
  STATES,
  JobError,
  audit,
  sanitize,
  transition,
  transitions,
  type Job,
} from "./model";
import type { executeAgentTool } from "../integrations/agent-tool-executor";

const bot = {
  id: "bot",
  name: "Bot",
  role: "Analyst",
  purpose: "Complete the supplied job",
};
const input = { bot, prompt: "Read the workbook and prepare an update." };
const tool = (name: string): Parameters<typeof executeAgentTool>[0] => ({
  userId: "owner",
  botId: bot.id,
  taskId: "task",
  name,
  rawArgs: "{}",
  excelConnected: true,
  githubConnected: true,
  computerOnline: true,
  approvals: [],
  computerProposals: [],
});
const output = {
  traceStep: { kind: "tool" as const, title: "Read" },
  resultPayload: { status: "completed", value: 42 },
};

function harness(overrides: Partial<RuntimeDeps> = {}) {
  let now = 1_000_000,
    sequence = 0;
  const store = new MemoryJobStore();
  const deps: RuntimeDeps = {
    store,
    now: () => now,
    id: () => `job-${++sequence}`,
    holder: "one",
    run: async () => ({ text: "done" }),
    resolve: vi.fn(async () => output),
    notify: vi.fn(async () => true),
    ...overrides,
  };
  return {
    deps,
    store,
    runtime: new BackgroundRuntime(deps),
    advance: (ms: number) => {
      now += ms;
    },
  };
}
async function spinUntil(test: () => boolean) {
  for (let i = 0; i < 200 && !test(); i++) await Promise.resolve();
  expect(test()).toBe(true);
}
async function approvalRun(_job: Job, turn: DurableTurn) {
  const args = tool("excel_update_range");
  await turn.execute(args, async () =>
    args.prepareBackgroundApproval!(
      args.name,
      { worksheet: "Sheet1", values: [[42]] },
      "Update Sheet1",
    ),
  );
  return { text: "Update complete" };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("detached state machine", () => {
  for (const from of STATES)
    for (const to of STATES)
      it(`${from} -> ${to}`, async () => {
        const h = harness();
        const job = await h.runtime.schedule("owner", input);
        job.state = from;
        if (transitions[from].includes(to)) {
          transition(job, to, h.deps.now(), "test");
          expect(job.state).toBe(to);
          expect(job.journal.at(-1)?.kind).toBe("transition");
        } else
          expect(() => transition(job, to, h.deps.now(), "test")).toThrow(
            JobError,
          );
      });
});
describe("background runtime", () => {
  it.each(["chatgpt:gpt-5", " opencode:big-pickle ", "ChatGPT:gpt-5", "OPENCODE:big-pickle"])("refuses interactive model %s before persistence", async (model) => {
    const h = harness();
    await expect(h.runtime.schedule("owner", { ...input, bot: { ...bot, model } })).rejects.toBeInstanceOf(JobError);
    expect(await h.runtime.list("owner")).toEqual([]);
  });
  it("claims alert delivery across runtimes and retries rejected delivery after backoff", async () => {
    const notify = vi.fn(async () => false);
    const h = harness({ run: approvalRun, notify });
    const job = await h.runtime.schedule("owner", input);
    await h.runtime.fire("owner", job.id);
    const other = new BackgroundRuntime({ ...h.deps, holder: "two" });
    await Promise.all([h.runtime.deliverAlerts(), other.deliverAlerts()]);
    expect(notify).toHaveBeenCalledTimes(1);
    await h.runtime.deliverAlerts();
    expect(notify).toHaveBeenCalledTimes(1);
    h.advance(60_000);
    notify.mockResolvedValue(true);
    await other.deliverAlerts();
    expect(notify).toHaveBeenCalledTimes(2);
    await h.runtime.deliverAlerts();
    expect(notify).toHaveBeenCalledTimes(2);
  });
  it("refuses non-executable computer proposals before asking for approval", async () => {
    const h = harness({
      run: async (_job, turn) => {
        const input = tool("computer_propose_task");
        await turn.execute(input, async () =>
          input.prepareBackgroundApproval!(
            input.name,
            { title: "Use the Computer panel" },
            "Use the Computer panel",
          ),
        );
        return {};
      },
    });
    const job = await h.runtime.schedule("owner", input);
    await h.runtime.fire("owner", job.id);
    const current = await h.runtime.inspect("owner", job.id);
    expect(current.state).toBe("failed");
    expect(current.error?.code).toBe("MANUAL_ACTION_REQUIRED");
    expect(h.deps.resolve).not.toHaveBeenCalled();
  });
  it("delays once, returns only a result, and never refires done jobs", async () => {
    const h = harness();
    const job = await h.runtime.schedule("owner", {
      ...input,
      at: h.deps.now() + 1000,
    });
    await h.runtime.fire("owner", job.id);
    expect((await h.runtime.inspect("owner", job.id)).state).toBe("queued");
    h.advance(1000);
    await h.runtime.fire("owner", job.id);
    expect((await h.runtime.inspect("owner", job.id)).result).toEqual({
      text: "done",
    });
    expect(await h.runtime.claim("owner", job.id)).toBeUndefined();
  });
  it("has one winner under lease contention and rejects stale fences", async () => {
    const h = harness();
    const second = new BackgroundRuntime({ ...h.deps, holder: "two" });
    const job = await h.runtime.schedule("owner", input);
    const claims = await Promise.all([
      h.runtime.claim("owner", job.id),
      second.claim("owner", job.id),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const first = claims.find(Boolean)!;
    h.advance(LEASE_TTL);
    const recovered = await second.claim("owner", job.id);
    expect(recovered?.fence).toBe(first.fence + 1);
    expect(recovered?.attempt.id).toBe(first.attempt.id);
    await expect(h.runtime.heartbeat(first)).rejects.toMatchObject({
      code: "STALE_FENCE",
    });
  });
  it("parks, grants once, resumes the same attempt and deduplicates approved work", async () => {
    const h = harness({ run: approvalRun });
    const job = await h.runtime.schedule("owner", input);
    await h.runtime.fire("owner", job.id);
    const pending = await h.runtime.inspect("owner", job.id);
    expect(pending.state).toBe("awaiting_approval");
    expect(h.deps.resolve).not.toHaveBeenCalled();
    await h.runtime.deliverAlerts();
    expect(h.deps.notify).toHaveBeenCalledTimes(1);
    const approval = pending.attempt.tools[0].approval!;
    await h.runtime.decide("owner", job.id, approval.id, "approve");
    await expect(
      h.runtime.decide("owner", job.id, approval.id, "approve"),
    ).rejects.toMatchObject({ code: "SCHEDULE_CONFLICT" });
    await h.runtime.fire("owner", job.id);
    const done = await h.runtime.inspect("owner", job.id);
    expect(done.state).toBe("done");
    expect(done.attempt.id).toBe(pending.attempt.id);
    expect(h.deps.resolve).toHaveBeenCalledTimes(1);
    expect(done.attempt.tools[0].phase).toBe("completed");
  });
  it.each(["deny", "timeout", "grant timeout"])(
    "handles approval %s honestly",
    async (mode) => {
      const h = harness({ run: approvalRun });
      const job = await h.runtime.schedule("owner", input);
      await h.runtime.fire("owner", job.id);
      const pending = await h.runtime.inspect("owner", job.id);
      const approval = pending.attempt.tools[0].approval!;
      if (mode === "deny")
        await h.runtime.decide(
          "owner",
          job.id,
          approval.id,
          "deny",
          "Wrong worksheet",
        );
      else if (mode === "timeout") {
        h.advance(APPROVAL_TTL);
        await h.runtime.reconcile();
      } else {
        await h.runtime.decide("owner", job.id, approval.id, "approve");
        h.advance(GRANT_TTL);
        await h.runtime.fire("owner", job.id);
      }
      const done = await h.runtime.inspect("owner", job.id);
      expect(done.state).toBe(mode === "deny" ? "failed" : "expired");
      expect(h.deps.resolve).not.toHaveBeenCalled();
      if (mode === "deny") expect(done.error?.message).toBe("Wrong worksheet");
    },
  );
  it("arbitrates concurrent approvals", async () => {
    const h = harness({ run: approvalRun });
    const job = await h.runtime.schedule("owner", input);
    await h.runtime.fire("owner", job.id);
    const pending = await h.runtime.inspect("owner", job.id);
    const approval = pending.attempt.tools[0].approval!;
    const results = await Promise.allSettled([
      h.runtime.decide("owner", job.id, approval.id, "approve"),
      h.runtime.decide("owner", job.id, approval.id, "deny"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
  it("refuses invalid intervals and distant schedules", async () => {
    const h = harness();
    await expect(
      h.runtime.schedule("owner", { ...input, intervalMs: 59_999 }),
    ).rejects.toMatchObject({ code: "INVALID_SCHEDULE" });
    await expect(
      h.runtime.schedule("owner", { ...input, at: h.deps.now() + JOB_TTL }),
    ).rejects.toMatchObject({ code: "INVALID_SCHEDULE" });
  });
  it("enforces the owner cap atomically without dropping existing jobs", async () => {
    const h = harness();
    for (let i = 0; i < ACTIVE_CAP - 1; i++)
      await h.runtime.schedule("owner", input);
    const results = await Promise.allSettled([
      h.runtime.schedule("owner", input),
      h.runtime.schedule("owner", input),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await h.runtime.list("owner")).toHaveLength(50);
    expect(await h.runtime.status("owner")).toEqual({
      jobs: 50,
      awaitingApproval: 0,
    });
  });
  it("expires every active state after a long outage", async () => {
    const h = harness({ run: approvalRun });
    const jobs = await Promise.all([
      h.runtime.schedule("owner", input),
      h.runtime.schedule("owner", input),
      h.runtime.schedule("owner", input),
    ]);
    await h.runtime.claim("owner", jobs[1].id);
    await h.runtime.fire("owner", jobs[2].id);
    h.advance(JOB_TTL);
    await new BackgroundRuntime(h.deps).reconcile();
    expect(
      (await h.runtime.list("owner")).every((j) => j.state === "expired"),
    ).toBe(true);
    expect(await h.runtime.status("owner")).toEqual({
      jobs: 0,
      awaitingApproval: 0,
    });
  });
  it("coalesces missed recurring firings and clears per-firing dedup only after success", async () => {
    const h = harness();
    const job = await h.runtime.schedule("owner", {
      ...input,
      intervalMs: 60_000,
    });
    h.advance(5 * 60_000 + 1000);
    await h.runtime.fire("owner", job.id);
    const current = await h.runtime.inspect("owner", job.id);
    expect(current.state).toBe("queued");
    expect(current.attempt.firing).toBe(2);
    expect(current.nextFireAt).toBe(job.nextFireAt + 6 * 60_000);
  });
  it("fences a crashed worker and replays completed fingerprints without duplicate dispatch", async () => {
    let reached = false;
    let release!: () => void;
    let runs = 0;
    const dispatch = vi.fn(async () => output);
    const h = harness({
      run: async (_j, turn) => {
        await turn.execute(tool("github_read_file"), dispatch);
        if (++runs === 1) {
          reached = true;
          await new Promise<void>((r) => {
            release = r;
          });
        }
        await turn.guard();
        return { text: "done" };
      },
    });
    const job = await h.runtime.schedule("owner", input);
    const oldRun = h.runtime.fire("owner", job.id);
    await spinUntil(() => reached);
    h.advance(LEASE_TTL);
    const replacement = new BackgroundRuntime({
      ...h.deps,
      holder: "replacement",
    });
    await replacement.fire("owner", job.id);
    release();
    await oldRun;
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect((await h.runtime.inspect("owner", job.id)).state).toBe("done");
  });
  it("never repeats an ambiguous side effect after a crash", async () => {
    let started = false;
    let release!: () => void;
    const resolve = vi.fn(async () => {
      started = true;
      await new Promise<void>((r) => {
        release = r;
      });
      return output;
    });
    const h = harness({ run: approvalRun, resolve });
    const job = await h.runtime.schedule("owner", input);
    await h.runtime.fire("owner", job.id);
    const pending = await h.runtime.inspect("owner", job.id);
    await h.runtime.decide(
      "owner",
      job.id,
      pending.attempt.tools[0].approval!.id,
      "approve",
    );
    const oldRun = h.runtime.fire("owner", job.id);
    await spinUntil(() => started);
    h.advance(LEASE_TTL);
    await new BackgroundRuntime({ ...h.deps, holder: "replacement" }).fire(
      "owner",
      job.id,
    );
    release();
    await oldRun;
    const current = await h.runtime.inspect("owner", job.id);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(current.error?.code).toBe("OUTCOME_UNKNOWN");
  });
  it("cancels running work before the next tool and enforces owner isolation", async () => {
    const h = harness();
    const job = await h.runtime.schedule("owner", input);
    const claim = await h.runtime.claim("owner", job.id);
    await expect(h.runtime.cancel("other", job.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await h.runtime.cancel("owner", job.id);
    await expect(h.runtime.heartbeat(claim!)).rejects.toMatchObject({
      code: "STALE_FENCE",
    });
  });
  it("bounds runtime even when the model never answers", async () => {
    const h = harness({
      now: Date.now,
      run: async () => new Promise(() => {}),
    });
    const job = await h.runtime.schedule("owner", input);
    const run = h.runtime.fire("owner", job.id);
    await vi.advanceTimersByTimeAsync(RUN_BUDGET + 1);
    await run;
    expect((await h.runtime.inspect("owner", job.id)).error?.code).toBe(
      "RUN_BUDGET",
    );
  });
  it("redacts secrets and bounds journal growth while retaining the header", async () => {
    const h = harness();
    await expect(
      h.runtime.schedule("owner", { ...input, prompt: "password: hunter2" }),
    ).rejects.toMatchObject({ code: "SECRET_INPUT" });
    expect(sanitize({ api_key: "abcdef", text: "Bearer abcdef" })).toEqual({
      api_key: "[redacted]",
      text: "[redacted]",
    });
    const job = await h.runtime.schedule("owner", input);
    for (let i = 0; i < 200; i++)
      audit(job, h.deps.now(), "event", "x".repeat(2000));
    expect(Buffer.byteLength(JSON.stringify(job.journal))).toBeLessThanOrEqual(
      128 * 1024,
    );
    expect(job.journal[0].kind).toBe("header");
  });
});

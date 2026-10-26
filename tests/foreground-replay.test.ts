import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../server/db", () => ({ listRookNodesForUser: vi.fn(async () => []) }));
vi.mock("../server/ai/fallback-router", () => ({ invokeAiResilient: vi.fn() }));
vi.mock("../server/ai/openai-stream", async (original) => ({
  ...await original<object>(), invokeAiStream: vi.fn(), supportsModelStream: () => true,
}));
vi.mock("../server/ai/agent-reliability", async (original) => ({ ...await original<object>(), backoffSleep: vi.fn() }));
vi.mock("../server/integrations/agent-tool-executor", async (original) => ({ ...await original<object>(), executeAgentTool: vi.fn() }));
import { runRookAgent, type RookAgentInput } from "../server/integrations/excel-agent";
import { runRookAgentStream } from "../server/ai/agent-stream";
import { invokeAiResilient } from "../server/ai/fallback-router";
import { invokeAiStream } from "../server/ai/openai-stream";
import { executeAgentTool } from "../server/integrations/agent-tool-executor";
import {
  FOREGROUND_TURN_TTL_MS,
  ForegroundReplay,
  MemoryForegroundTurnStore,
  turnKey,
  type CreateResult,
  type ForegroundTurnStore,
} from "../server/ai/foreground-replay";
import type { InvokeResult, ToolCall } from "../server/_core/llm";

const base: RookAgentInput = { userId: "alice", botId: "bot", taskId: "task", botName: "Scout", botRole: "helper",
  botPurpose: "Help", message: "update the sheet", recentContext: [], model: "openrouter/free" };
const call = (name: string, args: Record<string, unknown> = {}, id = "call-1"): ToolCall =>
  ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
const answer = (calls: ToolCall[] = []): InvokeResult => ({ id: "r", created: 1, model: "fixture/model",
  choices: [{ index: 0, message: { role: "assistant", content: calls.length ? "" : "Done", tool_calls: calls },
    finish_reason: calls.length ? "tool_calls" : "stop" }] });
const write = () => call("excel_update_range", { worksheet: "Sheet1", address: "A1", values: [[1]] });

type Step = InvokeResult | Error | "hang";
let steps: Step[];
let modelRequests: number;
let effects: number;
let reads: number;
let hangDispatch: boolean;
let releaseDispatch: (() => void) | undefined;

const nextStep = async (): Promise<InvokeResult> => {
  modelRequests += 1;
  const step = steps.shift();
  if (!step) throw new Error("Unexpected additional model request");
  if (step === "hang") return new Promise<InvokeResult>(() => {});
  if (step instanceof Error) throw step;
  return step;
};

beforeEach(() => {
  vi.clearAllMocks(); steps = []; modelRequests = 0; effects = 0; reads = 0; hangDispatch = false; releaseDispatch = undefined;
  vi.mocked(executeAgentTool).mockImplementation(async (toolInput) => {
    if (toolInput.name === "excel_update_range") {
      effects += 1;
      const actionId = `act-${effects}`;
      toolInput.approvals.push({ actionId, title: "Update Sheet1", detail: "A1", risk: "Medium", kind: "excel" });
      if (hangDispatch) await new Promise<void>((resolve) => { releaseDispatch = resolve; });
      return { traceStep: { kind: "tool", title: "Prepared an Excel update" },
        resultPayload: { status: "approval_required", action_id: actionId, summary: "Update Sheet1" } };
    }
    reads += 1;
    return { traceStep: { kind: "tool", title: "Checked" }, resultPayload: { status: "completed", result: "ok" } };
  });
  vi.mocked(invokeAiResilient).mockImplementation(async () => ({ result: await nextStep(), attemptedProviders: ["fixture"], fellBack: false }));
  vi.mocked(invokeAiStream).mockImplementation(async () => {
    const result = await nextStep(); const message = result.choices[0].message;
    return { text: String(message.content), toolCalls: message.tool_calls ?? [], model: result.model, finishReason: result.choices[0].finish_reason };
  });
});

// Wait for the "killed" first attempt to reach the interesting point; no fixed sleeps.
const reached = (condition: () => boolean) => vi.waitFor(() => { if (!condition()) throw new Error("not yet"); }, { timeout: 4000, interval: 5 });

describe.each(["response", "stream"] as const)("foreground durable replay (%s loop)", (mode) => {
  const run = async (store: ForegroundTurnStore, overrides: Partial<RookAgentInput> = {}, turnId: string | null = "turn-00000001") => {
    const input: RookAgentInput = { ...base, ...overrides,
      foregroundReplay: await ForegroundReplay.open({ userId: overrides.userId ?? base.userId, botId: base.botId, taskId: base.taskId, turnId: turnId ?? undefined }, { store }) };
    return mode === "response" ? runRookAgent(input) : runRookAgentStream(input, () => {});
  };

  it("kill after an approval-gated step: resume repeats no side effect and keeps the one proposal", async () => {
    const store = new MemoryForegroundTurnStore();
    steps = [answer([write()]), "hang"];
    void run(store); // simulated process death: the first attempt never finishes
    await reached(() => modelRequests >= 2);
    expect(effects).toBe(1);

    steps = [answer(), answer()];
    const resumed = await run(store);
    expect(effects).toBe(1);
    expect(resumed.text).toBe("Done");
    expect(resumed.approvals).toEqual([expect.objectContaining({ actionId: "act-1" })]);
    expect(modelRequests).toBe(3); // 2 before the kill, 1 final answer; round 0 was replayed
  });

  it("kill between claim and outcome: never re-dispatches, tells the user honestly", async () => {
    const store = new MemoryForegroundTurnStore();
    hangDispatch = true;
    steps = [answer([write()])];
    void run(store);
    await reached(() => releaseDispatch !== undefined);
    expect(effects).toBe(1);

    hangDispatch = false;
    steps = [answer([write()])]; // even if the model re-proposes it
    const resumed = await run(store);
    expect(effects).toBe(1);
    expect(resumed.text).toMatch(/may already be waiting for your approval/);
    releaseDispatch?.();
  });

  it("a concurrent duplicate attempt cannot double-dispatch", async () => {
    const store = new MemoryForegroundTurnStore();
    hangDispatch = true;
    steps = [answer([write()]), answer()];
    const first = run(store);
    await reached(() => releaseDispatch !== undefined);
    steps = [answer()]; // the duplicate replays round 0, so only the first attempt asks for the final answer
    const second = await run(store);
    expect(second.text).toMatch(/may already be waiting/);
    releaseDispatch?.();
    expect((await first).text).toBe("Done");
    expect(effects).toBe(1);
  });

  it("re-runs read-only tools without persisting their output", async () => {
    const store = new MemoryForegroundTurnStore();
    const persisted: string[] = [];
    const spy: ForegroundTurnStore = {
      list: (o, t, n) => store.list(o, t, n),
      create: (o, t, e) => { persisted.push(e.kind); return store.create(o, t, e); },
    };
    steps = [answer([call("computer_status")]), "hang"];
    void run(spy);
    await reached(() => modelRequests >= 2);
    steps = [answer(), answer()];
    await run(spy);
    expect(reads).toBe(2);
    expect(persisted).toEqual(["round"]);
  });

  it("replays a recorded tool error instead of re-dispatching", async () => {
    const store = new MemoryForegroundTurnStore();
    vi.mocked(executeAgentTool).mockRejectedValueOnce(new Error("Sheet is locked"));
    steps = [answer([write()]), "hang"];
    void run(store);
    await reached(() => modelRequests >= 2);
    vi.mocked(executeAgentTool).mockClear();
    steps = [answer(), answer()];
    expect((await run(store)).text).toBe("Done");
    expect(executeAgentTool).not.toHaveBeenCalled();
  });

  it("is inert without a turnId (foreground unchanged)", async () => {
    const store = new MemoryForegroundTurnStore();
    const spy = vi.spyOn(store, "create");
    steps = [answer([write()]), answer()];
    const result = await run(store, {}, null);
    expect(result.text).toBe("Done");
    expect(spy).not.toHaveBeenCalled();
  });

  it("fails open when the store is unavailable", async () => {
    const broken: ForegroundTurnStore = {
      list: async () => [],
      create: async (): Promise<CreateResult> => { throw new Error("db down"); },
    };
    steps = [answer([write()]), answer()];
    const result = await run(broken);
    expect(result.text).toBe("Done");
    expect(effects).toBe(1);
  });

  it("does not persist secret-bearing model rounds but still journals the outcome", async () => {
    const store = new MemoryForegroundTurnStore();
    const kinds: string[] = [];
    const spy: ForegroundTurnStore = {
      list: (o, t, n) => store.list(o, t, n),
      create: (o, t, e) => { kinds.push(e.kind); return store.create(o, t, e); },
    };
    steps = [answer([call("excel_update_range", { worksheet: "S", address: "A1", values: [["password: hunter2"]] })]), answer()];
    await run(spy);
    expect(kinds).toEqual(["intent", "done"]);
  });
});

describe("foreground replay scope and retention", () => {
  const event = (key: string, at: number) => ({ key, kind: "round" as const, at, expiresAt: at + FOREGROUND_TURN_TTL_MS, payload: {} });

  it("keys turns by owner, bot, task and turn id so nothing leaks across users", async () => {
    const ids = { botId: "bot", taskId: "task", turnId: "turn-00000001" };
    expect(turnKey({ userId: "alice", ...ids })).not.toBe(turnKey({ userId: "bob", ...ids }));
    expect(turnKey({ userId: "alice", ...ids })).not.toBe(turnKey({ userId: "alice", ...ids, botId: "other" }));
    const store = new MemoryForegroundTurnStore();
    const alice = await ForegroundReplay.open({ userId: "alice", ...ids }, { store });
    await alice!.recordRound(0, { content: "", toolCalls: [{ id: "c", type: "function", function: { name: "computer_status", arguments: "{}" } }], finishReason: "tool_calls", model: "m" });
    const bob = await ForegroundReplay.open({ userId: "bob", ...ids }, { store });
    expect(bob!.savedRound(0)).toBeUndefined();
    expect((await ForegroundReplay.open({ userId: "alice", ...ids }, { store }))!.savedRound(0)).toBeDefined();
  });

  it("rejects malformed turn ids and ignores expired events", async () => {
    const store = new MemoryForegroundTurnStore();
    expect(await ForegroundReplay.open({ userId: "a", botId: "b", taskId: "t", turnId: "../x" }, { store })).toBeUndefined();
    await store.create("a", "k", event("k:round:0", 1_000));
    expect(await store.list("a", "k", 1_000 + FOREGROUND_TURN_TTL_MS - 1)).toHaveLength(1);
    expect(await store.list("a", "k", 1_000 + FOREGROUND_TURN_TTL_MS)).toHaveLength(0);
  });

  it("adopts the canonical round when a concurrent attempt recorded first", async () => {
    const store = new MemoryForegroundTurnStore();
    const ids = { userId: "a", botId: "b", taskId: "t", turnId: "turn-00000002" };
    const one = await ForegroundReplay.open(ids, { store });
    const two = await ForegroundReplay.open(ids, { store });
    const round = (id: string) => ({ content: "", toolCalls: [{ id, type: "function" as const, function: { name: "x", arguments: "{}" } }], finishReason: null, model: "m" });
    await one!.recordRound(0, round("first"));
    expect((await two!.recordRound(0, round("second"))).toolCalls[0].id).toBe("first");
  });
});

describe("a slow or failing store never stalls chat or repeats a side effect", () => {
  const ids = { userId: "a", botId: "b", taskId: "t", turnId: "turn-00000003" };
  const never = () => new Promise<never>(() => {});
  const round = { content: "", toolCalls: [{ id: "c", type: "function" as const, function: { name: "x", arguments: "{}" } }], finishReason: null, model: "m" };

  it("open() gives up at the read deadline and the turn proceeds without durability", async () => {
    vi.useFakeTimers();
    try {
      const slow: ForegroundTurnStore = { list: never, create: never };
      const opened = ForegroundReplay.open(ids, { store: slow, deadlines: { read: 1500, write: 3000 } });
      await vi.advanceTimersByTimeAsync(1499);
      let settled = false; void opened.then(() => { settled = true; });
      await Promise.resolve(); expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await opened).toBeUndefined();
    } finally { vi.useRealTimers(); }
  });
  it("a hung round write returns the model's own round at the write deadline", async () => {
    vi.useFakeTimers();
    try {
      const replay = await ForegroundReplay.open(ids, { store: { list: async () => [], create: never }, deadlines: { read: 1500, write: 3000 } });
      const recording = replay!.recordRound(0, round);
      await vi.advanceTimersByTimeAsync(3000);
      expect(await recording).toEqual(round);
    } finally { vi.useRealTimers(); }
  });
  it("a hung claim write fails open exactly like a store error (dispatches once)", async () => {
    vi.useFakeTimers();
    try {
      const replay = await ForegroundReplay.open(ids, { store: { list: async () => [], create: never }, deadlines: { read: 1500, write: 3000 } });
      const dispatch = vi.fn(async () => ({ traceStep: { kind: "tool" as const, title: "ok" }, resultPayload: { status: "approval_required" } }));
      const running = replay!.execute({ name: "excel_update_range", rawArgs: "{}", approvals: [], computerProposals: [] }, dispatch);
      await vi.advanceTimersByTimeAsync(3000);
      await running;
      expect(dispatch).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it("when another attempt owns the step and the follow-up read fails, it is never dispatched", async () => {
    let reads = 0;
    const store: ForegroundTurnStore = {
      list: async () => { reads += 1; if (reads > 1) throw new Error("db down"); return []; },
      create: async (): Promise<CreateResult> => ({ created: false, existing: { key: "k", kind: "intent", at: 0, expiresAt: 1e15, payload: {} } }),
    };
    const replay = await ForegroundReplay.open(ids, { store });
    const dispatch = vi.fn();
    await expect(replay!.execute({ name: "excel_update_range", rawArgs: "{}", approvals: [], computerProposals: [] }, dispatch)).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
    expect(dispatch).not.toHaveBeenCalled();
    reads = 0;
    const hung: ForegroundTurnStore = { ...store, list: async () => { reads += 1; return reads > 1 ? never() : []; } };
    vi.useFakeTimers();
    try {
      const again = await ForegroundReplay.open(ids, { store: hung, deadlines: { read: 1500, write: 3000 } });
      const running = expect(again!.execute({ name: "excel_update_range", rawArgs: "{}", approvals: [], computerProposals: [] }, dispatch)).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
      await vi.advanceTimersByTimeAsync(1500);
      await running;
      expect(dispatch).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});

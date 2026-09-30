import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const outputDir = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const made = require("node:fs").mkdtempSync(require("node:path").join(require("node:os").tmpdir(), "rook-probe-test-"));
  process.env.ROOK_TOOL_OUTPUT_DIR = made;
  return made as string;
});
vi.mock("../server/db", async () => (await import("../evals/probe/mocks")).db());
vi.mock("../server/integrations/excel-tools", async (original) => (await import("../evals/probe/mocks")).excelTools(await original()));
vi.mock("../server/integrations/github-tools", async (original) => (await import("../evals/probe/mocks")).githubTools(await original()));
vi.mock("../server/integrations/computer-tools", async (original) => (await import("../evals/probe/mocks")).computerTools(await original()));
vi.mock("../server/integrations/microsoft-excel", async (original) => (await import("../evals/probe/mocks")).microsoftExcel(await original()));
vi.mock("../server/integrations/github", async (original) => (await import("../evals/probe/mocks")).github(await original()));
vi.mock("../server/integrations/cloud-computer", async (original) => (await import("../evals/probe/mocks")).cloudComputer(await original()));
vi.mock("../server/integrations/web-research", async () => (await import("../evals/probe/mocks")).webResearch());
vi.mock("../server/integrations/agent-tool-executor", async (original) => (await import("../evals/probe/mocks")).agentToolExecutor(await original()));
vi.mock("../server/ai/fallback-router", () => ({ invokeAiResilient: vi.fn() }));
vi.mock("../server/ai/agent-reliability", async (original) => ({ ...await original<object>(), backoffSleep: vi.fn() }));

import { invokeAiResilient } from "../server/ai/fallback-router";
import { observeManagedCall } from "../server/ai/request-accounting";
import { recentTurns, __resetTelemetryForTests } from "../server/ai/telemetry";
import { prepareAgentTurn, runRookAgent } from "../server/integrations/excel-agent";
import type { InvokeParams, InvokeResult, ToolCall } from "../server/_core/llm";
import { assertNumbersOnly, buildReport, createTokenSource, decideEscalation, disagreement, parseEnvOptions, preflightProblems, renderSummary, runProbe, sessionRequest, type ArmId, type EscalationInput, type ProbeOptions, type Trial } from "../evals/probe/harness";
import { BudgetExceeded, FileLedger, HARD_CAP_USD, MemoryLedger, meterHolder, meteredInvoke, parseBudget, parseRates, SpendMeter } from "../evals/probe/meter";
import { mean, pairedBootstrap, seededRng, shuffle, verdictFor, wilson } from "../evals/probe/stats";
import { TASKS } from "../evals/probe/tasks";
import { setWorld } from "../evals/probe/world";

const JWT = "aaaa1111.bbbb2222.cccc3333";
const RATES = { input: 1, cachedInput: 0.1, output: 10 };
const RATE_ENV = { ROOK_EVAL_RATE_INPUT_PER_M: "1", ROOK_EVAL_RATE_OUTPUT_PER_M: "10" };
const MODEL = "chatgpt:gpt-test";
afterAll(async () => {
  if (path.dirname(outputDir) !== path.resolve(os.tmpdir()) || !path.basename(outputDir).startsWith("rook-probe-test-")) return;
  await fs.rm(outputDir, { recursive: true, force: true });
});

describe("statistics", () => {
  it("wilson interval and bootstrap behave on known cases", () => {
    const w = wilson(8, 10);
    expect(w.p).toBe(0.8); expect(w.lo).toBeCloseTo(0.49, 2); expect(w.hi).toBeCloseTo(0.943, 2);
    expect(wilson(0, 0)).toEqual({ p: 0, lo: 0, hi: 1 });
    const constant = pairedBootstrap(Array(20).fill(-1), seededRng(1));
    expect(constant).toMatchObject({ n: 20, mean: -1, lo: -1, hi: -1 });
    expect(pairedBootstrap([], seededRng(1)).n).toBe(0);
    const mixed = pairedBootstrap([1, -1, 0, 0, 1, -1, 0, 0], seededRng(2));
    expect(mixed.lo).toBeLessThan(0); expect(mixed.hi).toBeGreaterThan(0);
  });
  it("is reproducible from a seed", () => {
    const a = seededRng(42), b = seededRng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(shuffle([1, 2, 3, 4, 5, 6], seededRng(7))).toEqual(shuffle([1, 2, 3, 4, 5, 6], seededRng(7)));
    expect([...shuffle([1, 2, 3, 4, 5, 6], seededRng(7))].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(mean([1, 2, 3])).toBe(2);
  });
  it("kills any regression beyond noise and never passes on savings or thin data", () => {
    const at = (n: number, m: number, lo: number, hi: number) => ({ n, mean: m, lo, hi });
    const noise = at(60, 0.01, -0.06, 0.08);
    const base = { margin: 0.05, minPairs: 30 };
    expect(verdictFor({ ...base, diff: at(60, -0.15, -0.25, -0.05), noise })).toBe("kill");
    expect(verdictFor({ ...base, diff: at(60, -0.08, -0.16, 0.01), noise })).toBe("kill");
    expect(verdictFor({ ...base, diff: at(60, 0, -0.04, 0.04), noise })).toBe("pass");
    expect(verdictFor({ ...base, diff: at(60, -0.03, -0.1, 0.04), noise })).toBe("inconclusive");
    expect(verdictFor({ ...base, diff: at(10, 0, -0.04, 0.04), noise })).toBe("insufficient");
    expect(verdictFor({ ...base, diff: at(60, 0, -0.04, 0.04), noise: undefined })).toBe("insufficient");
  });
});

describe("preflight, session and options", () => {
  const good = { CLERK_SECRET_KEY: "fake-clerk-secret-for-test", ROOK_EVAL_SESSION_TOKEN: JWT, ...RATE_ENV };
  it("names the problem, never the value", () => {
    expect(preflightProblems(good, MODEL)).toEqual([]);
    const problems = preflightProblems({ ...good, OPENROUTER_API_KEY: "fake-shared-provider-value", CLERK_SECRET_KEY: "" }, "gpt-5").join(" ");
    expect(problems).toMatch(/OPENROUTER_API_KEY is set/); expect(problems).toMatch(/CLERK_SECRET_KEY is required/); expect(problems).toMatch(/chatgpt:<model-slug>/);
    expect(problems).not.toContain("fake-shared-provider-value");
    expect(preflightProblems({ CLERK_SECRET_KEY: "x" }, MODEL).join(" ")).toMatch(/ROOK_EVAL_SESSION_TOKEN/);
    for (const name of ["ORCAROUTER_API_KEY", "TOKENROUTER_API_KEY"]) expect(preflightProblems({ ...good, [name]: "v" }, MODEL).join(" ")).toContain(name);
  });
  it("refreshes a command-provided token only when stale and never echoes token text", async () => {
    let clock = 0, runs = 0;
    const exec = async () => { runs += 1; return `${JWT}${runs}\n`; };
    const source = createTokenSource({ ROOK_EVAL_SESSION_TOKEN_CMD: "print-token" }, exec, () => clock, 45_000);
    expect(source.current()).toBe("");
    await source.refresh(); await source.refresh();
    expect(runs).toBe(1); expect(source.current()).toBe(`${JWT}1`);
    clock = 44_999; await source.refresh(); expect(runs).toBe(1);
    clock = 45_000; await source.refresh(); expect(runs).toBe(2);
    const bad = createTokenSource({ ROOK_EVAL_SESSION_TOKEN_CMD: "x" }, async () => "not-a-jwt SECRET-TEXT", () => 0);
    await expect(bad.refresh()).rejects.toThrow(/did not print a JWT/);
    await expect(bad.refresh()).rejects.not.toThrow(/SECRET-TEXT/);
    expect(sessionRequest(source).header("Authorization")).toBe(`Bearer ${JWT}2`);
    expect(sessionRequest(source).header("origin")).toBeUndefined();
  });
  it("validates ROOK_EVAL_* settings", () => {
    expect(parseEnvOptions({ ROOK_EVAL_MODEL: MODEL })).toMatchObject({ reps: 5, maxReps: 10, maxRequests: 3000, arms: ["baseline", "baseline_repeat", "lean_prompt", "tool_offload", "compact_plan"] });
    expect(parseEnvOptions({ ROOK_EVAL_ARMS: "baseline, all_variants", ROOK_EVAL_REPS: "5", ROOK_EVAL_TASKS: "small-talk" })).toMatchObject({ arms: ["baseline", "all_variants"], reps: 5, taskIds: ["small-talk"] });
    expect(() => parseEnvOptions({ ROOK_EVAL_REPS: "0" })).toThrow(/ROOK_EVAL_REPS/);
    expect(() => parseEnvOptions({ ROOK_EVAL_ARMS: "nope" })).toThrow(/unknown arm/);
    expect(() => parseEnvOptions({ ROOK_EVAL_OUT: "../../etc/passwd" })).toThrow(/ROOK_EVAL_OUT/);
  });
});

describe("task fixtures", () => {
  it("has unique ids, positive checks, and no task passes on an empty reply", () => {
    expect(TASKS.length).toBe(25);
    expect(new Set(TASKS.map((t) => t.id)).size).toBe(TASKS.length);
    for (const task of TASKS) {
      const passed = task.checks.filter((c) => c.pass({ text: "", calls: [], approvals: 0, proposals: 0, model: MODEL }));
      expect(passed.length, `${task.id} passes vacuously`).toBeLessThan(task.checks.length);
    }
  });
  it("the large-output fixture exceeds the inline limit with the answer outside the preview and tail", async () => {
    const task = TASKS.find((t) => t.id === "large-output")!;
    setWorld(task.world);
    const { executeGithubReadTool } = await import("../server/integrations/github-tools");
    const serialized = JSON.stringify({ status: "completed", result: await executeGithubReadTool("u", "github_read_file", { repo: "Acme/Repo", path: "src/config.ts" }) });
    const at = serialized.indexOf("RETRY_LIMIT");
    expect(serialized.length).toBeGreaterThan(14_000);
    expect(at).toBeGreaterThan(400); expect(serialized.length - at).toBeGreaterThan(1200);
  });
  it("the mid-conversation constraint really is lost under compaction and present without it", async () => {
    const task = TASKS.find((t) => t.id === "midway-constraint")!;
    setWorld(task.world);
    const turn = { userId: "eval-user", botId: "eval-x", taskId: "t", botName: "Scout", botRole: "r", botPurpose: "p", model: MODEL, message: task.message, recentContext: task.recentContext! };
    const all = JSON.stringify((await prepareAgentTurn(turn, "a")).messages);
    const compact = JSON.stringify((await prepareAgentTurn({ ...turn, variants: { compactPlan: true } }, "b")).messages);
    expect(all).toContain("Archive sheet, it is locked for audit");
    expect(compact).not.toContain("Archive sheet, it is locked for audit");
    expect(compact).toMatch(/rook-output:[a-f0-9]{32}/);
  });
});

type Behavior = (params: InvokeParams, arm: "lean" | "legacy") => InvokeResult | Error;
const reply = (text: string, calls: ToolCall[] = [], usage?: object): InvokeResult => ({ id: "r", created: 1, model: "gpt-test",
  choices: [{ index: 0, message: { role: "assistant", content: calls.length ? "" : text, tool_calls: calls }, finish_reason: calls.length ? "tool_calls" : "stop" }],
  ...(usage ? { usage } : {}) } as InvokeResult);
const USAGE = { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110, prompt_tokens_details: { cached_tokens: 40 } };
const call = (name: string, args: object, id = "c1"): ToolCall => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
const userText = (p: InvokeParams) => String([...p.messages].reverse().find((m) => m.role === "user")?.content ?? "");
const toolMessages = (p: InvokeParams) => p.messages.filter((m) => m.role === "tool").length;
let authSeen: Array<string | undefined>;
let provider = "chatgpt";
let behavior: Behavior;

let meter: SpendMeter;
beforeEach(() => {
  authSeen = []; provider = "chatgpt"; __resetTelemetryForTests(); vi.clearAllMocks();
  meter = new SpendMeter({ capUsd: HARD_CAP_USD, rates: RATES, ledger: new MemoryLedger() });
  vi.mocked(invokeAiResilient).mockImplementation(async (params, request) => meter.wrap(async () => {
    authSeen.push(request?.header("authorization"));
    const lean = String(params.messages[0].content).includes("Be a direct, warm teammate");
    const out = behavior(params, lean ? "lean" : "legacy");
    if (out instanceof Error) throw out;
    await observeManagedCall({ provider: "chatgpt", model: params.model ?? MODEL, payload: params, scope: "sdk-call" }, async () => out);
    return { result: out, attemptedProviders: [provider], fellBack: false };
  })(params, request));
});

const SENTINEL = "SENTINEL-ANSWER-TEXT";
const options = (over: Partial<ProbeOptions> = {}): ProbeOptions => ({ model: MODEL, tasks: TASKS.filter((t) => ["small-talk", "model-identity", "github-read"].includes(t.id)),
  arms: ["baseline", "baseline_repeat", "lean_prompt"], reps: 5, seed: 1, maxRequests: 500, minIntervalMs: 0, maxInvalidRate: 0.5, margin: 0.05, minPairs: 10, meter,
  sleep: async () => undefined, session: { current: () => JWT, refresh: async () => undefined }, run: runRookAgent, telemetry: () => recentTurns(1)[0], ...over });

describe("end to end through the real agent loop (scripted model, no network)", () => {
  it("measures requests, tools and tokens, kills a degraded variant, and leaks nothing", async () => {
    behavior = (params, arm) => {
      const text = userText(params);
      if (/which AI model/.test(text)) return reply(arm === "lean" ? `I am a helpful assistant. ${SENTINEL}` : `I'm gpt-test. ${SENTINEL}`, [], USAGE);
      if (/src\/util\.ts/.test(text)) {
        return toolMessages(params) ? reply(`It exports slugify and VERSION. ${SENTINEL}`, [], USAGE)
          : reply("", [call("github_read_file", { repo: "Acme/Repo", path: "src/util.ts" })], USAGE);
      }
      return reply(`Hey! ${SENTINEL}`, [], USAGE);
    };
    const report = await runProbe(options());
    assertNumbersOnly(report, [MODEL, ...TASKS.map((t) => t.id)]);
    const serialized = JSON.stringify(report);
    for (const leaked of [SENTINEL, JWT, "Bearer", "slugify", "authorization"]) expect(serialized).not.toContain(leaked);
    expect(authSeen.length).toBeGreaterThan(0);
    expect(new Set(authSeen)).toEqual(new Set([`Bearer ${JWT}`]));

    expect(report.truncated).toBe("none"); expect(report.trials).toHaveLength(45);
    const github = report.trials.find((t) => t.task === "github-read" && t.arm === "baseline")!;
    expect(github).toMatchObject({ valid: true, success: true, requests: 2, toolCalls: 1, toolErrors: 0, checksPassed: 2 });
    expect(github.tokens).toEqual({ input: 200, cachedInput: 80, output: 20, reasoning: null });
    expect(report.requestsUsed).toBe(report.trials.reduce((sum, t) => sum + t.requests, 0));
    expect(report.arms.baseline).toMatchObject({ valid: 15, successes: 15, successRate: 1 });
    expect(report.arms.lean_prompt).toMatchObject({ valid: 15, successes: 10 });
    expect(report.noise!.success).toMatchObject({ mean: 0 });
    expect(report.variants.lean_prompt!.paired.success!.mean).toBeCloseTo(-1 / 3);
    expect(report.variants.lean_prompt!.verdict).toBe("kill");
    expect(report.perTask["model-identity"].lean_prompt).toEqual({ valid: 5, successes: 0 });
  });

  it("treats provider failure and fallback as invalid (not task failure) and a doom loop as a valid failure", async () => {
    const only = (id: string) => TASKS.filter((t) => t.id === id);
    behavior = () => new Error("503 temporarily unavailable");
    const failed = await runProbe(options({ tasks: only("small-talk"), arms: ["baseline"], reps: 1 }));
    expect(failed.trials[0]).toMatchObject({ valid: false, invalid: "provider_error", success: false });

    behavior = () => reply("Hey!", [], USAGE); provider = "openrouter";
    const fell = await runProbe(options({ tasks: only("small-talk"), arms: ["baseline"], reps: 1 }));
    expect(fell.trials[0]).toMatchObject({ valid: false, invalid: "fallback_used" });
    expect(fell.arms.baseline).toMatchObject({ valid: 0, successes: 0 });

    provider = "chatgpt";
    behavior = () => reply("", [call("github_read_file", { repo: "Acme/Repo", path: "src/util.ts" })], USAGE);
    const loop = await runProbe(options({ tasks: only("github-read"), arms: ["baseline"], reps: 1 }));
    expect(loop.trials[0]).toMatchObject({ valid: true, success: false });
    expect(recentTurns(1)[0].errorCode).toBe("DOOM_LOOP");
  });

  it("stops on repeated provider failures and on the request cap", async () => {
    behavior = () => new Error("503 temporarily unavailable");
    const failing = await runProbe(options({ reps: 3 }));
    expect(failing.truncated).toBe("provider_failures"); expect(failing.trials).toHaveLength(3);

    behavior = () => reply("Hey!", [], USAGE);
    const capped = await runProbe(options({ tasks: TASKS.filter((t) => t.id === "small-talk"), arms: ["baseline"], reps: 10, maxRequests: 9 }));
    expect(capped.truncated).toBe("request_cap"); expect(capped.trials.length).toBeLessThan(10); expect(capped.requestsUsed).toBeLessThanOrEqual(9);
  });

  it("retrieves a large tool result through the real retention and authorization path", async () => {
    behavior = (params) => {
      const messages = params.messages.filter((m) => m.role === "tool").map((m) => String(m.content));
      if (!messages.length) return reply("", [call("github_read_file", { repo: "Acme/Repo", path: "src/config.ts" })], USAGE);
      const retained = JSON.parse(messages[0]) as { reference?: string };
      if (messages.length === 1 && retained.reference) return reply("", [call("read_tool_output", { reference: retained.reference, search: "RETRY_LIMIT", limit: 60 }, "c2")], USAGE);
      return reply(/RETRY_LIMIT = 7/.test(messages.at(-1) ?? "") ? "RETRY_LIMIT is 7." : "unknown", [], USAGE);
    };
    const report = await runProbe(options({ tasks: TASKS.filter((t) => t.id === "large-output"), arms: ["baseline"], reps: 1 }));
    expect(report.trials[0]).toMatchObject({ valid: true, success: true, requests: 3, toolCalls: 2, toolErrors: 0 });
  });

  it("exercises the offload arm's load_tools path and counts it", async () => {
    behavior = (params) => {
      const names = (params.tools ?? []).map((t) => t.function.name);
      if (!names.includes("load_tools")) return reply("Hey!", [], USAGE);
      const loaded = params.messages.some((m) => m.role === "tool");
      return loaded ? reply("Prepared.", [], USAGE) : reply("", [call("load_tools", { names: ["computer_propose_task"] })], USAGE);
    };
    const report = await runProbe(options({ tasks: TASKS.filter((t) => t.id === "small-talk"), arms: ["baseline", "tool_offload"], reps: 1 }));
    expect(report.trials.find((t) => t.arm === "baseline")).toMatchObject({ loadToolsCalls: 0, requests: 1 });
    expect(report.trials.find((t) => t.arm === "tool_offload")).toMatchObject({ loadToolsCalls: 1, requests: 2, toolCalls: 1 });
  });
});

describe("numbers-only guard", () => {
  const trial: Trial = { task: "small-talk", arm: "baseline", rep: 1, valid: true, invalid: null, success: true, checksPassed: 2, checksTotal: 2, requests: 1, toolCalls: 0,
    toolErrors: 0, invalidArguments: 0, skippedCalls: 0, loadToolsCalls: 0, approvals: 0, tokens: { input: 1, cachedInput: null, output: 1, reasoning: null }, latencyMs: 5, answerChars: 3, costUsd: 0.001, costEstimated: false, firstRequestChars: 100 };
  const meta = { model: MODEL, seed: 1, reps: 1, maxReps: 1, tasks: 1, requestsUsed: 1, truncated: "none" as const, margin: 0.05, minPairs: 1, escalation: null,
    budget: { capUsd: 25, ceilingUsd: 23.75, spentUsd: 0.001, runSpentUsd: 0.001, estimatedCharges: 0 } };
  it("accepts a clean report and rejects stray text, odd keys and non-finite numbers", () => {
    const report = buildReport([trial], meta);
    expect(() => assertNumbersOnly(report, [MODEL, "small-talk"])).not.toThrow();
    expect(() => assertNumbersOnly({ ...report, note: "the model said hello" }, [MODEL, "small-talk"])).toThrow(/Unexpected text/);
    expect(() => assertNumbersOnly({ ...report, "the model said hello": 1 }, [MODEL, "small-talk"])).toThrow(/Unexpected key/);
    expect(() => assertNumbersOnly({ ...report, requestsUsed: Number.NaN }, [MODEL, "small-talk"])).toThrow(/Non-finite/);
    expect(() => assertNumbersOnly(report, [])).toThrow();
  });
  it("only ever labels arms it ran", () => {
    const report = buildReport([trial], meta);
    expect(Object.keys(report.arms)).toEqual(["baseline"]); expect(report.variants).toEqual({}); expect(report.noise).toBeNull();
    const arm: ArmId = "baseline"; expect(report.arms[arm]!.meanInputTokens).toBe(1);
  });
});

const tmpDirs: string[] = [];
afterAll(async () => {
  for (const dir of tmpDirs) {
    if (path.dirname(dir) !== path.resolve(os.tmpdir()) || !path.basename(dir).startsWith("rook-ledger-test-")) continue;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe("spend meter: the hard cap", () => {
  const params = { model: MODEL, messages: [{ role: "user" as const, content: "x".repeat(300) }] } as InvokeParams;
  const ok = (usage?: object) => async () => ({ result: reply("ok", [], usage), attemptedProviders: ["chatgpt"], fellBack: false });
  const fresh = (capUsd = 5, ledger = new MemoryLedger()) => new SpendMeter({ capUsd, rates: RATES, ledger });
  const BIG = { prompt_tokens: 100_000, completion_tokens: 2000, total_tokens: 102_000 };

  it("charges actual usage at the cached rate with a 10% safety factor", async () => {
    const m = fresh();
    await m.wrap(ok(USAGE))(params);
    expect(m.spentUsd()).toBeCloseTo(((60 * 1 + 40 * 0.1 + 10 * 10) / 1_000_000) * 1.1, 12);
    expect(m.estimatedCharges()).toBe(0);
  });
  it("charges unknown cached tokens as uncached and estimates missing usage, counting it", async () => {
    const a = fresh(); await a.wrap(ok({ prompt_tokens: 100, completion_tokens: 10 }))(params);
    expect(a.spentUsd()).toBeCloseTo(((100 + 10 * 10) / 1_000_000) * 1.1, 12);
    const b = fresh(); await b.wrap(ok(undefined))(params);
    expect(b.estimatedCharges()).toBe(1); expect(b.spentUsd()).toBeGreaterThan(0);
  });
  it("charges a failed request its estimated input and rethrows", async () => {
    const m = fresh();
    await expect(m.wrap(async () => { throw new Error("stream cut"); })(params)).rejects.toThrow("stream cut");
    expect(m.spentUsd()).toBeGreaterThan(0); expect(m.requests()).toBe(1);
  });
  it("refuses before calling the provider when the reserve does not fit, and flags the trip", async () => {
    const m = fresh(0.01); const invoke = vi.fn(ok(USAGE));
    await expect(m.wrap(invoke)(params)).rejects.toBeInstanceOf(BudgetExceeded);
    expect(invoke).not.toHaveBeenCalled(); expect(m.tripped()).toBe(true); expect(m.spentUsd()).toBe(0);
    m.clearTrip(); expect(m.tripped()).toBe(false);
  });
  it("never lets spend pass the ceiling however the requests run", async () => {
    const m = fresh(0.5); let calls = 0;
    const invoke = async () => { calls += 1; return (await ok(BIG)()); };
    for (let i = 0; i < 12; i += 1) {
      try { await m.wrap(invoke)(params); } catch (error) { expect(error).toBeInstanceOf(BudgetExceeded); }
      expect(m.spentUsd()).toBeLessThanOrEqual(m.ceilingUsd);
    }
    expect(calls).toBe(3); expect(m.ceilingUsd).toBeCloseTo(0.475, 10); expect(m.spentUsd()).toBeLessThanOrEqual(0.5);
  });
  it("writes the reservation before the call and settles it after, so a crash still counts", async () => {
    const ledger = new MemoryLedger(); const m = fresh(5, ledger); let during = 0;
    await m.wrap(async () => { during = ledger.read().pendingUsd; return ok(USAGE)(); })(params);
    expect(during).toBeGreaterThan(0); expect(ledger.read().pendingUsd).toBe(0); expect(ledger.read().requests).toBe(1);
    const crashed = new MemoryLedger({ spentUsd: 1, pendingUsd: 2, requests: 5 });
    expect(fresh(5, crashed).spentUsd()).toBe(3);
  });
  it("is cumulative across runs through the ledger file, and refuses a corrupt ledger", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "rook-ledger-test-")); tmpDirs.push(dir);
    const file = path.join(dir, "spend.json");
    const first = new SpendMeter({ capUsd: 5, rates: RATES, ledger: new FileLedger(file) });
    await first.wrap(ok(BIG))(params);
    const second = new SpendMeter({ capUsd: 5, rates: RATES, ledger: new FileLedger(file) });
    expect(second.spentUsd()).toBeCloseTo(first.spentUsd(), 10); expect(second.requests()).toBe(1);
    await fs.writeFile(file, "{not json");
    expect(() => new SpendMeter({ capUsd: 5, rates: RATES, ledger: new FileLedger(file) })).toThrow();
    await fs.writeFile(file, JSON.stringify({ spentUsd: -1, pendingUsd: 0, requests: 0 }));
    expect(() => new SpendMeter({ capUsd: 5, rates: RATES, ledger: new FileLedger(file) })).toThrow(/corrupt/);
  });
  it("can lower the cap but never raise it above the hard cap", () => {
    expect(HARD_CAP_USD).toBe(25);
    expect(parseBudget({})).toBe(25); expect(parseBudget({ ROOK_EVAL_BUDGET_USD: "10" })).toBe(10);
    for (const bad of ["26", "0", "-1", "abc", "Infinity"]) expect(() => parseBudget({ ROOK_EVAL_BUDGET_USD: bad })).toThrow(/ROOK_EVAL_BUDGET_USD/);
    expect(() => new SpendMeter({ capUsd: 26, rates: RATES, ledger: new MemoryLedger() })).toThrow();
    expect(() => new SpendMeter({ capUsd: 0, rates: RATES, ledger: new MemoryLedger() })).toThrow();
  });
  it("requires an operator-supplied rate snapshot and defaults cached to the input rate", () => {
    expect(parseRates(RATE_ENV)).toEqual({ input: 1, cachedInput: 1, output: 10 });
    expect(parseRates({ ...RATE_ENV, ROOK_EVAL_RATE_CACHED_PER_M: "0.25" }).cachedInput).toBe(0.25);
    expect(() => parseRates({ ROOK_EVAL_RATE_OUTPUT_PER_M: "10" })).toThrow(/ROOK_EVAL_RATE_INPUT_PER_M is required/);
    expect(() => parseRates({ ROOK_EVAL_RATE_INPUT_PER_M: "1" })).toThrow(/ROOK_EVAL_RATE_OUTPUT_PER_M is required/);
    expect(() => parseRates({ ...RATE_ENV, ROOK_EVAL_RATE_INPUT_PER_M: "-3" })).toThrow(/ROOK_EVAL_RATE_INPUT_PER_M/);
    expect(preflightProblems({ CLERK_SECRET_KEY: "x", ROOK_EVAL_SESSION_TOKEN: JWT }, MODEL).join(" ")).toMatch(/ROOK_EVAL_RATE_INPUT_PER_M is required/);
    expect(preflightProblems({ CLERK_SECRET_KEY: "x", ROOK_EVAL_SESSION_TOKEN: JWT, ...RATE_ENV, ROOK_EVAL_BUDGET_USD: "30" }, MODEL).join(" ")).toMatch(/ROOK_EVAL_BUDGET_USD/);
  });
  it("fails closed: with no meter installed the router wrapper makes no provider call", async () => {
    const actual = vi.fn(ok(USAGE)); const wrapped = meteredInvoke(actual);
    meterHolder.current = undefined;
    expect(() => wrapped(params)).toThrow(/No spend meter/); expect(actual).not.toHaveBeenCalled();
    meterHolder.current = fresh();
    try { await wrapped(params); expect(actual).toHaveBeenCalledTimes(1); } finally { meterHolder.current = undefined; }
  });
});

describe("escalation gate: more repetitions only when they would be decisive", () => {
  const iv = (mean: number, lo: number, hi: number, n = 100) => ({ n, mean, lo, hi });
  const input = (over: Partial<EscalationInput> = {}): EscalationInput => ({ enabled: true, truncated: "none", repsRun: 5, maxReps: 10, margin: 0.05, minPairs: 30, tasks: 20,
    noise: iv(0, -0.09, 0.09), variants: [{ arm: "lean_prompt", verdict: "inconclusive", diff: iv(0, -0.07, 0.07), disagreement: 0.2 }],
    costPerTrialUsd: 0.02, armsInNextPhase: (arms) => arms.length + 2, remainingUsd: 20, ...over });

  it("stops for every reason that is not a data reason", () => {
    expect(decideEscalation(input({ enabled: false }))).toMatchObject({ decision: "stop", reason: "disabled" });
    expect(decideEscalation(input({ repsRun: 10 }))).toMatchObject({ decision: "stop", reason: "max_reps_reached" });
    expect(decideEscalation(input({ truncated: "budget_cap" }))).toMatchObject({ decision: "stop", reason: "phase1_truncated" });
    expect(decideEscalation(input({ noise: undefined }))).toMatchObject({ decision: "stop", reason: "noise_unmeasured" });
    expect(decideEscalation(input({ noise: iv(0, -1, 1, 5) }))).toMatchObject({ reason: "noise_unmeasured" });
  });
  it("does not spend on arms that are already decided", () => {
    const decided = decideEscalation(input({ variants: [{ arm: "lean_prompt", verdict: "kill", diff: iv(-0.2, -0.3, -0.1), disagreement: 0.3 },
      { arm: "tool_offload", verdict: "pass", diff: iv(0, -0.02, 0.02), disagreement: 0.02 }] }));
    expect(decided).toMatchObject({ decision: "stop", reason: "no_undecided_variant" });
  });
  it("refuses noise-chasing: a wide interval that even 10 reps could not decide", () => {
    const hopeless = decideEscalation(input({ variants: [{ arm: "lean_prompt", verdict: "inconclusive", diff: iv(-0.03, -0.12, 0.06), disagreement: 0.25 }] }));
    expect(hopeless).toMatchObject({ decision: "stop", reason: "noise_cannot_resolve", undecidedArms: ["lean_prompt"], resolvableArms: [] });
  });
  it("goes when the projected interval would reach a pass, or a kill", () => {
    const toPass = decideEscalation(input());
    expect(toPass).toMatchObject({ decision: "go", reason: "go", resolvableArms: ["lean_prompt"] });
    expect(toPass.projectedCostUsd).toBeCloseTo(5 * 20 * 3 * 0.02 * 1.25, 10);
    const toKill = decideEscalation(input({ variants: [{ arm: "tool_offload", verdict: "inconclusive", diff: iv(-0.08, -0.19, 0.03), disagreement: 0.2 }] }));
    expect(toKill).toMatchObject({ decision: "go", resolvableArms: ["tool_offload"] });
  });
  it("only escalates the arms that can be resolved", () => {
    const mixed = decideEscalation(input({ variants: [{ arm: "lean_prompt", verdict: "inconclusive", diff: iv(0, -0.07, 0.07), disagreement: 0.2 },
      { arm: "compact_plan", verdict: "inconclusive", diff: iv(-0.03, -0.12, 0.06), disagreement: 0.25 }] }));
    expect(mixed).toMatchObject({ decision: "go", resolvableArms: ["lean_prompt"], undecidedArms: ["lean_prompt", "compact_plan"] });
  });
  it("declines when the projected extra cost does not fit the remaining budget, and reports reps needed", () => {
    const poor = decideEscalation(input({ remainingUsd: 1 }));
    expect(poor).toMatchObject({ decision: "stop", reason: "over_budget", resolvableArms: ["lean_prompt"] });
    expect(poor.projectedCostUsd).toBeGreaterThan(1);
    expect(decideEscalation(input({ variants: [{ arm: "lean_prompt", verdict: "inconclusive", diff: iv(0, -0.07, 0.07), disagreement: 0.2 }] })).repsNeededForPass).toBe(16);
    expect(decideEscalation(input({ variants: [{ arm: "lean_prompt", verdict: "inconclusive", diff: iv(0, -0.07, 0.07), disagreement: 0.1 }] })).repsNeededForPass).toBe(8);
  });
  it("measures disagreement over matched valid pairs only", () => {
    const t = (arm: ArmId, rep: number, success: boolean, valid = true): Trial => ({ ...baseTrial, arm, rep, success, valid });
    expect(disagreement([t("baseline", 1, true), t("lean_prompt", 1, false), t("baseline", 2, true), t("lean_prompt", 2, true), t("baseline", 3, true), t("lean_prompt", 3, false, false)], "lean_prompt", "baseline")).toBe(0.5);
    expect(disagreement([], "lean_prompt", "baseline")).toBe(0);
  });
});

const baseTrial: Trial = { task: "small-talk", arm: "baseline", rep: 1, valid: true, invalid: null, success: true, checksPassed: 2, checksTotal: 2, requests: 1, toolCalls: 0, toolErrors: 0,
  invalidArguments: 0, skippedCalls: 0, loadToolsCalls: 0, approvals: 0, tokens: { input: 100, cachedInput: 40, output: 10, reasoning: null }, latencyMs: 5, answerChars: 3, costUsd: 0.001, costEstimated: false, firstRequestChars: 100 };

describe("budget, phases and scoreboard through the real loop (scripted model)", () => {
  const tasks = TASKS.filter((t) => ["small-talk", "model-identity", "github-read"].includes(t.id));
  const LEAN_USAGE = { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60, prompt_tokens_details: { cached_tokens: 20 } };
  /** Scripted model whose token use and quality depend on the arm, read from the system prompt like production would. */
  const scripted = (opts: { leanUsage?: object | null; leanFailsIdentity?: boolean } = {}): Behavior => (params, arm) => {
    const text = userText(params);
    const usage = arm === "lean" ? (opts.leanUsage === undefined ? LEAN_USAGE : opts.leanUsage ?? undefined) : USAGE;
    if (/which AI model/.test(text)) return reply(arm === "lean" && opts.leanFailsIdentity ? "I am an assistant." : "I'm gpt-test.", [], usage);
    if (/src\/util\.ts/.test(text)) return toolMessages(params) ? reply("It exports slugify and VERSION.", [], usage) : reply("", [call("github_read_file", { repo: "Acme/Repo", path: "src/util.ts" })], usage);
    return reply("Hey!", [], usage);
  };
  const phased = (over: Partial<ProbeOptions> = {}) => options({ tasks, arms: ["baseline", "baseline_repeat", "lean_prompt"], reps: 3, minPairs: 4, ...over });

  it("ships a variant only with measured success parity AND a demonstrated saving", async () => {
    behavior = scripted();
    const report = await runProbe(phased());
    const row = report.scoreboard.find((r) => r.arm === "lean_prompt")!;
    expect(row).toMatchObject({ verdict: "pass", decision: "ship", reasons: [], pairs: 9, matchedSuccessBaseline: 1, matchedSuccessVariant: 1 });
    expect(row.costSavingPct).toBeCloseTo(32 / 164, 8); expect(row.costDiff.hi).toBeLessThan(0);
    expect(row.inputTokenSavingPct).toBeCloseTo(0.5, 10);
    expect(report.budget.spentUsd).toBeCloseTo(report.trials.reduce((sum, t) => sum + t.costUsd, 0), 10);
    assertNumbersOnly(report, [MODEL, ...TASKS.map((t) => t.id)]);
    expect(renderSummary(report)).toMatch(/lean_prompt: SHIP/);
  });
  it("never ships a cheaper variant that regressed success", async () => {
    behavior = scripted({ leanFailsIdentity: true });
    const row = (await runProbe(phased())).scoreboard.find((r) => r.arm === "lean_prompt")!;
    expect(row.costSavingPct).toBeCloseTo(32 / 164, 8);
    expect(row).toMatchObject({ verdict: "kill", decision: "no-ship" }); expect(row.reasons).toContain("success_regression");
    expect(row.matchedSuccessVariant).toBeLessThan(row.matchedSuccessBaseline);
  });
  it("does not ship parity without a saving, nor a saving priced mostly from estimates", async () => {
    behavior = scripted({ leanUsage: USAGE });
    const same = (await runProbe(phased())).scoreboard.find((r) => r.arm === "lean_prompt")!;
    expect(same).toMatchObject({ verdict: "pass", decision: "no-ship" }); expect(same.reasons).toEqual(["saving_not_demonstrated"]);
    behavior = scripted({ leanUsage: null });
    vi.mocked(invokeAiResilient).mockClear();
    const blind = (await runProbe(phased({ arms: ["baseline", "baseline_repeat", "lean_prompt"] }))).scoreboard.find((r) => r.arm === "lean_prompt")!;
    expect(blind.estimatedCostShare).toBe(1); expect(blind.reasons).toContain("cost_mostly_estimated"); expect(blind.decision).toBe("no-ship");
  });
  it("stops at the dollar cap mid-run without passing it, and records why", async () => {
    meter = new SpendMeter({ capUsd: 0.5, rates: RATES, ledger: new MemoryLedger() });
    const BIG = { prompt_tokens: 100_000, completion_tokens: 2000, total_tokens: 102_000 };
    let providerCalls = 0;
    vi.mocked(invokeAiResilient).mockImplementation(meter.wrap(async () => { providerCalls += 1; return { result: reply("Hey!", [], BIG), attemptedProviders: ["chatgpt"], fellBack: false }; }));
    const report = await runProbe(options({ tasks: TASKS.filter((t) => t.id === "small-talk"), arms: ["baseline"], reps: 10, meter }));
    expect(report.truncated).toBe("budget_cap");
    expect(report.budget.spentUsd).toBeLessThanOrEqual(report.budget.ceilingUsd); expect(report.budget.ceilingUsd).toBeLessThan(report.budget.capUsd);
    expect(providerCalls).toBeGreaterThan(0); expect(providerCalls).toBeLessThan(10);
    const before = providerCalls;
    await runProbe(options({ tasks: TASKS.filter((t) => t.id === "small-talk"), arms: ["baseline"], reps: 10, meter }));
    expect(providerCalls).toBe(before);
    expect(meter.spentUsd()).toBeLessThanOrEqual(0.5);
  });
  it("marks a trial cut by the cap as invalid (budget), never as a failure", async () => {
    meter = new SpendMeter({ capUsd: 0.05, rates: RATES, ledger: new MemoryLedger() });
    const invoke = vi.fn(async () => ({ result: reply("Hey!", [], USAGE), attemptedProviders: ["chatgpt"], fellBack: false }));
    vi.mocked(invokeAiResilient).mockImplementation(meter.wrap(invoke));
    const report = await runProbe(options({ tasks: TASKS.filter((t) => t.id === "small-talk"), arms: ["baseline"], reps: 1, meter }));
    expect(invoke).not.toHaveBeenCalled();
    expect(report.trials[0]).toMatchObject({ valid: false, invalid: "budget", success: false }); expect(report.truncated).toBe("budget_cap");
    expect(report.arms.baseline).toMatchObject({ valid: 0, successes: 0 });
  });
  it("stops after phase one when every variant is decided, and runs only repetitions that are scheduled", async () => {
    behavior = scripted({ leanFailsIdentity: true });
    const report = await runProbe(phased({ reps: 2, maxReps: 4 }));
    expect(report.escalation).toMatchObject({ decision: "stop", reason: "no_undecided_variant", repsRun: 2, maxReps: 4 });
    expect(report.trials).toHaveLength(2 * 3 * 3); expect(new Set(report.trials.map((t) => t.rep))).toEqual(new Set([1, 2]));
  });
  it("on a go, runs reps up to the max for baselines and resolvable arms only, each pairing exactly once", async () => {
    behavior = scripted();
    const decide = vi.fn((x: EscalationInput) => ({ ...decideEscalation(x), decision: "go" as const, reason: "go" as const, resolvableArms: ["lean_prompt" as const] }));
    const report = await runProbe(phased({ arms: ["baseline", "baseline_repeat", "lean_prompt", "tool_offload"], reps: 2, maxReps: 4, decide }));
    expect(decide).toHaveBeenCalledTimes(1);
    const keys = report.trials.map((t) => `${t.task}|${t.arm}|${t.rep}`);
    expect(new Set(keys).size).toBe(keys.length);
    const phase2 = report.trials.filter((t) => t.rep > 2);
    expect(new Set(phase2.map((t) => t.arm))).toEqual(new Set(["baseline", "baseline_repeat", "lean_prompt"]));
    expect(report.trials.filter((t) => t.rep <= 2)).toHaveLength(2 * 3 * 4); expect(phase2).toHaveLength(2 * 3 * 3);
    expect(report.arms.tool_offload!.trials).toBe(2 * 3);
    expect(report.escalation).toMatchObject({ decision: "go", resolvableArms: ["lean_prompt"] });
  });
  it("keeps a repetition's order independent of how many reps were planned", async () => {
    behavior = scripted();
    const order = async (maxReps: number) => (await runProbe(phased({ reps: 2, maxReps, decide: (x) => ({ ...decideEscalation(x), decision: "stop" as const }) })))
      .trials.filter((t) => t.rep === 1).map((t) => `${t.task}|${t.arm}`);
    expect(await order(2)).toEqual(await order(6));
  });
});

describe("history tasks and exposure-aware scoring", () => {
  // marker: the critical fact; beyond: whether it sits past the ledger's 160-character line cut in the oldest turn.
  const HISTORY: Record<string, { marker: string; beyond: boolean }> = {
    "midway-constraint": { marker: "Archive sheet, it is locked for audit", beyond: true },
    "history-format-csv": { marker: "never JSON", beyond: true },
    "history-never-email": { marker: "never send emails", beyond: false },
    "history-budget-cap": { marker: "500 dollars", beyond: true },
    "history-project-name": { marker: "Falcon", beyond: true },
    "history-goal-short": { marker: "billing service", beyond: false },
  };
  const turnFor = (id: string, variants: object = {}) => {
    const task = TASKS.find((t) => t.id === id)!;
    setWorld(task.world);
    return { task, input: { userId: "eval-user", botId: `eval-${id}`, taskId: "t", botName: "Scout", botRole: "r", botPurpose: "p", model: MODEL, message: task.message,
      recentContext: task.recentContext!, variants } };
  };

  it("keeps every older turn for the baseline and places the critical fact where the task says it is", async () => {
    for (const [id, { marker, beyond }] of Object.entries(HISTORY)) {
      const { task, input } = turnFor(id);
      expect(task.recentContext, id).toHaveLength(8);
      expect(task.recentContext!.every((entry) => entry.body.length <= 2000)).toBe(true);
      const at = task.recentContext![0].body.indexOf(marker);
      expect(at, `${id} marker missing`).toBeGreaterThanOrEqual(0);
      beyond ? expect(at, id).toBeGreaterThanOrEqual(150) : expect(at, id).toBeLessThan(140);
      expect(JSON.stringify((await prepareAgentTurn(input, "a")).messages), `${id} baseline lost the fact`).toContain(marker);
    }
  });
  it("compaction drops the turn holding the fact, and its ledger keeps the fact only when it is inside the 160-character cut", async () => {
    for (const [id, { marker, beyond }] of Object.entries(HISTORY)) {
      const { input } = turnFor(id, { compactPlan: true });
      const compact = await prepareAgentTurn(input, "b");
      const all = JSON.stringify(compact.messages);
      expect(all.includes(marker), `${id} survives=${!beyond}`).toBe(!beyond);
      expect(String(compact.messages[1].content)).toMatch(/condensed so this turn fits/);
      expect(compact.messages.length).toBeLessThan(2 + 8 + 1);
    }
  });

  const VISIBLE = (params: InvokeParams, marker: string) => JSON.stringify(params.messages).includes(marker);
  const HISTORY_TASKS = ["history-format-csv", "history-never-email", "history-budget-cap", "history-project-name", "history-goal-short", "small-talk", "model-identity", "github-read"];
  /** A model that honours a constraint exactly when it can see it, which is the loss mechanism compaction risks. */
  const faithful: Behavior = (params) => {
    const text = userText(params);
    if (/which AI model/.test(text)) return reply("I'm gpt-test.", [], USAGE);
    if (/src\/util\.ts/.test(text)) return toolMessages(params) ? reply("It exports slugify and VERSION.", [], USAGE) : reply("", [call("github_read_file", { repo: "Acme/Repo", path: "src/util.ts" })], USAGE);
    if (/export format/.test(text)) return reply(VISIBLE(params, "never JSON") ? "I'll write it as CSV." : "Here you go: ```json", [], USAGE);
    if (/vendor/.test(text)) return reply(VISIBLE(params, "never send emails") ? "Here is a draft for you to review." : "I sent the email to the vendor.", [], USAGE);
    if (/hotel plan/.test(text)) return reply(VISIBLE(params, "500 dollars") ? "A plan within your 500 dollar budget." : "Plan: a luxury suite.", [], USAGE);
    if (/status update/.test(text)) return reply(VISIBLE(params, "Falcon") ? "Falcon status: on track." : "Status: on track.", [], USAGE);
    if (/what comes next/.test(text)) return reply(VISIBLE(params, "billing service") ? "Next: the billing schema." : "Not sure what you mean.", [], USAGE);
    return reply("Hey!", [], USAGE);
  };
  const run = (over: Partial<ProbeOptions> = {}) => runProbe(options({ tasks: TASKS.filter((t) => HISTORY_TASKS.includes(t.id)), arms: ["baseline", "baseline_repeat", "compact_plan"], reps: 3, minPairs: 10, ...over }));

  it("judges compaction on the pairs it changed, so untouched tasks cannot dilute a regression into a pass", async () => {
    behavior = faithful;
    const row = (await run()).scoreboard.find((r) => r.arm === "compact_plan")!;
    expect(row.exposedPairs).toBe(5 * 3); expect(row.pairs).toBe(8 * 3);
    expect(row.successDiff.mean).toBeCloseTo(-3 / 5, 10);
    expect(row.suiteSuccessDiff.mean).toBeCloseTo(-9 / 24, 10);
    expect(Math.abs(row.suiteSuccessDiff.mean)).toBeLessThan(Math.abs(row.successDiff.mean));
    expect(row).toMatchObject({ verdict: "kill", decision: "no-ship" }); expect(row.reasons).toContain("success_regression");
    expect(row.matchedSuccessBaseline).toBe(1); expect(row.matchedSuccessVariant).toBeCloseTo(2 / 5, 10);
  });
  it("needs enough exposed pairs: too few is insufficient data, never a ship", async () => {
    behavior = (params, arm) => reply(VISIBLE(params, "never JSON") || !/export format/.test(userText(params)) ? (faithful(params, arm) as InvokeResult).choices[0].message.content as string : "I'll write it as CSV.", [], USAGE);
    const row = (await run({ reps: 2, minPairs: 12 })).scoreboard.find((r) => r.arm === "compact_plan")!;
    expect(row.exposedPairs).toBe(10);
    expect(row.verdict).toBe("insufficient"); expect(row.decision).toBe("no-ship"); expect(row.reasons).toContain("insufficient_data");
  });
  it("treats a variant that changes every request as fully exposed", async () => {
    behavior = (params, arm) => faithful(params, arm);
    const report = await runProbe(options({ tasks: TASKS.filter((t) => ["small-talk", "model-identity"].includes(t.id)), arms: ["baseline", "baseline_repeat", "lean_prompt"], reps: 3, minPairs: 4 }));
    const row = report.scoreboard.find((r) => r.arm === "lean_prompt")!;
    expect(row.exposedPairs).toBe(row.pairs); expect(row.exposedPairs).toBe(6);
    expect(row.successDiff).toEqual(row.suiteSuccessDiff);
  });

  it("kills on the exposed pairs even when the suite-wide numbers would have passed (dilution)", () => {
    const tasks = Array.from({ length: 25 }, (_, i) => `t${i}`);
    const make = (arm: ArmId, rep: number, task: string, success: boolean, chars = 100): Trial => ({ ...baseTrial, task, arm, rep, success, firstRequestChars: chars });
    const trials: Trial[] = [];
    for (let rep = 1; rep <= 5; rep += 1) {
      tasks.forEach((task, i) => {
        const exposed = i < 2;
        trials.push(make("baseline", rep, task, true));
        // Noise: baseline_repeat flips three unexposed pairs, widening the suite-wide noise interval.
        trials.push(make("baseline_repeat", rep, task, !(rep <= 3 && i === 10 + rep)));
        // The variant touches only t0 and t1 and breaks two of those ten pairs; every other pair is untouched and identical.
        trials.push(make("compact_plan", rep, task, !(exposed && rep === 1), exposed ? 90 : 100));
      });
    }
    const meta = { model: MODEL, seed: 7, reps: 5, maxReps: 5, tasks: 25, requestsUsed: 0, truncated: "none" as const, margin: 0.05, minPairs: 10, escalation: null,
      budget: { capUsd: 25, ceilingUsd: 23.75, spentUsd: 0, runSpentUsd: 0, estimatedCharges: 0 } };
    const report = buildReport(trials, meta);
    const row = report.scoreboard.find((r) => r.arm === "compact_plan")!;
    expect(row.exposedPairs).toBe(10); expect(row.pairs).toBe(125);
    expect(row.successDiff.mean).toBeCloseTo(-0.2, 10); expect(row.suiteSuccessDiff.mean).toBeCloseTo(-2 / 125, 10);
    // Judged suite-wide, this regression would have been waved through.
    expect(verdictFor({ diff: row.suiteSuccessDiff, noise: report.noise!.success, margin: 0.05, minPairs: 10 })).toBe("pass");
    expect(row).toMatchObject({ verdict: "kill", decision: "no-ship" }); expect(row.reasons).toContain("success_regression");
  });
});


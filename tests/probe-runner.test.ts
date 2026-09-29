import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
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
import { assertNumbersOnly, buildReport, createTokenSource, parseEnvOptions, preflightProblems, runProbe, sessionRequest, type ArmId, type ProbeOptions, type Trial } from "../evals/probe/harness";
import { mean, pairedBootstrap, seededRng, shuffle, verdictFor, wilson } from "../evals/probe/stats";
import { TASKS } from "../evals/probe/tasks";
import { setWorld } from "../evals/probe/world";

const JWT = "aaaa1111.bbbb2222.cccc3333";
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
  const good = { CLERK_SECRET_KEY: "fake-clerk-secret-for-test", ROOK_EVAL_SESSION_TOKEN: JWT };
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
    expect(parseEnvOptions({ ROOK_EVAL_MODEL: MODEL })).toMatchObject({ reps: 3, maxRequests: 900, arms: ["baseline", "baseline_repeat", "lean_prompt", "tool_offload", "compact_plan"] });
    expect(parseEnvOptions({ ROOK_EVAL_ARMS: "baseline, all_variants", ROOK_EVAL_REPS: "5", ROOK_EVAL_TASKS: "small-talk" })).toMatchObject({ arms: ["baseline", "all_variants"], reps: 5, taskIds: ["small-talk"] });
    expect(() => parseEnvOptions({ ROOK_EVAL_REPS: "0" })).toThrow(/ROOK_EVAL_REPS/);
    expect(() => parseEnvOptions({ ROOK_EVAL_ARMS: "nope" })).toThrow(/unknown arm/);
    expect(() => parseEnvOptions({ ROOK_EVAL_OUT: "../../etc/passwd" })).toThrow(/ROOK_EVAL_OUT/);
  });
});

describe("task fixtures", () => {
  it("has unique ids, positive checks, and no task passes on an empty reply", () => {
    expect(TASKS.length).toBe(20);
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

beforeEach(() => {
  authSeen = []; provider = "chatgpt"; __resetTelemetryForTests(); vi.clearAllMocks();
  vi.mocked(invokeAiResilient).mockImplementation(async (params, request) => {
    authSeen.push(request?.header("authorization"));
    const lean = String(params.messages[0].content).includes("Be a direct, warm teammate");
    const out = behavior(params, lean ? "lean" : "legacy");
    if (out instanceof Error) throw out;
    await observeManagedCall({ provider: "chatgpt", model: params.model ?? MODEL, payload: params, scope: "sdk-call" }, async () => out);
    return { result: out, attemptedProviders: [provider], fellBack: false };
  });
});

const SENTINEL = "SENTINEL-ANSWER-TEXT";
const options = (over: Partial<ProbeOptions> = {}): ProbeOptions => ({ model: MODEL, tasks: TASKS.filter((t) => ["small-talk", "model-identity", "github-read"].includes(t.id)),
  arms: ["baseline", "baseline_repeat", "lean_prompt"], reps: 5, seed: 1, maxRequests: 500, minIntervalMs: 0, maxInvalidRate: 0.5, margin: 0.05, minPairs: 10,
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
    toolErrors: 0, invalidArguments: 0, skippedCalls: 0, loadToolsCalls: 0, approvals: 0, tokens: { input: 1, cachedInput: null, output: 1, reasoning: null }, latencyMs: 5, answerChars: 3 };
  const meta = { model: MODEL, seed: 1, reps: 1, tasks: 1, requestsUsed: 1, truncated: "none" as const, margin: 0.05, minPairs: 1 };
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

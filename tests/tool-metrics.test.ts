import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
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
import { __resetTelemetryForTests, recentTurns, toolStats } from "../server/ai/telemetry";
import { outcomeFromError, outcomeFromPayload, toolUsageStats } from "../server/ai/tool-metrics";
import type { InvokeResult, ToolCall } from "../server/_core/llm";

describe("tool outcome classification", () => {
  it("maps dispatcher payloads to outcome classes and keeps only well-formed codes", () => {
    expect(outcomeFromPayload("t", { status: "completed", result: "secret rows" })).toEqual({ tool: "t", outcome: "ok" });
    expect(outcomeFromPayload("t", { status: "approval_required", action_id: "a" })).toEqual({ tool: "t", outcome: "proposed" });
    expect(outcomeFromPayload("t", { status: "denied", code: "POLICY_DENIED" })).toEqual({ tool: "t", outcome: "denied", code: "POLICY_DENIED" });
    expect(outcomeFromPayload("t", { status: "not_prepared", code: "NOT_PREPARED" })).toEqual({ tool: "t", outcome: "skipped", code: "NOT_PREPARED" });
    expect(outcomeFromPayload("t", { status: "error", code: "UNKNOWN_TOOL" })).toEqual({ tool: "t", outcome: "error", code: "UNKNOWN_TOOL" });
    expect(outcomeFromPayload("t", { status: "error", code: "INVALID_ARGUMENTS" })).toMatchObject({ outcome: "invalid_arguments" });
    expect(outcomeFromPayload("t", { status: "error", code: "free text with a password=x" })).toEqual({ tool: "t", outcome: "error" });
    expect(outcomeFromPayload("t", null)).toEqual({ tool: "t", outcome: "ok" });
  });
  it("treats schema and JSON failures as invalid arguments and other throws as FAILED", () => {
    const zodError = (() => { try { z.object({ a: z.string() }).parse({}); } catch (e) { return e; } })();
    expect(outcomeFromError("t", zodError)).toEqual({ tool: "t", outcome: "invalid_arguments", code: "INVALID_ARGUMENTS" });
    expect(outcomeFromError("t", (() => { try { JSON.parse("{"); } catch (e) { return e; } })())).toMatchObject({ outcome: "invalid_arguments" });
    expect(outcomeFromError("t", new Error("boom with details"))).toEqual({ tool: "t", outcome: "error", code: "FAILED" });
    expect(outcomeFromError("t", Object.assign(new Error("x"), { code: "TIMEOUT" }))).toEqual({ tool: "t", outcome: "error", code: "TIMEOUT" });
  });
  it("computes call share and error rates; skipped calls count toward share but not error rate", () => {
    const o = (tool: string, outcome: "ok" | "error" | "invalid_arguments" | "skipped") => ({ tool, outcome });
    const stats = toolUsageStats([
      { toolOutcomes: [o("a", "ok"), o("a", "invalid_arguments"), o("a", "skipped"), o("b", "error")] },
      { toolOutcomes: [o("a", "ok")] }, {},
    ]);
    expect(stats).toMatchObject({ calls: 5, turnsWithOutcomes: 2 });
    const a = stats.tools.find((r) => r.tool === "a")!;
    expect(a).toMatchObject({ calls: 4, ok: 2, invalidArguments: 1, skipped: 1, share: 0.8 });
    expect(a.errorRate).toBeCloseTo(1 / 3); expect(a.invalidArgumentRate).toBeCloseTo(1 / 3);
    expect(stats.tools[1]).toMatchObject({ tool: "b", errorRate: 1 });
    expect(toolUsageStats([])).toEqual({ calls: 0, turnsWithOutcomes: 0, tools: [] });
  });
});

const input: RookAgentInput = { userId: "u", botId: "b", taskId: "t", botName: "Scout", botRole: "helper", botPurpose: "Help",
  message: "go", recentContext: [], model: "openrouter/free" };
const mk = (name: string, args: Record<string, unknown>, id: string): ToolCall => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
const answer = (calls: ToolCall[] = []): InvokeResult => ({ id: "r", created: 1, model: "fixture/model",
  choices: [{ index: 0, message: { role: "assistant", content: calls.length ? "" : "Done", tool_calls: calls }, finish_reason: calls.length ? "tool_calls" : "stop" }] });

describe.each(["response", "stream"] as const)("tool outcomes recorded by the %s loop", (mode) => {
  let steps: InvokeResult[];
  beforeEach(() => {
    __resetTelemetryForTests(); vi.clearAllMocks();
    vi.mocked(invokeAiResilient).mockImplementation(async () => ({ result: steps.shift()!, attemptedProviders: ["f"], fellBack: false }));
    vi.mocked(invokeAiStream).mockImplementation(async () => {
      const r = steps.shift()!; const m = r.choices[0].message;
      return { text: String(m.content), toolCalls: m.tool_calls ?? [], model: r.model, finishReason: r.choices[0].finish_reason };
    });
  });
  it("records ok, invalid-arguments, denied, proposed and duplicate calls without arguments or results", async () => {
    const dupe = mk("computer_status", {}, "c1");
    steps = [answer([dupe, mk("github_read_file", { repo: "secret/repo-name" }, "c2"), mk("excel_update_range", { values: [["p@ss"]] }, "c3"),
      mk("computer_run_command", { command: "rm -rf" }, "c4"), { ...dupe, id: "c5" }]), answer()];
    vi.mocked(executeAgentTool).mockImplementation(async (call) => {
      if (call.name === "computer_status") return { traceStep: { kind: "tool", title: "Checked" }, resultPayload: { status: "completed", result: "private cell values" } };
      if (call.name === "github_read_file") { z.object({ path: z.string() }).parse({}); }
      if (call.name === "excel_update_range") return { traceStep: { kind: "tool", title: "Prepared" }, resultPayload: { status: "approval_required", action_id: "a1" } };
      return { traceStep: { kind: "tool", title: "Blocked" }, resultPayload: { status: "denied", code: "POLICY_DENIED", retryable: false } };
    });
    await (mode === "response" ? runRookAgent(input) : runRookAgentStream(input, () => {}));
    const turn = recentTurns(1)[0];
    expect(turn.toolOutcomes).toEqual([
      { tool: "computer_status", outcome: "ok" },
      { tool: "github_read_file", outcome: "invalid_arguments", code: "INVALID_ARGUMENTS" },
      { tool: "excel_update_range", outcome: "proposed" },
      { tool: "computer_run_command", outcome: "denied", code: "POLICY_DENIED" },
      { tool: "computer_status", outcome: "skipped", code: "DUPLICATE_CALL" },
    ]);
    const serialized = JSON.stringify(turn);
    for (const leaked of ["private cell values", "secret/repo-name", "p@ss", "rm -rf"]) expect(serialized).not.toContain(leaked);
    expect(toolStats().tools.find((r) => r.tool === "github_read_file")).toMatchObject({ calls: 1, invalidArguments: 1, errorRate: 1 });
  });
});

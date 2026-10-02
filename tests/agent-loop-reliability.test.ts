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
import { backoffSleep, DOOM_LOOP_ABORT_MESSAGE } from "../server/ai/agent-reliability";
import type { InvokeParams, InvokeResult, ToolCall } from "../server/_core/llm";

const input: RookAgentInput = { userId: "fixture", botId: "bot", taskId: "task", botName: "Scout",
  botRole: "helper", botPurpose: "Help", message: "check it", recentContext: [], model: "openrouter/free" };
const call = (name = "computer_status"): ToolCall => ({ id: "call", type: "function", function: { name, arguments: "{}" } });
const answer = (calls: ToolCall[] = []): InvokeResult => ({ id: "response", created: 1, model: "fixture/model",
  choices: [{ index: 0, message: { role: "assistant", content: calls.length ? "" : "Done", tool_calls: calls }, finish_reason: calls.length ? "tool_calls" : "stop" }] });
let steps: Array<InvokeResult | Error>;
let budgets: Array<number | undefined>;
const next = (params: InvokeParams) => {
  budgets.push(params.maxTokens);
  const step = steps.shift();
  if (!step) throw new Error("Unexpected additional model request");
  if (step instanceof Error) throw step;
  return step;
};
beforeEach(() => {
  vi.clearAllMocks(); steps = []; budgets = [];
  vi.mocked(executeAgentTool).mockResolvedValue({ traceStep: { kind: "tool", title: "Checked" }, resultPayload: { status: "completed" } });
  vi.mocked(invokeAiResilient).mockImplementation(async (params) => ({ result: next(params), attemptedProviders: ["fixture"], fellBack: false }));
  vi.mocked(invokeAiStream).mockImplementation(async (params) => {
    const result = next(params); const message = result.choices[0].message;
    return { text: String(message.content), toolCalls: message.tool_calls ?? [], model: result.model, finishReason: result.choices[0].finish_reason };
  });
});

describe.each(["response", "stream"] as const)("%s loop reliability", (mode) => {
  const run = () => mode === "response" ? runRookAgent(input) : runRookAgentStream(input, () => {});
  it("passes Bot restrictions to the dispatcher even when the model calls an omitted tool", async () => {
    steps = [answer([call()]), answer()];
    vi.mocked(executeAgentTool).mockResolvedValueOnce({ traceStep: { kind: "tool", title: "Denied" }, resultPayload: { status: "denied", code: "POLICY_DENIED", retryable: false } });
    const restricted = { ...input, disallowedTools: ["computer_status"] };
    if (mode === "response") await runRookAgent(restricted); else await runRookAgentStream(restricted, () => {});
    expect(executeAgentTool).toHaveBeenCalledWith(expect.objectContaining({ name: "computer_status", disallowedTools: ["computer_status"] }));
  });
  it.each(["401 invalid key after timeout", "401 invalid key: max_tokens exceeds maximum"])("surfaces auth without retry: %s", async (message) => {
    steps = [new Error(message)];
    const result = await run();
    expect(result.text).toMatch(/connection needs attention/);
    expect(budgets).toHaveLength(1); expect(backoffSleep).not.toHaveBeenCalled();
  });
  it("retries transient failures after a completed tool round", async () => {
    steps = [answer([call()]), new Error("503 temporarily unavailable"), answer()];
    expect((await run()).text).toBe("Done");
    expect(budgets).toHaveLength(3); expect(backoffSleep).toHaveBeenCalledTimes(1);
    expect(executeAgentTool).toHaveBeenCalledTimes(1);
  });
  it("shrinks a rejected max_tokens budget once", async () => {
    steps = [new Error("max_tokens exceeds maximum"), answer()];
    expect((await run()).text).toBe("Done");
    expect(budgets).toEqual([2000, 1000]);
  });
  it("never repeatedly shrinks a rejected budget", async () => {
    steps = [new Error("max_tokens exceeds maximum"), new Error("max_tokens exceeds maximum")];
    await run(); expect(budgets).toEqual([2000, 1000]);
  });
  it("stops a repeated fingerprint on the third model call without another tool execution", async () => {
    steps = [answer([call()]), answer([call()]), answer([call()])];
    const result = await run();
    expect(result.text).toBe(DOOM_LOOP_ABORT_MESSAGE);
    expect(budgets).toHaveLength(3); expect(executeAgentTool).toHaveBeenCalledTimes(1);
  });
  it("makes unknown tools terminal without giving the model another round to retry them", async () => {
    steps = [answer([call("missing_tool")])];
    vi.mocked(executeAgentTool).mockResolvedValueOnce({ traceStep: { kind: "tool", title: "Unavailable" },
      resultPayload: { status: "error", code: "UNKNOWN_TOOL", retryable: false } });
    expect((await run()).text).toContain("isn't available");
    expect(budgets).toHaveLength(1); expect(executeAgentTool).toHaveBeenCalledTimes(1);
  });
});

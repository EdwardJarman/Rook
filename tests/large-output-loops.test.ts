import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const outputDir = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const made = require("node:fs").mkdtempSync(require("node:path").join(require("node:os").tmpdir(), "rook-loop-output-"));
  process.env.ROOK_TOOL_OUTPUT_DIR = made;
  return made as string;
});
vi.mock("../server/db", () => ({ listRookNodesForUser: vi.fn(async () => []) }));
vi.mock("../server/ai/fallback-router", () => ({ invokeAiResilient: vi.fn() }));
vi.mock("../server/ai/openai-stream", async (original) => ({
  ...await original<object>(), invokeAiStream: vi.fn(), supportsModelStream: () => true,
}));
vi.mock("../server/integrations/agent-tool-executor", async (original) => ({ ...await original<object>(), executeAgentTool: vi.fn() }));
import { runRookAgent, type RookAgentInput } from "../server/integrations/excel-agent";
import { runRookAgentStream } from "../server/ai/agent-stream";
import { invokeAiResilient } from "../server/ai/fallback-router";
import { invokeAiStream } from "../server/ai/openai-stream";
import { executeAgentTool } from "../server/integrations/agent-tool-executor";
import type { InvokeParams, InvokeResult, ToolCall } from "../server/_core/llm";

const input: RookAgentInput = { userId: "alice", botId: "bot", taskId: "task", botName: "Scout", botRole: "helper",
  botPurpose: "Help", message: "read the file", recentContext: [], model: "openrouter/free" };
const call: ToolCall = { id: "c1", type: "function", function: { name: "github_read_file", arguments: JSON.stringify({ repo: "Acme/Repo", path: "big.txt" }) } };
const answer = (calls: ToolCall[] = []): InvokeResult => ({ id: "r", created: 1, model: "fixture/model",
  choices: [{ index: 0, message: { role: "assistant", content: calls.length ? "" : "Done", tool_calls: calls }, finish_reason: calls.length ? "tool_calls" : "stop" }] });
const payload = { status: "completed", result: { content: "line\n".repeat(20_000) + "MARKER" } };
let requests: InvokeParams[];
let steps: InvokeResult[];
const next = (params: InvokeParams) => { requests.push(structuredClone(params)); return steps.shift()!; };

beforeEach(async () => {
  vi.clearAllMocks(); requests = []; steps = [answer([call]), answer()];
  for (const name of await fs.readdir(outputDir)) await fs.unlink(path.join(outputDir, name));
  vi.mocked(executeAgentTool).mockResolvedValue({ traceStep: { kind: "tool", title: "Read" }, resultPayload: payload });
  vi.mocked(invokeAiResilient).mockImplementation(async (params) => ({ result: next(params), attemptedProviders: ["f"], fellBack: false }));
  vi.mocked(invokeAiStream).mockImplementation(async (params) => {
    const r = next(params); const m = r.choices[0].message;
    return { text: String(m.content), toolCalls: m.tool_calls ?? [], model: r.model, finishReason: r.choices[0].finish_reason };
  });
});
afterAll(async () => {
  if (path.dirname(outputDir) !== path.resolve(os.tmpdir()) || !path.basename(outputDir).startsWith("rook-loop-output-")) return;
  await fs.rm(outputDir, { recursive: true, force: true });
});

describe.each(["response", "stream"] as const)("large tool output through the %s loop", (mode) => {
  const run = (over: Partial<RookAgentInput> = {}) =>
    mode === "response" ? runRookAgent({ ...input, ...over }) : runRookAgentStream({ ...input, ...over }, () => {});

  it("sends a bounded descriptor, not the payload, and records the source for retrieval auth", async () => {
    expect((await run()).text).toBe("Done");
    const toolMessage = requests[1].messages.find((m) => m.role === "tool")!;
    const descriptor = JSON.parse(String(toolMessage.content));
    const inlineChars = JSON.stringify(payload).length;
    expect(descriptor).toMatchObject({ status: "retained_output", readTool: "read_tool_output", characters: inlineChars });
    expect(descriptor.tail).toHaveLength(1200);
    expect(String(toolMessage.content).length).toBeLessThan(2400);
    console.info(`[large-output ${mode}] tool message ${String(toolMessage.content).length} chars vs ${inlineChars} inline`);
    const [file] = await fs.readdir(outputDir);
    const stored = JSON.parse(await fs.readFile(path.join(outputDir, file), "utf8"));
    expect(stored.source).toEqual({ tool: "github_read_file", resource: "acme/repo" });
    expect(stored.text).toContain("MARKER");
  });

  it("refuses to retain when the Bot disallows the reader, without leaving a file", async () => {
    const result = await run({ disallowedTools: ["read_tool_output"] });
    expect(result.text).toMatch(/read_tool_output is disabled/);
    expect(await fs.readdir(outputDir)).toEqual([]);
  });
});

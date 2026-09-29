import { beforeEach, describe, expect, it, vi } from "vitest";

const connectors = vi.hoisted(() => ({ on: false }));
vi.mock("../server/db", () => ({ listRookNodesForUser: vi.fn(async () => []) }));
vi.mock("../server/ai/fallback-router", () => ({ invokeAiResilient: vi.fn() }));
vi.mock("../server/ai/openai-stream", async (original) => ({
  ...await original<object>(), invokeAiStream: vi.fn(), supportsModelStream: () => true,
}));
vi.mock("../server/ai/agent-reliability", async (original) => ({ ...await original<object>(), backoffSleep: vi.fn() }));
vi.mock("../server/integrations/microsoft-excel", async (original) => ({ ...await original<object>(),
  isMicrosoftExcelConfigured: () => connectors.on,
  microsoftConnectionStatus: async () => ({ configured: true, connected: true, needsReauthorization: false, displayName: "A", email: "a@x.test", scopes: [], connectedAt: null,
    accounts: [{ accountId: "acct-1", displayName: "A", email: "a@x.test", status: "connected", isPrimary: true, connectedAt: "2026-01-01" }] }) }));
vi.mock("../server/integrations/github", async (original) => ({ ...await original<object>(),
  isGithubConfigured: () => connectors.on,
  githubConnectionStatus: async () => ({ configured: true, connected: true, needsReauthorization: false, login: "me",
    selectedRepos: [{ fullName: "Acme/Repo", privateRepo: false, defaultBranch: "main" }] }) }));
vi.mock("../server/integrations/cloud-computer", async (original) => ({ ...await original<object>(), isCloudComputerConfigured: () => connectors.on }));
vi.mock("../server/integrations/agent-tool-executor", async (original) => ({ ...await original<object>(), executeAgentTool: vi.fn() }));

import { runRookAgent, prepareAgentTurn, type RookAgentInput } from "../server/integrations/excel-agent";
import { runRookAgentStream } from "../server/ai/agent-stream";
import { invokeAiResilient } from "../server/ai/fallback-router";
import { invokeAiStream } from "../server/ai/openai-stream";
import * as executor from "../server/integrations/agent-tool-executor";
import { __resetTelemetryForTests, recentTurns } from "../server/ai/telemetry";
import { LOAD_TOOLS_NAME, loadToolsResult, offloadTools, OFFLOADABLE_TOOL_NAMES, ToolActivation, buildLoadToolsTool } from "../server/ai/tool-offload";
import { EXCEL_TOOLS } from "../server/integrations/excel-tools";
import { COMPUTER_TOOLS } from "../server/integrations/computer-tools";
import type { InvokeParams, InvokeResult, Tool, ToolCall } from "../server/_core/llm";

const real = await vi.importActual<typeof import("../server/integrations/agent-tool-executor")>("../server/integrations/agent-tool-executor");
const names = (tools?: Tool[]) => (tools ?? []).map((tool) => tool.function.name);
const dispatch = (name: string, rawArgs: string, extra: object = {}) => real.executeAgentTool({ userId: "u", botId: "b", taskId: "t", name, rawArgs,
  excelConnected: true, githubConnected: true, computerOnline: false, approvals: [], computerProposals: [], ...extra });

describe("offload split", () => {
  it("never offloads read, search, edit or shell tools", () => {
    const never = ["excel_list_workbooks", "excel_list_worksheets", "excel_read_range", "excel_update_range", "excel_append_table_rows",
      "github_list_files", "github_read_file", "computer_status", "computer_run_command", "computer_read_file", "computer_write_file",
      "computer_list_files", "read_skill", "read_tool_output", LOAD_TOOLS_NAME];
    for (const name of never) expect(OFFLOADABLE_TOOL_NAMES as readonly string[]).not.toContain(name);
  });
  it("removes offloadable tools, keeps the rest in order, and appends the pointer last", () => {
    const all = [...EXCEL_TOOLS, ...COMPUTER_TOOLS];
    const { tools, offloaded } = offloadTools(all);
    expect(names(offloaded)).toEqual(["excel_list_tables", "excel_add_worksheet", "excel_create_workbook", "computer_propose_task"]);
    expect(names(tools)).toEqual([...names(all).filter((n) => !names(offloaded).includes(n)), LOAD_TOOLS_NAME]);
    const pointer = tools!.at(-1)!.function;
    expect((pointer.parameters as { properties: { names: { items: { enum: string[] } } } }).properties.names.items.enum).toEqual(names(offloaded));
    for (const name of names(offloaded)) expect(pointer.description).toContain(name);
  });
  it("is a no-op when nothing offloadable is offered", () => {
    const only = COMPUTER_TOOLS.filter((tool) => tool.function.name === "computer_status");
    expect(offloadTools(only)).toEqual({ tools: only, offloaded: [] });
    expect(offloadTools(undefined)).toEqual({ tools: undefined, offloaded: [] });
  });
});

describe("load_tools dispatch", () => {
  it("returns full definitions only for tools offloaded this turn", async () => {
    const result = (await dispatch(LOAD_TOOLS_NAME, JSON.stringify({ names: ["excel_add_worksheet", "excel_read_range"] }),
      { offloadedTools: ["excel_add_worksheet"] })).resultPayload as ReturnType<typeof loadToolsResult>;
    expect(result).toMatchObject({ status: "completed", result: { unavailable: ["excel_read_range"] } });
    const loaded = (result as { result: { tools: Tool[] } }).result.tools;
    expect(names(loaded)).toEqual(["excel_add_worksheet"]);
    expect(loaded[0]).toEqual(EXCEL_TOOLS.find((tool) => tool.function.name === "excel_add_worksheet"));
  });
  it("gives an actionable error for empty, malformed or unloadable requests", async () => {
    for (const args of ["{}", "not json", JSON.stringify({ names: ["excel_read_range"] })]) {
      expect((await dispatch(LOAD_TOOLS_NAME, args, { offloadedTools: ["excel_add_worksheet"] })).resultPayload).toMatchObject({ status: "error", code: "INVALID_ARGUMENTS" });
    }
    expect((await dispatch(LOAD_TOOLS_NAME, JSON.stringify({ names: ["excel_add_worksheet"] }))).resultPayload).toMatchObject({ code: "INVALID_ARGUMENTS" });
  });
  it("respects Bot restrictions on the pointer and on the loaded tool", async () => {
    expect((await dispatch(LOAD_TOOLS_NAME, "{}", { disallowedTools: [LOAD_TOOLS_NAME] })).resultPayload).toMatchObject({ code: "POLICY_DENIED" });
    expect((await dispatch("excel_add_worksheet", "{}", { disallowedTools: ["excel_add_worksheet"] })).resultPayload).toMatchObject({ code: "POLICY_DENIED" });
  });
  it("is registered as a read-only tool", () => {
    expect(real.TOOL_REGISTRY[LOAD_TOOLS_NAME]).toMatchObject({ family: "output", risk: "read-only" });
    expect(real.allOfferedToolNames()).toContain(LOAD_TOOLS_NAME);
  });
});

describe("ToolActivation", () => {
  const base = COMPUTER_TOOLS.filter((tool) => tool.function.name === "computer_status");
  const offloaded = [...EXCEL_TOOLS, ...COMPUTER_TOOLS].filter((tool) => ["excel_add_worksheet", "computer_propose_task"].includes(tool.function.name));
  it("activates loaded and directly-called offloaded tools, once, in load order", () => {
    const activation = new ToolActivation(base, offloaded);
    expect(activation.current()).toBe(base);
    activation.observe(LOAD_TOOLS_NAME, JSON.stringify({ names: ["computer_propose_task", "nope", "computer_propose_task"] }));
    activation.observe("excel_add_worksheet", "{}");
    activation.observe("excel_read_range", "{}");
    activation.observe(LOAD_TOOLS_NAME, "not json");
    expect(names(activation.current())).toEqual(["computer_status", "computer_propose_task", "excel_add_worksheet"]);
  });
  it("rebuilds from message history so a resumed turn keeps its loaded tools", () => {
    const call: ToolCall = { id: "c", type: "function", function: { name: LOAD_TOOLS_NAME, arguments: JSON.stringify({ names: ["excel_add_worksheet"] }) } };
    const activation = new ToolActivation(base, offloaded, [{ role: "user", content: "x" }, { role: "assistant", content: "", tool_calls: [call] }]);
    expect(names(activation.current())).toEqual(["computer_status", "excel_add_worksheet"]);
  });
});

describe("prepareAgentTurn with the offload flag", () => {
  const turn: RookAgentInput = { userId: "u", botId: "b", taskId: "t", botName: "Scout", botRole: "Helper", botPurpose: "Help", message: "hello", recentContext: [], model: "fixture/model" };
  beforeEach(() => { connectors.on = true; });
  it("off: tools are exactly the static list. on: fewer bytes, same relative order, pointer last", async () => {
    const off = await prepareAgentTurn(turn, "a");
    const on = await prepareAgentTurn({ ...turn, variants: { toolOffload: true } }, "b");
    expect(off.offloaded).toEqual([]);
    const offNames = names(off.tools), onNames = names(on.tools);
    expect(onNames.at(-1)).toBe(LOAD_TOOLS_NAME);
    expect(onNames.slice(0, -1)).toEqual(offNames.filter((n) => !(OFFLOADABLE_TOOL_NAMES as readonly string[]).includes(n)));
    expect(names(on.offloaded)).toEqual(offNames.filter((n) => (OFFLOADABLE_TOOL_NAMES as readonly string[]).includes(n)));
    const bytes = (tools?: Tool[]) => JSON.stringify(tools).length;
    console.info(`[offload] all connectors: ${offNames.length} tools ${bytes(off.tools)} chars -> ${onNames.length} tools ${bytes(on.tools)} chars (-${bytes(off.tools) - bytes(on.tools)})`);
    expect(bytes(on.tools)).toBeLessThan(bytes(off.tools) - 1500);
    expect(on.messages).toEqual(off.messages.map((m, i) => (i === 1 ? on.messages[1] : m)));
  });
  it("omits offloaded tools the Bot disallows, and the pointer when none remain", async () => {
    const some = await prepareAgentTurn({ ...turn, variants: { toolOffload: true }, disallowedTools: ["excel_add_worksheet"] }, "c");
    expect(names(some.offloaded)).not.toContain("excel_add_worksheet");
    expect(JSON.stringify(some.tools)).not.toContain("excel_add_worksheet");
    const none = await prepareAgentTurn({ ...turn, variants: { toolOffload: true }, disallowedTools: [...OFFLOADABLE_TOOL_NAMES] }, "d");
    expect(none.offloaded).toEqual([]); expect(names(none.tools)).not.toContain(LOAD_TOOLS_NAME);
  });
  it("advertises the pointer only for tools actually offered (no connectors: computer_propose_task only)", async () => {
    connectors.on = false;
    const on = await prepareAgentTurn({ ...turn, variants: { toolOffload: true } }, "e");
    expect(names(on.offloaded)).toEqual(["computer_propose_task"]);
    expect(JSON.stringify(buildLoadToolsTool(on.offloaded))).not.toContain("excel_");
  });
});

const input: RookAgentInput = { userId: "u", botId: "b", taskId: "t", botName: "Scout", botRole: "Helper", botPurpose: "Help", message: "propose a browser task", recentContext: [], model: "openrouter/free" };
const call = (name: string, args: object, id: string): ToolCall => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
const answer = (calls: ToolCall[] = []): InvokeResult => ({ id: "r", created: 1, model: "fixture/model",
  choices: [{ index: 0, message: { role: "assistant", content: calls.length ? "" : "Done", tool_calls: calls }, finish_reason: calls.length ? "tool_calls" : "stop" }] });

describe.each(["response", "stream"] as const)("offload through the %s loop", (mode) => {
  let steps: InvokeResult[]; let toolLists: string[][];
  beforeEach(() => {
    connectors.on = false; vi.clearAllMocks(); __resetTelemetryForTests(); toolLists = [];
    const next = (params: InvokeParams) => { toolLists.push(names(params.tools)); return steps.shift()!; };
    vi.mocked(executor.executeAgentTool).mockResolvedValue({ traceStep: { kind: "tool", title: "ok" }, resultPayload: { status: "completed" } });
    vi.mocked(invokeAiResilient).mockImplementation(async (params) => ({ result: next(params), attemptedProviders: ["f"], fellBack: false }));
    vi.mocked(invokeAiStream).mockImplementation(async (params) => { const r = next(params); const m = r.choices[0].message;
      return { text: String(m.content), toolCalls: m.tool_calls ?? [], model: r.model, finishReason: r.choices[0].finish_reason }; });
  });
  const run = (over: Partial<RookAgentInput>) => mode === "response" ? runRookAgent({ ...input, ...over }) : runRookAgentStream({ ...input, ...over }, () => {});

  it("offers the pointer, then the loaded tool from the next round on, and tells the dispatcher what was withheld", async () => {
    steps = [answer([call(LOAD_TOOLS_NAME, { names: ["computer_propose_task"] }, "c1")]), answer([call("computer_propose_task", { title: "x" }, "c2")]), answer()];
    expect((await run({ variants: { toolOffload: true } })).text).toBe("Done");
    expect(toolLists[0]).toContain(LOAD_TOOLS_NAME); expect(toolLists[0]).not.toContain("computer_propose_task");
    expect(toolLists[1]).toEqual([...toolLists[0], "computer_propose_task"]);
    expect(toolLists[2]).toEqual(toolLists[1]);
    expect(vi.mocked(executor.executeAgentTool)).toHaveBeenCalledWith(expect.objectContaining({ name: LOAD_TOOLS_NAME, offloadedTools: ["computer_propose_task"] }));
    expect(recentTurns(1)[0].variants).toEqual(["toolOffload"]);
  });
  it("activates an offloaded tool the model calls directly", async () => {
    steps = [answer([call("computer_propose_task", { title: "x" }, "c1")]), answer()];
    await run({ variants: { toolOffload: true } });
    expect(toolLists[1]).toContain("computer_propose_task");
  });
  it("flag off: identical static tools every round and no pointer", async () => {
    steps = [answer([call("computer_status", {}, "c1")]), answer()];
    await run({});
    expect(toolLists[0]).toContain("computer_propose_task"); expect(toolLists[0]).not.toContain(LOAD_TOOLS_NAME);
    expect(toolLists[1]).toEqual(toolLists[0]); expect(recentTurns(1)[0].variants).toEqual([]);
  });
});

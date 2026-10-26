/**
 * Flagged tool offload (`ROOK_VARIANT_TOOL_OFFLOAD`).
 *
 * Low-use tools stop being advertised on every round. In their place the model
 * gets one small `load_tools` tool that returns their full definitions and
 * activates them for the rest of the turn. The dispatcher still enforces every
 * policy: an offloaded tool called directly still runs (and is activated), so
 * a model that already knows the name is never blocked, only slower to get its
 * schema. Read/search/edit/shell tools are never offloaded.
 *
 * The candidate list is a hypothesis from tool purpose, not measured call
 * share (see docs/tool-description-audit.md); the chunk 5 eval decides.
 */

import type { Message, Tool } from "../_core/llm";
import { COMPUTER_TOOLS } from "../integrations/computer-tools";
import { EXCEL_TOOLS } from "../integrations/excel-tools";
import { GITHUB_TOOLS } from "../integrations/github-tools";

export const LOAD_TOOLS_NAME = "load_tools";
export const OFFLOADABLE_TOOL_NAMES = [
  "excel_list_tables",
  "excel_add_worksheet",
  "excel_create_workbook",
  "github_repo_overview",
  "computer_propose_task",
] as const;

const OFFLOADABLE = new Set<string>(OFFLOADABLE_TOOL_NAMES);
const definitions = () => [...EXCEL_TOOLS, ...GITHUB_TOOLS, ...COMPUTER_TOOLS].filter((tool) => OFFLOADABLE.has(tool.function.name));
const nameOf = (tool: Tool) => tool.function.name;

const summary = (tool: Tool): string => {
  const first = (tool.function.description ?? "").split(/(?<=\.)\s/)[0].replace(/^Use (?:when|to) /i, "");
  return first.length <= 90 ? first : `${first.slice(0, 89)}…`;
};

/** Small pointer tool listing what can be loaded. Order of `offloaded` is preserved. */
export function buildLoadToolsTool(offloaded: Tool[]): Tool {
  const names = offloaded.map(nameOf);
  return { type: "function", function: {
    name: LOAD_TOOLS_NAME,
    description: `Load the full definition of a tool before using it. Available: ${offloaded.map((tool) => `${nameOf(tool)} (${summary(tool)})`).join("; ")}.`,
    parameters: { type: "object", properties: { names: { type: "array", items: { type: "string", enum: names }, minItems: 1, maxItems: names.length } },
      required: ["names"], additionalProperties: false },
  } };
}

/** Registry-only instance covering every offloadable tool (real requests list only the permitted subset). */
export const DISCOVERY_TOOLS: Tool[] = [buildLoadToolsTool(definitions())];

/** Split a permitted toolset: offloadable tools leave the static list; a pointer is appended last. */
export function offloadTools(tools: Tool[] | undefined): { tools: Tool[] | undefined; offloaded: Tool[] } {
  if (!tools) return { tools, offloaded: [] };
  const offloaded = tools.filter((tool) => OFFLOADABLE.has(nameOf(tool)));
  if (!offloaded.length) return { tools, offloaded: [] };
  return { tools: [...tools.filter((tool) => !OFFLOADABLE.has(nameOf(tool))), buildLoadToolsTool(offloaded)], offloaded };
}

/** Dispatcher result for `load_tools`: full schemas for offloaded names, plus names that are not loadable here. */
export function loadToolsResult(offloadedNames: readonly string[], rawArgs: string) {
  let requested: string[] = [];
  try {
    const parsed = JSON.parse(rawArgs || "{}") as { names?: unknown };
    requested = Array.isArray(parsed.names) ? parsed.names.filter((n): n is string => typeof n === "string").slice(0, 8) : [];
  } catch { /* handled below */ }
  const allowed = new Set(offloadedNames);
  const tools = definitions().filter((tool) => requested.includes(nameOf(tool)) && allowed.has(nameOf(tool)));
  const unavailable = [...new Set(requested)].filter((name) => !tools.some((tool) => nameOf(tool) === name));
  if (!tools.length) return { status: "error", code: "INVALID_ARGUMENTS", retryable: false,
    message: `Name one or more of: ${offloadedNames.join(", ") || "(none available)"}.` };
  return { status: "completed", result: { tools, ...(unavailable.length ? { unavailable } : {}), note: "These tools are now available; call them with these parameters." } };
}

/** Tracks which offloaded tools the model has loaded (or used) this turn. */
export class ToolActivation {
  private active: Tool[] = [];
  constructor(private base: Tool[], private offloaded: Tool[], history: Message[] = []) {
    for (const message of history) {
      for (const call of message.role === "assistant" ? message.tool_calls ?? [] : []) this.observe(call.function.name, call.function.arguments);
    }
  }
  observe(name: string, rawArgs: string): void {
    let wanted: string[] = [];
    if (name === LOAD_TOOLS_NAME) {
      try {
        const parsed = JSON.parse(rawArgs || "{}") as { names?: unknown };
        wanted = Array.isArray(parsed.names) ? parsed.names.filter((n): n is string => typeof n === "string") : [];
      } catch { return; }
    } else wanted = [name];
    for (const want of wanted) {
      const tool = this.offloaded.find((candidate) => nameOf(candidate) === want);
      if (tool && !this.active.includes(tool)) this.active.push(tool);
    }
  }
  current(): Tool[] { return this.active.length ? [...this.base, ...this.active] : this.base; }
}

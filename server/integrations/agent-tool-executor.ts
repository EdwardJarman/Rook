/**
 * Shared agent tool dispatcher (v2 loop-mode).
 *
 * Used by BOTH the request/response turn (`runRookAgent`) and the
 * streaming turn (`runRookAgentStream`) so tool behavior can never diverge
 * between the two paths: same parsing, same approval caps, same timeouts,
 * same error shapes.
 *
 * The caller owns the loop (rounds, budgets, history); this module owns
 * what one tool call means.
 */

import * as db from "../db";
import type { AgentTraceStep } from "../../shared/agent-trace";
import type { Tool } from "../_core/llm";
import type { ExcelAgentApproval } from "./excel-agent";
import {
  COMPUTER_TOOL_NAMES,
  COMPUTER_TOOLS,
  MAX_COMPUTER_PROPOSALS_PER_TURN,
  computerProposalId,
  computerToolTraceTitle,
  executeComputerReadTool,
  parseComputerToolArguments,
  type ComputerProposal,
  type ComputerToolName,
} from "./computer-tools";
import {
  executeGithubReadTool,
  GITHUB_TOOL_NAMES,
  GITHUB_TOOLS,
  githubToolTraceTitle,
  parseGithubToolArguments,
  type GithubToolName,
} from "./github-tools";
import {
  EXCEL_TOOLS,
  EXCEL_WRITE_TOOL_NAMES,
  excelWriteSummary,
  executeExcelReadTool,
  parseExcelToolArguments,
  type ExcelToolName,
} from "./excel-tools";
import {
  SKILL_TOOLS,
  SKILL_TOOL_NAMES,
  executeSkillReadTool,
  parseSkillToolArguments,
  skillToolTraceTitle,
  type SkillToolName,
} from "../ai/skills";
import { makeExcelActionId } from "./microsoft-excel";

const EXCEL_TOOL_SET = new Set(EXCEL_TOOLS.map((tool) => tool.function.name));

/**
 * Honest risk metadata for every tool Rook offers (MCP-annotations-inspired).
 * All Rook tools are first-party and trusted, so these hints ARE actionable
 * here — unlike third-party MCP hints. `"read-only"` tools run immediately;
 * `"approval-gated"` tools only ever *propose* (Excel pending actions,
 * computer proposals) and never execute in-turn. The annotation test fails
 * if any offered tool lacks an entry, so new tools cannot slip in unmarked.
 */
export const TOOL_RISK = {
  excel_list_workbooks: "read-only",
  excel_list_worksheets: "read-only",
  excel_list_tables: "read-only",
  excel_read_range: "read-only",
  excel_update_range: "approval-gated",
  excel_append_table_rows: "approval-gated",
  excel_add_worksheet: "approval-gated",
  excel_create_workbook: "approval-gated",
  github_repo_overview: "read-only",
  github_list_files: "read-only",
  github_read_file: "read-only",
  computer_status: "read-only",
  computer_propose_task: "approval-gated",
  read_skill: "read-only",
} as const satisfies Record<string, "read-only" | "approval-gated">;

export type ToolRisk = (typeof TOOL_RISK)[keyof typeof TOOL_RISK];

/** Every tool the agent can be offered, derived from the same registries. */
export function allOfferedToolNames(): string[] {
  return [
    ...EXCEL_TOOLS.map((tool) => tool.function.name),
    ...GITHUB_TOOLS.map((tool) => tool.function.name),
    ...COMPUTER_TOOLS.map((tool) => tool.function.name),
    ...SKILL_TOOLS.map((tool) => tool.function.name),
  ];
}

/**
 * FROZEN tool-family order: Excel → GitHub → computer → skills. Provider
 * prefix-caches key on exact tool-list bytes (OpenAI's own Codex outage
 * was an unsorted tool list), so existing families must never move
 * opportunistically — pinned by test. New families append last only,
 * deliberately, with a cache-bust note: skills appended 2026-09-16.
 */
export function orderToolset(input: {
  excel: Tool[];
  github: Tool[];
  computer: Tool[];
  skills?: Tool[];
}): Tool[] {
  return [...input.excel, ...input.github, ...input.computer, ...(input.skills ?? [])];
}

/**
 * User-safe one-line detail for a tool step: identifiers only (repos,
 * paths, ranges, titles, URLs) — never cell values, formulas, tokens, or
 * file contents. Shown live in the activity trace.
 */
const short = (value: unknown, max = 120): string | undefined => {
  if (typeof value !== "string") return undefined;
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) return undefined;
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`;
};

const githubDetail = (
  tool: GithubToolName,
  args: Record<string, unknown>,
): string | undefined => {
  const repo = short(args.repo, 60);
  const path = short(args.path, 80);
  if (tool === "github_repo_overview") return repo;
  if (tool === "github_list_files") return path ? `${repo} · ${path}` : repo;
  return path ? `${repo} · ${path}` : repo;
};

const excelDetail = (
  tool: ExcelToolName,
  args: Record<string, unknown>,
): string | undefined => {
  if (tool === "excel_read_range") {
    const sheet = short(args.worksheet, 31);
    const address = short(args.address, 20);
    return sheet && address ? `${sheet}!${address}` : sheet ?? address;
  }
  if (tool === "excel_append_table_rows") return short(args.table_name, 60);
  if (tool === "excel_add_worksheet" || tool === "excel_create_workbook") {
    return short(args.name, 60);
  }
  return undefined;
};

async function withToolTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type AgentToolExecution = {
  traceStep: AgentTraceStep;
  resultPayload: unknown;
};

const step = (title: string, detail?: string): AgentTraceStep =>
  detail ? { kind: "tool", title, detail } : { kind: "tool", title };

export async function executeAgentTool(input: {
  userId: string;
  botId: string;
  taskId: string;
  name: string;
  rawArgs: string;
  excelConnected: boolean;
  githubConnected: boolean;
  computerOnline: boolean;
  approvals: ExcelAgentApproval[];
  computerProposals: ComputerProposal[];
}): Promise<AgentToolExecution> {
  const { userId, botId, taskId, name, rawArgs } = input;

  if (GITHUB_TOOL_NAMES.has(name)) {
    const githubTool = name as GithubToolName;
    const args = parseGithubToolArguments(githubTool, rawArgs);
    return {
      traceStep: step(
        githubToolTraceTitle(githubTool),
        githubDetail(githubTool, args as unknown as Record<string, unknown>),
      ),
      resultPayload: {
        status: "completed",
        result: await withToolTimeout(
          executeGithubReadTool(userId, githubTool, args),
          20_000,
          `GitHub tool ${githubTool}`,
        ),
      },
    };
  }

  if (COMPUTER_TOOL_NAMES.has(name)) {
    const computerTool = name as ComputerToolName;
    const args = parseComputerToolArguments(computerTool, rawArgs);
    if (computerTool === "computer_status") {
      return {
        traceStep: step(computerToolTraceTitle(computerTool)),
        resultPayload: {
          status: "completed",
          result: await withToolTimeout(
            executeComputerReadTool(userId, computerTool, args),
            10_000,
            "Computer tool computer_status",
          ),
        },
      };
    }
    if (input.computerProposals.length >= MAX_COMPUTER_PROPOSALS_PER_TURN) {
      return {
        traceStep: step(computerToolTraceTitle(computerTool)),
        resultPayload: {
          status: "not_prepared",
          message:
            "Two computer tasks are already proposed this turn. Present those first instead of proposing more.",
        },
      };
    }
    const proposalArgs = args as { title: string; url?: string; detail?: string };
    const proposal: ComputerProposal = {
      proposalId: computerProposalId(),
      title: proposalArgs.title,
      ...(proposalArgs.url ? { url: proposalArgs.url } : {}),
      ...(proposalArgs.detail ? { detail: proposalArgs.detail } : {}),
    };
    input.computerProposals.push(proposal);
    return {
      traceStep: step(computerToolTraceTitle(computerTool), proposal.title),
      resultPayload: {
        status: "approval_required",
        proposal_id: proposal.proposalId,
        summary: proposal.title,
        note: input.computerOnline
          ? "Recorded. The user reviews computer tasks in Updates and carries them out in the Computer panel."
          : "Recorded, but no computer is online right now. Tell the user to open Rook Node so the task can run.",
      },
    };
  }

  if (EXCEL_TOOL_SET.has(name)) {
    const excelTool = name as ExcelToolName;
    const args = parseExcelToolArguments(excelTool, rawArgs);
    if (EXCEL_WRITE_TOOL_NAMES.has(excelTool)) {
      if (input.approvals.length) {
        return {
          traceStep: { kind: "tool", title: "Prepared an Excel update for approval" },
          resultPayload: {
            status: "not_prepared",
            message:
              "One Excel change is already waiting for approval. Do not propose another write in this turn.",
          },
        };
      }
      const summary = excelWriteSummary(excelTool, args);
      const actionId = makeExcelActionId();      await db.createExcelPendingAction({
        id: actionId,
        userId,
        botClientId: botId,
        taskClientId: taskId,
        toolName: excelTool,
        arguments: args,
        summary,
        state: "pending",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      input.approvals.push({
        actionId,
        title: "Approve Excel change",
        detail: summary,
        risk: "Medium",
      });
      return {
        traceStep: step("Prepared an Excel update for approval", summary),
        resultPayload: {
          status: "approval_required",
          action_id: actionId,
          summary,
        },
      };
    }
    return {
      traceStep: step(
        "Checked connected Excel data",
        excelDetail(excelTool, args as unknown as Record<string, unknown>),
      ),
      resultPayload: {
        status: "completed",
        result: await withToolTimeout(
          executeExcelReadTool(userId, excelTool, args),
          20_000,
          `Excel tool ${excelTool}`,
        ),
      },
    };
  }

  if (SKILL_TOOL_NAMES.has(name)) {
    const skillTool = name as SkillToolName;
    const args = parseSkillToolArguments(skillTool, rawArgs);
    return {
      traceStep: step(skillToolTraceTitle(skillTool), args.skill),
      resultPayload: await withToolTimeout(
        executeSkillReadTool(skillTool, args),
        10_000,
        "Skill tool read_skill",
      ),
    };
  }

  return {
    traceStep: {
      kind: "tool",
      title: "A connected-tool step could not be completed",
    },
    resultPayload: {
      status: "error",
      message: `Unknown tool “${name}”. Available tools are Excel (${input.excelConnected ? "connected" : "not connected"}), GitHub (${input.githubConnected ? "connected" : "not connected"}), the computer tools (computer_status, computer_propose_task), and read_skill for Rook skill procedures. Do not retry this call.`,
    },
  };
}

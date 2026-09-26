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
  CLOUD_SENSITIVE_TOOL_NAMES,
  CLOUD_TOOLS,
  CLOUD_TOOL_NAMES,
  cloudTraceTitle,
  executeComputerReadTool as executeCloudReadTool,
  parseCloudToolArguments,
  prepareComputerCommandProposal,
  type CloudToolName,
} from "./cloud-tools";
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
import { checkToolPolicy, loadToolPolicyFromEnv, sniffPolicyHints } from "./tool-policy";
import { runPreToolUse } from "../ai/hooks";

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
  computer_read_file: "read-only",
  computer_list_files: "read-only",
  computer_run_command: "approval-gated",
  computer_write_file: "approval-gated",
  read_skill: "read-only",
} as const satisfies Record<string, "read-only" | "approval-gated">;

export type ToolRisk = (typeof TOOL_RISK)[keyof typeof TOOL_RISK];

export type ToolFamily = "excel" | "github" | "computer" | "cloud" | "skill";

/**
 * Grok `ToolRegistry` port (adapted): every offered tool resolves to one
 * entry carrying its family, risk, and in-turn execution timeout. Timeouts
 * used to be hardcoded literals at each dispatch branch (20s/10s); they now
 * live here so a new tool family appends one row + one branch instead of
 * touching dispatch. Approval-gated tools never execute in-turn (they only
 * propose), so they carry no `timeoutMs`. The annotation test below fails if
 * any offered tool lacks an entry — same discipline as `TOOL_RISK`.
 */
const FAMILY_TIMEOUT_MS: Record<ToolFamily, number> = {
  excel: 20_000,
  github: 20_000,
  cloud: 20_000,
  computer: 10_000,
  skill: 10_000,
};

const familyOfTool = (name: string): ToolFamily => {
  if (EXCEL_TOOL_SET.has(name)) return "excel";
  if (GITHUB_TOOL_NAMES.has(name)) return "github";
  if (COMPUTER_TOOL_NAMES.has(name)) return "computer";
  if (CLOUD_TOOL_NAMES.has(name)) return "cloud";
  return "skill";
};

export type ToolRegistryEntry = {
  family: ToolFamily;
  risk: ToolRisk;
  /** In-turn execution timeout. Absent when the tool only proposes (approval-gated). */
  timeoutMs?: number;
};

const registryEntryFor = (name: string): ToolRegistryEntry => {
  const risk = TOOL_RISK[name as keyof typeof TOOL_RISK];
  const family = familyOfTool(name);
  return risk === "read-only"
    ? { family, risk, timeoutMs: FAMILY_TIMEOUT_MS[family] }
    : { family, risk };
};

export const TOOL_REGISTRY: Record<string, ToolRegistryEntry> = Object.fromEntries(
  allOfferedToolNames().map((name) => [name, registryEntryFor(name)]),
);

/** Execution timeout for a tool, or undefined when it only proposes. */
export function timeoutForTool(name: string): number | undefined {
  return TOOL_REGISTRY[name]?.timeoutMs;
}

/**
 * Grok `ToolErrorWire` port (adapted): every tool failure carries a
 * machine-readable `code` plus a `retryable` flag alongside the existing
 * human `status`/`message` (additive — display readers ignore the new
 * fields). The retry policy reads codes, not strings.
 */
export const TOOL_ERROR_CODES = [
  "POLICY_DENIED",
  "HOOK_DENIED",
  "TIMEOUT",
  "WORKSPACE_UNAVAILABLE",
  "NOT_PREPARED",
  "APPROVAL_REQUIRED",
  "UNKNOWN_TOOL",
  "FAILED",
] as const;

export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[number];

/** Only transient failures are worth retrying; denials, caps, and unknown tools must surface. */
export function retryableForCode(code: ToolErrorCode): boolean {
  return code === "TIMEOUT" || code === "WORKSPACE_UNAVAILABLE";
}

/** Timeout errors carry their code so catchers can route without parsing messages. */
export function toolTimeoutError(label: string): Error & { code: "TIMEOUT"; retryable: true } {
  const error = new Error(`${label} timed out`) as Error & {
    code: "TIMEOUT";
    retryable: true;
  };
  error.code = "TIMEOUT";
  error.retryable = true;
  return error;
}

/** Every tool the agent can be offered, derived from the same registries. */
export function allOfferedToolNames(): string[] {
  return [
    ...EXCEL_TOOLS.map((tool) => tool.function.name),
    ...GITHUB_TOOLS.map((tool) => tool.function.name),
    ...COMPUTER_TOOLS.map((tool) => tool.function.name),
    ...CLOUD_TOOLS.map((tool) => tool.function.name),
    ...SKILL_TOOLS.map((tool) => tool.function.name),
  ];
}

/**
 * FROZEN tool-family order: Excel → GitHub → computer → cloud → skills.
 * Provider prefix-caches key on exact tool-list bytes (OpenAI's own Codex
 * outage was an unsorted tool list), so existing families must never move
 * opportunistically — pinned by test. New families append last only,
 * deliberately, with a cache-bust note: skills appended for the skills
 * loop; cloud appended merging origin/main's cloud computer.
 */
export function orderToolset(input: {
  excel: Tool[];
  github: Tool[];
  computer: Tool[];
  cloud?: Tool[];
  skills?: Tool[];
}): Tool[] {
  return [
    ...input.excel,
    ...input.github,
    ...input.computer,
    ...(input.cloud ?? []),
    ...(input.skills ?? []),
  ];
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
        timer = setTimeout(() => reject(toolTimeoutError(label)), ms);
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
  /** Detached runs persist the validated proposal with their fenced attempt. */
  prepareBackgroundApproval?: (name: string, args: Record<string, unknown>, summary: string) => AgentToolExecution;
}): Promise<AgentToolExecution> {
  const { userId, botId, taskId, name } = input;
  let rawArgs = input.rawArgs;

  // Static deny layer (grok compiled-deny port): evaluated before any family
  // branch, so deny wins over modes and grants. Empty by default (no-op).
  const verdict = checkToolPolicy(sniffPolicyHints(rawArgs), loadToolPolicyFromEnv());
  if (!verdict.allowed) {
    return {
      traceStep: { kind: "tool", title: "Blocked by policy" },
      resultPayload: {
        status: "denied",
        code: verdict.code,
        retryable: false,
        message: verdict.reason,
      },
    };
  }

  // PreToolUse hooks (grok exit-code-2 port): first deny wins, rewrites merge
  // silently, crashes fail open. Empty registry by default (pass-through).
  try {
    const parsed = JSON.parse(rawArgs || "{}") as unknown;
    const hookArgs =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    const pre = await runPreToolUse({ event: "PreToolUse", toolName: name, args: hookArgs });
    if (pre.verdict.decision === "deny") {
      return {
        traceStep: { kind: "tool", title: "Blocked by hook" },
        resultPayload: {
          status: "denied",
          code: "HOOK_DENIED",
          retryable: false,
          message:
            pre.verdict.decision === "deny" && "reason" in pre.verdict && pre.verdict.reason
              ? pre.verdict.reason
              : "Blocked by a PreToolUse hook.",
        },
      };
    }
    if (pre.updatedArgs) rawArgs = JSON.stringify(pre.updatedArgs);
  } catch {
    // Fail open: hooks never break dispatch. Falls through to family branches.
  }

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
          timeoutForTool(githubTool) ?? 20_000,
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
            timeoutForTool(computerTool) ?? 10_000,
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
          code: "NOT_PREPARED",
          retryable: false,
          message:
            "Two computer tasks are already proposed this turn. Present those first instead of proposing more.",
        },
      };
    }
    const proposalArgs = args as { title: string; url?: string; detail?: string };
    if (input.prepareBackgroundApproval) return input.prepareBackgroundApproval(name, proposalArgs, proposalArgs.title);
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
            code: "NOT_PREPARED",
            retryable: false,
            message:
              "One Excel change is already waiting for approval. Do not propose another write in this turn.",
          },
        };
      }
      const summary = excelWriteSummary(excelTool, args);
      if (input.prepareBackgroundApproval) return input.prepareBackgroundApproval(name, args, summary);
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
          timeoutForTool(excelTool) ?? 20_000,
          `Excel tool ${excelTool}`,
        ),
      },
    };
  }

  if (CLOUD_TOOL_NAMES.has(name)) {
    const cloudTool = name as CloudToolName;
    const args = parseCloudToolArguments(cloudTool, rawArgs);
    const argRecord = args as Record<string, unknown>;
    if (CLOUD_SENSITIVE_TOOL_NAMES.has(cloudTool)) {
      if (input.computerProposals.length >= 1) {
        return {
          traceStep: step(cloudTraceTitle(cloudTool, argRecord)),
          resultPayload: {
            status: "not_prepared",
            code: "NOT_PREPARED",
            retryable: false,
            message:
              "One computer action is already waiting for approval in this turn. Wait for the user to approve it before proposing another.",
          },
        };
      }
      if (input.prepareBackgroundApproval) return input.prepareBackgroundApproval(name, argRecord, cloudTraceTitle(cloudTool, argRecord));
      const proposal = await prepareComputerCommandProposal({
        userId: input.userId,
        botId: input.botId,
        name: cloudTool as "computer_run_command" | "computer_write_file",
        args: args as { command?: string; cwd?: string; path?: string; content?: string },
      });
      input.computerProposals.push({
        proposalId: proposal.commandId,
        title: proposal.summary,
        detail:
          proposal.target === "local"
            ? "Runs on your computer once approved"
            : "Runs in the cloud sandbox once approved",
      });
      return {
        traceStep: step(cloudTraceTitle(cloudTool, argRecord), proposal.summary),
        resultPayload: {
          status: "approval_required",
          command_id: proposal.commandId,
          summary: proposal.summary,
          target: proposal.target,
        },
      };
    }
    return {
      traceStep: step(cloudTraceTitle(cloudTool, argRecord)),
      resultPayload: {
        status: "completed",
        result: await withToolTimeout(
          executeCloudReadTool({
            userId: input.userId,
            botId: input.botId,
            name: cloudTool as "computer_read_file" | "computer_list_files",
            args: argRecord,
          }),
          timeoutForTool(cloudTool) ?? 20_000,
          `Cloud tool ${cloudTool}`,
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
        timeoutForTool(skillTool) ?? 10_000,
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
      code: "UNKNOWN_TOOL",
      retryable: false,
      message: `Unknown tool “${name}”. Available tools are Excel (${input.excelConnected ? "connected" : "not connected"}), GitHub (${input.githubConnected ? "connected" : "not connected"}), the computer tools (computer_status, computer_propose_task), and read_skill for Rook skill procedures. Do not retry this call.`,
    },
  };
}

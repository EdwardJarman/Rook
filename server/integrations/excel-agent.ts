import type { Message } from "../_core/llm";
import type { Request } from "express";
import { invokeAi } from "../ai";
import * as db from "../db";
import { githubConnectionStatus, isGithubConfigured } from "./github";
import { cloudComputerStatusForAgent } from "./cloud-computer";
import {
  CLOUD_SENSITIVE_TOOL_NAMES,
  CLOUD_TOOLS,
  CLOUD_TOOL_NAMES,
  cloudCommandSummary,
  cloudTraceTitle,
  executeComputerReadTool,
  parseCloudToolArguments,
  prepareComputerCommandProposal,
  type CloudToolName,
} from "./cloud-tools";
import {
  executeGithubReadTool,
  GITHUB_TOOLS,
  GITHUB_TOOL_NAMES,
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
  isMicrosoftExcelConfigured,
  makeExcelActionId,
  microsoftConnectionStatus,
} from "./microsoft-excel";
import { searchPublicWeb } from "./web-research";
import type { AgentTraceStep } from "../../shared/agent-trace";

const shouldSearchPublicWeb = (message: string) => {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > 240) return false;
  if (
    /\b(password|passcode|token|secret|api key|private key|account number)\b/i.test(
      normalized,
    )
  ) {
    return false;
  }
  // Deliberately narrow: date/time questions are answered from the live
  // clock context, so words like "today" must not trigger a web search
  // (it added latency to the most common casual messages).
  return /\b(search(?: the)? web|look(?: it)? up|research|latest news|current (?:news|price|version)|price of|weather|score)\b/i.test(
    normalized,
  );
};

/**
 * Some free OpenRouter models emit internal classifier scaffolding
 * ("User Safety: safe", "Response Safety: safe") as part of their text.
 * Never show that to the user.
 */
const SCAFFOLD_LINE =
  /^\s*(?:user safety|response safety|safety(?: level)?|moderation|classification)\s*[:：].*$/i;

const stripScaffolding = (text: string): string => {
  const lines = text.split("\n").filter((line) => !SCAFFOLD_LINE.test(line));
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const excelTraceTitle = (name: ExcelToolName, args?: Record<string, unknown>) => {
  if (EXCEL_WRITE_TOOL_NAMES.has(name)) {
    try {
      const summary = args ? excelWriteSummary(name, args) : "";
      if (summary) return summary;
    } catch {
      // Fall through to the generic proposal label.
    }
    return "Prepared an Excel update for approval";
  }
  if (name === "excel_read_range")
    return `Checked Excel ${args?.workbook_name ? `${String(args.workbook_name)} · ` : ""}${args?.worksheet ? `${String(args.worksheet)}!` : ""}${args?.address ? String(args.address) : "range"}`;
  if (name === "excel_list_worksheets")
    return `Listed worksheets in ${args?.workbook_name ? String(args.workbook_name) : "the workbook"}`;
  if (name === "excel_list_tables")
    return `Listed tables in ${args?.workbook_name ? String(args.workbook_name) : "the workbook"}`;
  return "Listed Excel workbooks";
};

const toolResultText = (value: unknown) => {
  const serialized = JSON.stringify(value);
  return serialized.length <= 24_000
    ? serialized
    : `${serialized.slice(0, 24_000)}… (result truncated; request a smaller range)`;
};

const SECOND_TRIM_LIMIT = 96;

const trimSecondLine = (value: string) =>
  value.length <= SECOND_TRIM_LIMIT ? value : `${value.slice(0, SECOND_TRIM_LIMIT)}…`;

const summarizeCellValue = (value: unknown): string => {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value.trim() ? trimSecondLine(value.trim()) : "—";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "…";
};

const summarizeExcelOutcome = (
  name: string,
  result: unknown,
): { title: string; detail?: string } | undefined => {
  if (!result || typeof result !== "object") return undefined;
  const record = result as Record<string, unknown>;
  if (name === "excel_list_workbooks" && Array.isArray(record.workbooks)) {
    const names = record.workbooks
      .slice(0, 3)
      .map((entry) => String((entry as Record<string, unknown>)?.name ?? "").trim())
      .filter(Boolean);
    return {
      title: `Found ${record.workbooks.length} workbook${record.workbooks.length === 1 ? "" : "s"}`,
      detail: names.length ? names.join(", ") : undefined,
    };
  }
  if (name === "excel_list_worksheets" && Array.isArray(record.worksheets)) {
    const names = record.worksheets
      .slice(0, 4)
      .map((entry) => String((entry as Record<string, unknown>)?.name ?? "").trim())
      .filter(Boolean);
    return {
      title: `Found ${record.worksheets.length} worksheet${record.worksheets.length === 1 ? "" : "s"}`,
      detail: names.length ? names.join(", ") : undefined,
    };
  }
  if (name === "excel_list_tables" && Array.isArray(record.tables)) {
    return { title: `Found ${record.tables.length} table${record.tables.length === 1 ? "" : "s"}` };
  }
  if (name === "excel_read_range") {
    const values = record.values as unknown[][] | undefined;
    const formulas = record.formulas as unknown[][] | undefined;
    const cells = Array.isArray(values)
      ? values.flat().filter((cell) => cell !== null && cell !== "" && cell !== undefined)
      : [];
    const headline =
      cells.length > 0
        ? `Read ${cells.length} value${cells.length === 1 ? "" : "s"} — first: ${summarizeCellValue(cells[0])}`
        : "Read the range (all values blank)";
    const detail = Array.isArray(formulas)
      ? formulas.flat().filter((cell) => typeof cell === "string" && String(cell).startsWith("=")).length > 0
        ? "Includes formulas"
        : undefined
      : undefined;
    return { title: headline, detail };
  }
  return undefined;
};

const summarizeGithubOutcome = (
  name: string,
  result: unknown,
): { title: string; detail?: string } | undefined => {
  if (!result || typeof result !== "object") return undefined;
  const record = result as Record<string, unknown>;
  if (name === "github_repo_overview") {
    return {
      title: `Checked ${String(record.fullName ?? "the repository")}`,
      detail:
        typeof record.description === "string" && record.description.trim()
          ? trimSecondLine(record.description.trim())
          : undefined,
    };
  }
  if (name === "github_list_files" && Array.isArray(record.entries)) {
    return { title: `Listed ${record.entries.length} file${record.entries.length === 1 ? "" : "s"}` };
  }
  if (name === "github_read_file") {
    const content = typeof record.content === "string" ? record.content : "";
    const lines = content.split("\n").filter((line) => line.trim());
    return {
      title: `Read ${String(record.path ?? "the file")}`,
      detail: lines.length ? `${lines.length} lines${content.length > 4000 ? " (truncated)" : ""}` : undefined,
    };
  }
  return undefined;
};

const summarizeComputerOutcome = (
  name: string,
  result: unknown,
): { title: string; detail?: string } | undefined => {
  if (!result || typeof result !== "object") return undefined;
  const record = result as Record<string, unknown>;
  if (name === "computer_read_file") {
    const content = typeof record.content === "string" ? record.content : "";
    const lines = content.split("\n").filter((line) => line.trim());
    return {
      title: `Read ${String(record.path ?? "the file")}`,
      detail: lines.length ? `${lines.length} lines${content.length > 4000 ? " (truncated)" : ""}` : undefined,
    };
  }
  if (name === "computer_list_files" && Array.isArray(record.entries)) {
    return { title: `Listed ${record.entries.length} file${record.entries.length === 1 ? "" : "s"}` };
  }
  return undefined;
};

/** Concrete "what actually ran" line for a read tool after it completes. */
const describeToolOutcome = (
  name: string,
  args: Record<string, unknown>,
  result: unknown,
): { title: string; detail?: string } => {
  const outcome =
    summarizeComputerOutcome(name, result) ??
    summarizeGithubOutcome(name, result) ??
    summarizeExcelOutcome(name, result);
  if (outcome) return outcome;
  if (CLOUD_TOOL_NAMES.has(name))
    return {
      title: cloudTraceTitle(
        name as Parameters<typeof cloudTraceTitle>[0],
        args,
      ),
    };
  return { title: toolNameForTrace(name) };
};

const toolNameForTrace = (name: string) => {
  try {
    if (CLOUD_TOOL_NAMES.has(name))
      return cloudCommandSummary(name as "computer_run_command", {});
  } catch {
    // Fall through to the raw name.
  }
  return name.replace(/_/g, " ");
};

export type ExcelAgentApproval = {
  actionId: string;
  title: string;
  detail: string;
  risk: "Medium";
  /** Which approval resolver owns this proposal (excel vs local vs cloud). */
  kind?: "excel" | "local" | "cloud";
};

export function agentClockContext(
  now = new Date(),
  requestedTimeZone?: string,
) {
  let timeZone = requestedTimeZone?.trim() || "UTC";
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone }).format(now);
  } catch {
    timeZone = "UTC";
  }
  const local = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone,
    timeZoneName: "long",
  }).format(now);
  return { iso: now.toISOString(), timeZone, local };
}

export async function runRookAgent(input: {
  userId: string;
  request?: Request;
  botId: string;
  taskId: string;
  botName: string;
  botRole: string;
  botPurpose: string;
  model?: string;
  message: string;
  userTimeZone?: string;
  connectors?: Array<"microsoft-excel" | "github">;
  recentContext: Array<{ author: "user" | "bot" | "system"; body: string }>;
}) {
  // "auto" (what bots default to) must resolve to the curated free-model
  // picker; only a real catalog id may bypass it.
  const requested = input.model?.trim().toLowerCase() || "";
  const requestedModel =
    !requested ||
    ["auto", "openrouter/auto", "openrouter/free"].includes(requested)
      ? "openrouter/free"
      : input.model!.trim();
  const clock = agentClockContext(new Date(), input.userTimeZone);

  const connection = isMicrosoftExcelConfigured()
    ? await microsoftConnectionStatus(input.userId)
    : {
        configured: false,
        connected: false,
        needsReauthorization: false,
        accounts: [] as Awaited<
          ReturnType<typeof microsoftConnectionStatus>
        >["accounts"],
      };
  const github = isGithubConfigured()
    ? await githubConnectionStatus(input.userId)
    : {
        configured: false,
        connected: false,
        needsReauthorization: false,
        login: null as string | null,
        selectedRepos: [] as Awaited<
          ReturnType<typeof githubConnectionStatus>
        >["selectedRepos"],
      };
  const githubWorkingSet = github.selectedRepos.length
    ? github.selectedRepos
        .map(
          (repo) =>
            `${repo.fullName}${repo.privateRepo ? " (private)" : ""}${repo.defaultBranch ? ` [${repo.defaultBranch}]` : ""}`,
        )
        .join(", ")
    : "";
  const computer = await cloudComputerStatusForAgent(input.userId);
  const toolset = [
    ...(connection.connected ? EXCEL_TOOLS : []),
    ...(github.connected && github.selectedRepos.length ? GITHUB_TOOLS : []),
    ...(computer.toolsAvailable ? CLOUD_TOOLS : []),
  ];
  const tools = toolset.length ? toolset : undefined;
  const excelSelected = input.connectors?.includes("microsoft-excel") === true;
  const githubSelected = input.connectors?.includes("github") === true;
  const connectionNote = connection.connected
    ? `Microsoft Excel is connected.${excelSelected ? " The user explicitly attached Microsoft Excel to this message, so treat workbook context as relevant and use the tools when needed." : ""}${
        connection.accounts.length > 1
          ? ` The user has ${connection.accounts.length} Microsoft accounts connected (${connection.accounts.map((account) => account.email || account.displayName || account.accountId).join(", ")}). Tools default to the primary account; pass account_id when the user names a different one.`
          : ""
      } Use the Excel tools whenever the user asks about a workbook. Never guess workbook, worksheet, range, table, value, or formula data: inspect it with tools. Read tools may run immediately. Every write tool is only a proposal and is never executed until the user approves it right in the chat. Prepare no more than one write action per turn unless the user explicitly requests a batch.`
    : connection.needsReauthorization
      ? "Microsoft Excel needs to be reconnected. Tell the user to open Account → Microsoft Excel and reconnect it if this request needs workbook access."
      : connection.configured
        ? "Microsoft Excel is available but not connected for this user. Tell them to open Account → Microsoft Excel and connect it if this request needs workbook access."
        : "Microsoft Excel is not configured for this deployment. Do not claim workbook access.";
  const githubNote = github.connected
    ? github.selectedRepos.length
      ? `\n\nGitHub is connected${github.login ? ` as ${github.login}` : ""}.${githubSelected ? " The user explicitly attached GitHub to this message, so treat repository context as relevant and use the GitHub tools when needed." : ""} The user selected these repositories as the working set: ${githubWorkingSet}. The GitHub tools can only access those repositories. When the user asks about their code, inspect real files with the tools instead of guessing; start with github_list_files or github_repo_overview, then github_read_file for exact contents. GitHub access is read-only.`
      : `\n\nGitHub is connected${github.login ? ` as ${github.login}` : ""} but no repositories are selected. Tell the user to open Account → GitHub and pick repositories to work on if this request needs code access.`
    : github.needsReauthorization
      ? "\n\nGitHub needs to be reconnected. Tell the user to open Account → GitHub and reconnect it if this request needs repository access."
      : github.configured
        ? "\n\nGitHub is available but not connected for this user. Tell them to open Account → GitHub and connect it if this request needs repository access."
        : "";
  const cloudNote = computer.agentNote;

  const publicSearchQuery = shouldSearchPublicWeb(input.message)
    ? input.message.replace(/\s+/g, " ").trim()
    : "";
  const publicSearchResults = publicSearchQuery
    ? await searchPublicWeb(publicSearchQuery)
    : [];
  const publicSearchContext = publicSearchResults.length
    ? `\n\nRook ran a public web search for this request. These are search-result snippets, not full page contents. Use them only when relevant, do not invent details beyond them, and make uncertainty clear:\n${publicSearchResults
        .map(
          (result, index) =>
            `${index + 1}. ${result.title} — ${result.url}${result.snippet ? `\n${result.snippet}` : ""}`,
        )
        .join("\n")}`
    : "";
  const traceClock = Date.now();
  const trace: AgentTraceStep[] = [
    ...(publicSearchQuery
      ? [
          {
            kind: "search" as const,
            title: `Searched the web for “${publicSearchQuery.length > 80 ? `${publicSearchQuery.slice(0, 80)}…` : publicSearchQuery}”`,
            atMs: 0,
          },
          ...publicSearchResults.map((result) => ({
            kind: "source" as const,
            title: result.title,
            detail: "Public search result",
            url: result.url,
            atMs: Date.now() - traceClock,
          })),
        ]
      : []),
  ];

  const messages: Message[] = [
    {
      role: "system",
      content: `You are ${input.botName}, a ${input.botRole} in Rook. Purpose: ${input.botPurpose}\n\nThe user selected this exact Rook model route: ${requestedModel}. This route is user-visible and safe to report. If asked which AI model you are, report that selected route accurately instead of guessing from training data.\n\nLive clock at the start of this request: ${clock.local} (${clock.timeZone}). Canonical timestamp: ${clock.iso}. This clock is generated fresh by Rook for every request. Use it for date and time questions and be explicit about the timezone when relevant.\n\nYou are a warm, natural, direct AI teammate — like a sharp colleague, not a form. Talk like a person: short sentences, plain words, no corporate filler, no restating the question. Answer what was actually asked; for small talk, be human first and helpful second. When a request is ambiguous, make the most reasonable assumption, say it in one line, and answer anyway. Use markdown lightly (bold for key facts, lists when enumerating, code blocks for code). State assumptions when information is missing. ${connectionNote} Never claim an external action succeeded unless its tool result explicitly confirms success. If Rook provides public web search results, treat them as search results rather than page contents, and never claim you opened a source unless that actually occurred. Never reveal other internal IDs, access tokens, raw tool implementation details, private reasoning, or any internal safety or moderation annotations.${githubNote}${cloudNote}${publicSearchContext}`,
    },
    ...input.recentContext.map((entry) => ({
      role:
        entry.author === "bot"
          ? ("assistant" as const)
          : entry.author === "system"
            ? ("system" as const)
            : ("user" as const),
      content: entry.body,
    })),
    { role: "user", content: input.message },
  ];

  const approvals: ExcelAgentApproval[] = [];
  const usedTools: string[] = [];
  let resolvedModel = requestedModel;

  for (let round = 0; round < 6; round += 1) {
    const response = await invokeAi(
      {
        model: requestedModel,
        messages,
        tools,
        toolChoice: tools ? "auto" : undefined,
        maxTokens: 900,
      },
      input.request,
    );
    resolvedModel = response.model || resolvedModel;
    const answer = response.choices[0]?.message;
    if (!answer) throw new Error("The model did not return a response");
    const calls = answer.tool_calls ?? [];
    if (!calls.length) {
      const text =
        typeof answer.content === "string"
          ? stripScaffolding(answer.content.trim())
          : "";
      return {
        text:
          text ||
          (approvals.length
            ? "I've prepared it for your approval — confirm it right here in this chat."
            : "I could not produce a usable answer. Please try again."),
        model: resolvedModel,
        approvals,
        usedTools,
        trace,
        excelConnected: connection.connected,
        githubConnected: github.connected && github.selectedRepos.length > 0,
      };
    }

    messages.push({
      role: "assistant",
      content: typeof answer.content === "string" ? answer.content : "",
      tool_calls: calls,
    });

    for (const call of calls) {
      const name = call.function.name;
      usedTools.push(name);
      let toolResult: unknown;
      try {
        if (GITHUB_TOOL_NAMES.has(name)) {
          const githubTool = name as GithubToolName;
          const args = parseGithubToolArguments(
            githubTool,
            call.function.arguments,
          );
          trace.push({
            kind: "tool",
            title: githubToolTraceTitle(githubTool, args),
            atMs: Date.now() - traceClock,
          });
          {
            const toolOutcome: unknown = await executeGithubReadTool(
              input.userId,
              githubTool,
              args,
            );
            const described = describeToolOutcome(githubTool, args, toolOutcome);
            trace.push({
              kind: "tool",
              title: described.title,
              detail: described.detail,
              atMs: Date.now() - traceClock,
            });
            toolResult = { status: "completed", result: toolOutcome };
          }
        } else if (CLOUD_TOOL_NAMES.has(name)) {
          const cloudTool = name as CloudToolName;
          const args = parseCloudToolArguments(
            cloudTool,
            call.function.arguments,
          );
          trace.push({
            kind: "tool",
            title: cloudTraceTitle(cloudTool, args),
            atMs: Date.now() - traceClock,
          });
          if (CLOUD_SENSITIVE_TOOL_NAMES.has(cloudTool)) {
            if (approvals.some((entry) => entry.kind !== undefined)) {
              toolResult = {
                status: "not_prepared",
                message:
                  "One computer action is already waiting for approval in this turn. Wait for the user to approve it before proposing another.",
              };
            } else {
              const proposal = await prepareComputerCommandProposal({
                userId: input.userId,
                botId: input.botId,
                name: cloudTool as "computer_run_command" | "computer_write_file",
                args,
              });
              approvals.push({
                actionId: proposal.commandId,
                title: "Approve computer action",
                detail: `${proposal.summary} (${proposal.target === "local" ? "on your computer" : "in the cloud sandbox"})`,
                risk: "Medium",
                kind: proposal.target,
              });
              toolResult = {
                status: "approval_required",
                command_id: proposal.commandId,
                summary: proposal.summary,
                target: proposal.target,
              };
            }
          } else {
            const toolOutcome: unknown = await executeComputerReadTool({
              userId: input.userId,
              botId: input.botId,
              name: cloudTool as "computer_read_file" | "computer_list_files",
              args,
            });
            const described = describeToolOutcome(cloudTool, args, toolOutcome);
            trace.push({
              kind: "tool",
              title: described.title,
              detail: described.detail,
              atMs: Date.now() - traceClock,
            });
            toolResult = { status: "completed", result: toolOutcome };
          }        } else {
          const excelTool = name as ExcelToolName;
          const args = parseExcelToolArguments(
            excelTool,
            call.function.arguments,
          );
          trace.push({
            kind: "tool",
            title: excelTraceTitle(excelTool, args),
            atMs: Date.now() - traceClock,
          });
          if (EXCEL_WRITE_TOOL_NAMES.has(excelTool)) {
            if (approvals.length) {
              toolResult = {
                status: "not_prepared",
                message:
                  "One Excel change is already waiting for approval. Do not propose another write in this turn.",
              };
            } else {
              const summary = excelWriteSummary(excelTool, args);
              const actionId = makeExcelActionId();
              await db.createExcelPendingAction({
                id: actionId,
                userId: input.userId,
                botClientId: input.botId,
                taskClientId: input.taskId,
                toolName: excelTool,
                arguments: args,
                summary,
                state: "pending",
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
              });
              approvals.push({
                actionId,
                title: "Approve Excel change",
                detail: summary,
                risk: "Medium",
              });
              toolResult = {
                status: "approval_required",
                action_id: actionId,
                summary,
              };
            }
          } else {
            const toolOutcome: unknown = await executeExcelReadTool(
              input.userId,
              excelTool,
              args,
            );
            const described = describeToolOutcome(excelTool, args, toolOutcome);
            trace.push({
              kind: "tool",
              title: described.title,
              detail: described.detail,
              atMs: Date.now() - traceClock,
            });
            toolResult = { status: "completed", result: toolOutcome };
          }
        }
      } catch (error) {
        const failure =
          error instanceof Error ? error.message : "Connected tool failed";
        trace.push({
          kind: "tool",
          title: `Could not finish: ${toolNameForTrace(name)}`,
          detail: failure,
          atMs: Date.now() - traceClock,
        });
        toolResult = { status: "error", message: failure };
      }
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: toolResultText(toolResult),
      });
    }
  }

  return {
    text: approvals.length
      ? "I've prepared it for your approval — confirm it right here in this chat."
      : "I reached the tool limit for this turn. Try asking for a smaller range or one operation at a time.",
    model: resolvedModel,
    approvals,
    usedTools,
    trace,
    excelConnected: connection.connected,
    githubConnected: github.connected && github.selectedRepos.length > 0,
  };
}

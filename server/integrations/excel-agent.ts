import type { Message } from "../_core/llm";
import type { Request } from "express";
import { invokeAi } from "../ai";
import * as db from "../db";
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
  return /\b(search(?: the)? web|look(?: it)? up|research|latest|current|today|news|recent|update|price|weather|score)\b/i.test(
    normalized,
  );
};

const excelTraceTitle = (name: ExcelToolName) =>
  EXCEL_WRITE_TOOL_NAMES.has(name)
    ? "Prepared an Excel update for approval"
    : "Checked connected Excel data";

const toolResultText = (value: unknown) => {
  const serialized = JSON.stringify(value);
  return serialized.length <= 24_000
    ? serialized
    : `${serialized.slice(0, 24_000)}… (result truncated; request a smaller range)`;
};

export type ExcelAgentApproval = {
  actionId: string;
  title: string;
  detail: string;
  risk: "Medium";
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
  connectors?: Array<"microsoft-excel">;
  recentContext: Array<{ author: "user" | "bot" | "system"; body: string }>;
}) {
  const requestedModel = input.model?.trim() || "openrouter/free";
  const clock = agentClockContext(new Date(), input.userTimeZone);

  const connection = isMicrosoftExcelConfigured()
    ? await microsoftConnectionStatus(input.userId)
    : { configured: false, connected: false, needsReauthorization: false, accounts: [] as Awaited<ReturnType<typeof microsoftConnectionStatus>>["accounts"] };
  const tools = connection.connected ? EXCEL_TOOLS : undefined;
  const excelSelected = input.connectors?.includes("microsoft-excel") === true;
  const connectionNote = connection.connected
    ? `Microsoft Excel is connected.${excelSelected ? " The user explicitly attached Microsoft Excel to this message, so treat workbook context as relevant and use the tools when needed." : ""}${
        connection.accounts.length > 1
          ? ` The user has ${connection.accounts.length} Microsoft accounts connected (${connection.accounts.map((account) => account.email || account.displayName || account.accountId).join(", ")}). Tools default to the primary account; pass account_id when the user names a different one.`
          : ""
      } Use the Excel tools whenever the user asks about a workbook. Never guess workbook, worksheet, range, table, value, or formula data: inspect it with tools. Read tools may run immediately. Every write tool is only a proposal and is never executed until the user approves it in Rook Updates. Prepare no more than one write action per turn unless the user explicitly requests a batch.`
    : connection.needsReauthorization
      ? "Microsoft Excel needs to be reconnected. Tell the user to open Account → Microsoft Excel and reconnect it if this request needs workbook access."
      : connection.configured
        ? "Microsoft Excel is available but not connected for this user. Tell them to open Account → Microsoft Excel and connect it if this request needs workbook access."
        : "Microsoft Excel is not configured for this deployment. Do not claim workbook access.";

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
  const trace: AgentTraceStep[] = [
    { kind: "context", title: "Read the room context" },
    ...(publicSearchQuery
      ? [
          {
            kind: "search" as const,
            title: "Searched the public web",
            detail: publicSearchQuery,
          },
          ...publicSearchResults.map((result) => ({
            kind: "source" as const,
            title: result.title,
            detail: "Public search result",
            url: result.url,
          })),
        ]
      : []),
    { kind: "response", title: "Prepared a response" },
  ];

  const messages: Message[] = [
    {
      role: "system",
      content: `You are ${input.botName}, a ${input.botRole} in Rook. Purpose: ${input.botPurpose}\n\nThe user selected this exact Rook model route: ${requestedModel}. This route is user-visible and safe to report. If asked which AI model you are, report that selected route accurately instead of guessing from training data.\n\nLive clock at the start of this request: ${clock.local} (${clock.timeZone}). Canonical timestamp: ${clock.iso}. This clock is generated fresh by Rook for every request. Use it for date and time questions and be explicit about the timezone when relevant.\n\nYou are a calm, precise AI teammate. Respond with a concise, useful working note. State assumptions when information is missing. ${connectionNote} Never claim an external action succeeded unless its tool result explicitly confirms success. If Rook provides public web search results, treat them as search results rather than page contents, and never claim you opened a source unless that actually occurred. Never reveal other internal IDs, access tokens, raw tool implementation details, or private reasoning.${publicSearchContext}`,
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
        typeof answer.content === "string" ? answer.content.trim() : "";
      return {
        text:
          text ||
          (approvals.length
            ? "I prepared the Excel change and paused for your approval in Updates."
            : "I could not produce a usable answer. Please try again."),
        model: resolvedModel,
        approvals,
        usedTools,
        trace,
        excelConnected: connection.connected,
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
        const excelTool = name as ExcelToolName;
        const args = parseExcelToolArguments(
          excelTool,
          call.function.arguments,
        );
        trace.push({ kind: "tool", title: excelTraceTitle(excelTool) });
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
          toolResult = {
            status: "completed",
            result: await executeExcelReadTool(input.userId, excelTool, args),
          };
        }
      } catch (error) {
        trace.push({
          kind: "tool",
          title: "A connected-tool step could not be completed",
        });
        toolResult = {
          status: "error",
          message:
            error instanceof Error ? error.message : "Connected tool failed",
        };
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
      ? "I prepared the Excel change and paused for your approval in Updates."
      : "I reached the Excel tool limit for this turn. Try asking for a smaller workbook range or one operation at a time.",
    model: resolvedModel,
    approvals,
    usedTools,
    trace,
    excelConnected: connection.connected,
  };
}

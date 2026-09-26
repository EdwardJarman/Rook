import type { InvokeResult, Message, Tool } from "../_core/llm";
import type { Request } from "express";
import { randomUUID } from "node:crypto";
import { invokeAiResilient } from "../ai/fallback-router";
import { collectOpenCodeFiles } from "../ai/opencode";
import {
  SKILL_TOOLS,
  attachedSkillBlock,
  listSkills,
  skillCatalogBlock,
} from "../ai/skills";
import { recordTurn } from "../ai/telemetry";
import { getComputerPromptState } from "../ai/computer-context";
import { buildRookSystemPrompt } from "../ai/system-prompt";
import {
  buildMemoryBlock,
  extractMemoryCandidates,
  type MemoryCandidate,
} from "../ai/memory";
import {
  MAX_OUTPUT_CONTINUATIONS,
  OUTPUT_LIMIT_TAIL,
  ROOK_AGENT_MAX_ROUNDS,
  ROOK_TURN_TOOL_BUDGET_CHARS,
  backoffSleep,
  filterRelevantContext,
  friendlyAgentError,
  isCodeLikeRequest,
  isMaxTokensError,
  isTransientAgentError,
  maxTokensFor,
  parseRetryAfterMs,
  partitionRecentContext,
  reasoningFor,
  shouldSearchPublicWeb,
  stripScaffolding,
  toolCallFingerprint,
  toolResultText,
  type ReasoningEffort,
} from "../ai/agent-reliability";
import { buildCheckpointLedger } from "../ai/compaction";
import { resolveRequestedModel } from "../ai/turn-context";
import { githubConnectionStatus, isGithubConfigured } from "./github";
import { GITHUB_TOOLS } from "./github-tools";
import { EXCEL_TOOLS } from "./excel-tools";
import {
  COMPUTER_TOOLS,
  type ComputerProposal,
} from "./computer-tools";
import { CLOUD_TOOLS } from "./cloud-tools";
import { isCloudComputerConfigured } from "./cloud-computer";
import { executeAgentTool, orderToolset } from "./agent-tool-executor";
import {
  isMicrosoftExcelConfigured,
  makeExcelActionId,
  microsoftConnectionStatus,
} from "./microsoft-excel";
import { searchPublicWeb } from "./web-research";
import type { AgentTraceStep } from "../../shared/agent-trace";


export type ExcelAgentApproval = {
  actionId: string;
  title: string;
  detail: string;
  risk: "Medium";
  /** Which approval resolver owns this proposal (excel vs local vs cloud). */
  kind?: "excel" | "local" | "cloud";
};

/** Approval status, not model prose, determines whether a sensitive action ran. */
export function finalAgentText(
  providerText: string,
  approvals: readonly ExcelAgentApproval[],
): string {
  if (approvals.length) {
    return "I've prepared this action and it is waiting for your approval here in the chat.";
  }
  return providerText || "I could not produce a usable answer. Please try again.";
}

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

/** Run one integration call with a tight timeout so a slow backend can't hang chat. */
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
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

type ExcelStatus = Awaited<ReturnType<typeof microsoftConnectionStatus>>;
type GithubStatus = Awaited<ReturnType<typeof githubConnectionStatus>>;

const DISCONNECTED_EXCEL = {
  configured: false,
  connected: false,
  needsReauthorization: false,
  displayName: null,
  email: null,
  scopes: [],
  connectedAt: null,
  accounts: [],
} as unknown as ExcelStatus;

const DISCONNECTED_GITHUB = {
  configured: false,
  missingEnv: [],
  connected: false,
  needsReauthorization: false,
  login: null,
  displayName: null,
  avatarUrl: null,
  scopes: "",
  connectedAt: null,
  selectedRepos: [],
} as unknown as GithubStatus;

export type RookAgentInput = {
  /** Server-owned detached execution seam. Never accepted from chat clients. */
  durableTurn?: import("../background/runtime").DurableTurn;
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
  /** Skill ids attached to this message (composer Skills section). */
  skillIds?: string[];
  /** Free-text durable memory stored on the Bot (client workroom store). */
  botMemory?: string;
  /**
   * Deep-reasoning depth. "medium" (default) sends no reasoning params —
   * byte-identical to today's requests. "high"/"low" are forwarded where
   * the provider supports them, with automatic retry-without on rejection.
   */
  reasoningEffort?: ReasoningEffort;
  recentContext: Array<{ author: "user" | "bot" | "system"; body: string }>;
};

export type PreparedAgentTurn = {
  requestedModel: string;
  clock: ReturnType<typeof agentClockContext>;
  connection: ExcelStatus;
  github: GithubStatus;
  computer: { paired: boolean; online: boolean; block: string };
  tools: Tool[] | undefined;
  messages: Message[];
  trace: AgentTraceStep[];
  publicSearchQuery: string;
  suggestedMemories: MemoryCandidate[];
  outputBudget: number;
  codeTask: boolean;
  reasoning: { effort: "low" | "high" } | undefined;
};

/**
 * Shared turn setup for BOTH the request/response turn (`runRookAgent`)
 * and the streaming turn (`runRookAgentStream`): capability probes, web
 * search, versioned system prompt, budgeted history. The two loops must
 * never disagree on what the model sees.
 */
export async function prepareAgentTurn(
  input: RookAgentInput,
  requestId: string,
): Promise<PreparedAgentTurn> {
  // "auto" (what bots default to) must resolve to the curated free-model
  // picker; only a real catalog id may bypass it. Pure + pinned in
  // server/ai/turn-context.ts so both agent paths resolve identically.
  const requestedModel = resolveRequestedModel(input.model);
  const clock = agentClockContext(new Date(), input.userTimeZone);

  // Parallelize the three capability probes so the slowest integration
  // (often Excel token refresh) no longer sets chat latency serially.
  // Each is individually timed out + settled: one backend down must never
  // fail the whole turn (v1 awaited them serially with no timeout).
  const [connection, github, computer] = await Promise.all([
    (async (): Promise<ExcelStatus> => {
      if (!isMicrosoftExcelConfigured()) return DISCONNECTED_EXCEL;
      try {
        return await withTimeout(microsoftConnectionStatus(input.userId), 6000, "Excel status");
      } catch (error) {
        console.warn("[RookAI] Excel status probe failed, continuing without it", {
          requestId,
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
        return DISCONNECTED_EXCEL;
      }
    })(),
    (async (): Promise<GithubStatus> => {
      if (!isGithubConfigured()) return DISCONNECTED_GITHUB;
      try {
        return await withTimeout(githubConnectionStatus(input.userId), 6000, "GitHub status");
      } catch (error) {
        console.warn("[RookAI] GitHub status probe failed, continuing without it", {
          requestId,
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
        return DISCONNECTED_GITHUB;
      }
    })(),
    (async () => {
      try {
        return await withTimeout(getComputerPromptState(input.userId), 4000, "Computer status");
      } catch {
        return {
          paired: false,
          online: false,
          block:
            "Rook Node computer status is temporarily unavailable. Do not claim computer access either way; answer from chat context and offer to retry.",
        };
      }
    })(),
  ]);

  const githubWorkingSet = github.selectedRepos.length
    ? github.selectedRepos
        .map(
          (repo) =>
            `${repo.fullName}${repo.privateRepo ? " (private)" : ""}${repo.defaultBranch ? ` [${repo.defaultBranch}]` : ""}`,
        )
        .join(", ")
    : "";
  // Skills ride the same tool loop as every other family: the catalog is
  // one-liners in context, full procedures arrive via read_skill or an
  // explicit attach. Offered only when the registry is non-empty.
  const registrySkills = await listSkills().catch(() => []);
  const toolset = orderToolset({
    excel: connection.connected ? EXCEL_TOOLS : [],
    github: github.connected && github.selectedRepos.length ? GITHUB_TOOLS : [],
    // Computer tools are always offered: computer_status is read-only and
    // safe with no pairing, and proposals never execute without the user.
    computer: COMPUTER_TOOLS,
    // Cloud computer tools when the free sandbox is configured: reads run
    // immediately, run/write are approval-gated proposals like the rest.
    cloud: isCloudComputerConfigured() ? CLOUD_TOOLS : [],
    skills: registrySkills.length ? SKILL_TOOLS : [],
  });
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
      ? `GitHub is connected${github.login ? ` as ${github.login}` : ""}.${githubSelected ? " The user explicitly attached GitHub to this message, so treat repository context as relevant and use the GitHub tools when needed." : ""} The user selected these repositories as the working set: ${githubWorkingSet}. The GitHub tools can only access those repositories. When the user asks about their code, inspect real files with the tools instead of guessing; start with github_list_files or github_repo_overview, then github_read_file for exact contents. GitHub access is read-only.`
      : `GitHub is connected${github.login ? ` as ${github.login}` : ""} but no repositories are selected. Tell the user to open Account → GitHub and pick repositories to work on if this request needs code access.`
    : github.needsReauthorization
      ? "GitHub needs to be reconnected. Tell the user to open Account → GitHub and reconnect it if this request needs repository access."
      : github.configured
        ? "GitHub is available but not connected for this user. Tell them to open Account → GitHub and connect it if this request needs repository access."
        : "GitHub is not configured for this deployment. Do not claim repository access.";
  const cloudNote = isCloudComputerConfigured()
    ? "\n\nThe computer is available. Rook routes computer work to the user's own device (Rook Node) whenever it is online, and falls back to the free Rook Cloud sandbox (a Linux environment with a workspace) when it is not. computer_run_command and computer_write_file are proposals — they never execute until the user approves them right in the chat. computer_read_file and computer_list_files run immediately. Use the computer whenever the user asks you to run code, build or transform something, or work with files; keep commands small and self-contained and capture output with the command itself."
    : "";

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
    : publicSearchQuery
      ? `\n\nRook ran a public web search for this request but found no usable results. Say so if the question needed fresh facts, and answer from what you reliably know.`
      : "";
  const trace: AgentTraceStep[] = [
    { kind: "context", title: "Read the room context" },
    ...(publicSearchQuery
      ? publicSearchResults.length
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
        : [
            {
              kind: "search" as const,
              title: "Searched the public web",
              detail: `${publicSearchQuery} (no results)`,
            },
          ]
      : []),
    { kind: "response", title: "Prepared a response" },
  ];

  // Freshness first, then budget: off-topic past is gated out BEFORE the
  // budget split, so dead topics never reach the model — not even smuggled
  // in via the checkpoint ledger (which condenses relevant overflow only).
  // The last exchange always survives for conversational continuity.
  const { relevant: freshContext } = filterRelevantContext(input.recentContext, input.message);
  // Budget context: system + newest history first, oldest dropped. Dropped
  // turns are condensed into a checkpoint ledger (never silently lost).
  const { kept: fittedHistory, dropped: droppedHistory } = partitionRecentContext(
    freshContext,
    6000,
  );
  const ledgerBlock = buildCheckpointLedger(droppedHistory);

  const memoryBlock = buildMemoryBlock(input.botMemory);
  const suggestedMemories: MemoryCandidate[] = extractMemoryCandidates(input.message);
  // Attached skills inject full procedures (explicit user choice); the
  // catalog stays one-liners so idle turns never pay for unused bodies.
  const attachedBlock = await attachedSkillBlock(input.skillIds).catch(() => "");
  const catalogBlock = registrySkills.length
    ? await skillCatalogBlock().catch(() => "")
    : "";
  const extraContext =
    [memoryBlock, ledgerBlock, publicSearchContext, attachedBlock, catalogBlock]
      .filter(Boolean)
      .join("\n") || undefined;

  const systemPrompt = buildRookSystemPrompt({
    botName: input.botName,
    botRole: input.botRole,
    botPurpose: input.botPurpose,
    modelRoute: requestedModel,
    clockLocal: clock.local,
    clockTimeZone: clock.timeZone,
    clockIso: clock.iso,
    capabilities: {
      computer: `${computer.block}${cloudNote}`,
      excel: connectionNote,
      github: githubNote,
      web: "Public web search runs automatically when the question needs fresh external facts (news, prices, versions, docs). Results arrive as snippets with source titles — never claim you opened a page unless a tool confirms it.",
    },
    extraContext,
  });

  const messages: Message[] = [
    { role: "system", content: systemPrompt },
    ...fittedHistory.map((entry) => ({
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

  const outputBudget = maxTokensFor(input.message);
  const codeTask = isCodeLikeRequest(input.message);
  const reasoning = reasoningFor(input.reasoningEffort);

  return {
    requestedModel,
    clock,
    connection,
    github,
    computer,
    tools,
    messages,
    trace,
    publicSearchQuery,
    suggestedMemories,
    outputBudget,
    codeTask,
    reasoning,
  };
}

export async function runRookAgent(input: RookAgentInput) {
  await input.durableTurn?.guard();
  const requestId = randomUUID().slice(0, 8);
  const startedAt = Date.now();
  const {
    requestedModel,
    connection,
    github,
    computer,
    tools,
    messages,
    trace,
    publicSearchQuery,
    suggestedMemories,
    outputBudget,
    codeTask,
    reasoning,
  } = await prepareAgentTurn(input, requestId);

  const approvals: ExcelAgentApproval[] = [];
  const usedTools: string[] = [];
  const computerProposals: ComputerProposal[] = [];
  const seenToolCalls = new Set<string>();
  let resolvedModel = requestedModel;
  let fellBackToAuto = false;
  let attemptedProviders: string[] = [];
  let toolPayloadChars = 0;
  let effectiveBudget = outputBudget;
  let budgetHalved = false;
  let continuationsUsed = 0;
  let continuedText = "";

  const emitTelemetry = (extra?: { error?: string }) => {
    recordTurn({
      requestId,
      at: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
      model: resolvedModel,
      requestedModel,
      fellBack: fellBackToAuto,
      providers: [...attemptedProviders],
      tools: [...usedTools],
      approvals: approvals.length,
      computerProposals: computerProposals.length,
      continuations: continuationsUsed,
      webSearched: Boolean(publicSearchQuery),
      codeTask,
      ...(extra?.error ? { error: extra.error } : {}),
    });
  };

  const saved = input.durableTurn?.checkpoint;
  if (saved) {
    messages.splice(0, messages.length, ...structuredClone(saved.messages));
    continuedText = saved.continuation?.text ?? "";
    continuationsUsed = saved.continuation?.used ?? 0;
    toolPayloadChars = saved.toolPayloadChars ?? 0;
  }
  for (let round = saved?.round ?? 0; round < ROOK_AGENT_MAX_ROUNDS; round += 1) {
    await input.durableTurn?.guard();
    let response: InvokeResult | undefined;
    const invokeOnce = async () => {
      if (saved && round === saved.round) { response = structuredClone(saved.response); return; }
      await input.durableTurn?.guard();
      const invoked = await invokeAiResilient(
        {
          model: requestedModel,
          messages,
          tools,
          toolChoice: tools ? "auto" : undefined,
          maxTokens: effectiveBudget,
          ...(reasoning ? { reasoning } : {}),
        },
        input.request,
      );
      response = invoked.result;
      attemptedProviders = invoked.attemptedProviders;
      fellBackToAuto = fellBackToAuto || invoked.fellBack;
    };
    try {
      await invokeOnce();
    } catch (error) {
      // A model rejecting max_tokens itself: halve the budget once and
      // retry rather than failing a turn over a too-ambitious request.
      if (isMaxTokensError(error) && !budgetHalved) {
        budgetHalved = true;
        effectiveBudget = Math.max(800, Math.floor(effectiveBudget / 2));
        console.warn("[RookAI] max_tokens rejected, retrying smaller", {
          requestId,
          round,
          effectiveBudget,
        });
        try {
          await invokeOnce();
        } catch (retryError) {
          return friendlyTurnEnd(retryError);
        }
      } else {
        // Transient provider wobble (429/5xx): one jittered retry inside the
        // turn before surfacing a friendly line. Auth/config errors surface
        // immediately — retrying those only burns latency.
        const transient = isTransientAgentError(error);
        if (transient && round === 0) {
          await backoffSleep(0, parseRetryAfterMs(null));
          try {
            await invokeOnce();
          } catch (retryError) {
            console.warn("[RookAI] turn failed after retry", {
              requestId,
              round,
              errorName: retryError instanceof Error ? retryError.name : "UnknownError",
            });
            return friendlyTurnEnd(retryError);
          }
        } else {
          console.warn("[RookAI] turn failed", {
            requestId,
            round,
            errorName: error instanceof Error ? error.name : "UnknownError",
          });
          return friendlyTurnEnd(error);
        }
      }
    }
    resolvedModel = response!.model || resolvedModel;
    if (
      requestedModel !== resolvedModel &&
      (resolvedModel === "openrouter/free" || requestedModel === "openrouter/free")
    ) {
      fellBackToAuto = requestedModel !== resolvedModel;
    }
    const answer = response!.choices[0]?.message;
    if (!answer) throw new Error("The model did not return a response");
    await input.durableTurn?.save({ messages: structuredClone(messages), response: response!, round,
      continuation: { text: continuedText, used: continuationsUsed }, toolPayloadChars });

    // Explicit length-truncation handling: keep writing server-side
    // (up to MAX_OUTPUT_CONTINUATIONS segments) so the user gets a
    // complete answer instead of homework. The tail marker below only
    // appears when even that is exhausted.
    const finishReason = response!.choices[0]?.finish_reason ?? null;
    const calls = answer.tool_calls ?? [];
    if (!calls.length) {
      const rawText =
        typeof answer.content === "string"
          ? answer.content.trim()
          : Array.isArray(answer.content)
            ? answer.content
                .map((part) => (typeof part === "string" ? part : (part as { text?: string }).text ?? ""))
                .join("\n")
                .trim()
            : "";
      if (finishReason === "length" && continuationsUsed < MAX_OUTPUT_CONTINUATIONS && rawText) {
        continuationsUsed += 1;
        continuedText += (continuedText ? "\n" : "") + rawText;
        messages.push({ role: "assistant", content: rawText });
        continue;
      }
      const { clean, stripped } = stripScaffolding(
        continuedText ? `${continuedText}\n${rawText}` : rawText,
      );
      if (stripped > 0) {
        console.warn("[RookAI] stripped scaffolding lines from reply", {
          requestId,
          stripped,
          model: resolvedModel,
        });
      }
      const truncatedNote =
        finishReason === "length" ? OUTPUT_LIMIT_TAIL : "";
      const text =
        (clean ||
          (approvals.length
            ? "I've prepared it for your approval - confirm it right here in this chat."
            : computerProposals.length
              ? "I proposed a computer task below - approve it right here in this chat, then run it from the Computer panel."
              : "")) + truncatedNote;
      const finalText = finalAgentText(
        text.trim() ||
        (approvals.length
          ? "I've prepared it for your approval - confirm it right here in this chat."
          : computerProposals.length
            ? "I proposed a computer task below - approve it right here in this chat, then run it from the Computer panel."
            : friendlyAgentError(new Error("empty reply"))),
        approvals,
      );
      if (continuationsUsed > 0) {
        trace.push({
          kind: "response",
          title: "Kept writing past the output limit",
          detail: `Continued ${continuationsUsed}× for a complete answer`,
        });
      }
      emitTelemetry();
      // OpenCode turns may have built real files: pull them in so the chat
      // offers them as in-browser downloads instead of server-local paths.
      const files = requestedModel.startsWith("opencode:")
        ? await collectOpenCodeFiles(finalText).catch(() => [])
        : [];
      return {
        text: finalText,
        model: resolvedModel,
        requestedModel,
        fellBack: fellBackToAuto,
        attemptedProviders: [...attemptedProviders],
        approvals,
        usedTools,
        trace,
        files,
        excelConnected: connection.connected,
        githubConnected: github.connected && github.selectedRepos.length > 0,
        computerPaired: computer.paired,
        computerOnline: computer.online,
        computerProposals: [...computerProposals],
        suggestedMemories,
        webSearched: Boolean(publicSearchQuery),
        codeTask,
        latencyMs: Date.now() - startedAt,
        requestId,
      };
    }

    messages.push({
      role: "assistant",
      content: typeof answer.content === "string" ? answer.content : "",
      tool_calls: calls,
    });

    for (const call of calls) {
      const name = call.function.name;
      // Loop guard: the same tool+args twice in one turn is a spin, not
      // progress (v1 let it repeat 6x). Break out with what we have.
      const fingerprint = toolCallFingerprint(name, call.function.arguments);
      if (seenToolCalls.has(fingerprint)) {
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({
            status: "not_executed",
            message:
              "That exact call already ran this turn with the same arguments. Use its earlier result instead of calling again. If the result was an error, change the arguments or explain what is blocked.",
          }),
        });
        continue;
      }
      seenToolCalls.add(fingerprint);

      usedTools.push(name);
      // Single source of truth for tool behavior, shared with the
      // streaming turn (see agent-tool-executor.ts).
      let rendered: string;
      try {
        const toolInput = {
          userId: input.userId,
          botId: input.botId,
          taskId: input.taskId,
          name,
          rawArgs: call.function.arguments,
          excelConnected: connection.connected,
          githubConnected: github.connected && github.selectedRepos.length > 0,
          computerOnline: computer.online,
          approvals,
          computerProposals,
        };
        const executed = input.durableTurn
          ? await input.durableTurn.execute(toolInput, () => executeAgentTool(toolInput))
          : await executeAgentTool(toolInput);
        trace.push(executed.traceStep);
        rendered = toolResultText(executed.resultPayload);
      } catch (error) {
        if (input.durableTurn) throw error;
        const failure =
          error instanceof Error ? error.message : "Connected tool failed";
        trace.push({
          kind: "tool",
          title: `Could not finish: ${name.replace(/_/g, " ")}`,
          detail: failure,
        });
        rendered = toolResultText({
          status: "error",
          message:
            error instanceof Error ? error.message : "Connected tool failed",
        });
      }
      toolPayloadChars += rendered.length;
      // Turn budget: stop feeding ever-larger tool dumps into the window.
      if (toolPayloadChars > ROOK_TURN_TOOL_BUDGET_CHARS) {
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({
            status: "truncated",
            message:
              "Tool budget for this turn is exhausted. Summarize what you have so far and ask the user for a narrower next step instead of calling more tools.",
          }),
        });
        break;
      }
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: rendered,
      });
    }
  }

  console.warn("[RookAI] turn hit tool-round limit", {
    requestId,
    model: resolvedModel,
    usedTools,
    latencyMs: Date.now() - startedAt,
  });
  if (input.durableTurn) throw new Error("The background turn reached its round limit.");
  emitTelemetry();
  return {
    text: approvals.length
      ? "I've prepared it for your approval - confirm it right here in this chat."
      : computerProposals.length
        ? "I proposed a computer task below - approve it right here in this chat, then run it from the Computer panel."
        : "I reached the tool limit for this turn. Try asking for a smaller range or one operation at a time.",
    files: [],
    model: resolvedModel,
    requestedModel,
    fellBack: fellBackToAuto,
    attemptedProviders: [...attemptedProviders],
    approvals,
    usedTools,
    trace,
    excelConnected: connection.connected,
    githubConnected: github.connected && github.selectedRepos.length > 0,
    computerPaired: computer.paired,
    computerOnline: computer.online,
    computerProposals: [...computerProposals],
    suggestedMemories,
    webSearched: Boolean(publicSearchQuery),
    codeTask,
    latencyMs: Date.now() - startedAt,
    requestId,
  };

  function friendlyTurnEnd(error: unknown) {
    if (input.durableTurn) throw error;
    const errorMessage =
      error instanceof Error ? error.message.slice(0, 300) : "unknown";
    emitTelemetry({ error: errorMessage });
    return {
      text: friendlyAgentError(error),
      model: resolvedModel,
      requestedModel,
      fellBack: fellBackToAuto,
      attemptedProviders: [...attemptedProviders],
      approvals,
      usedTools,
      trace,
      files: [],
      excelConnected: connection.connected,
      githubConnected: github.connected && github.selectedRepos.length > 0,
      computerPaired: computer.paired,
      computerOnline: computer.online,
      computerProposals: [...computerProposals],
      suggestedMemories,
      webSearched: Boolean(publicSearchQuery),
      codeTask,
      latencyMs: Date.now() - startedAt,
      requestId,
      error: errorMessage,
    };
  }
}

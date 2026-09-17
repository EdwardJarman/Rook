/**
 * Streaming agent turn (v2 loop-mode).
 *
 * Same brain as `runRookAgent` — same `prepareAgentTurn` setup, same
 * `executeAgentTool` dispatcher, same budgets, caps, and friendly errors —
 * but the model is read token-by-token via `invokeAiStream` and every live
 * moment is emitted to the caller:
 *
 * - `{type:"trace"}` as context/search/tool steps happen
 * - `{type:"token"}` as answer text arrives
 * - `{type:"approval"}` / `{type:"proposal"}` the moment one is recorded
 *
 * Resilience contract (no silent duplication, no fake text):
 * - ChatGPT-routed models can't stream: those rounds transparently use the
 *   normal request/response path and the full text is emitted as one token.
 * - A transient failure BEFORE any token falls back to the resilient
 *   non-streaming path for the rest of the turn (today's behavior).
 * - A failure AFTER tokens started keeps the partial text honestly: the
 *   turn ends with what arrived plus a "(cut off…)" note, never a
 *   re-generated replacement that would double-create approvals.
 */

import { randomUUID } from "node:crypto";
import type { Message, ToolCall } from "../_core/llm";
import {
  prepareAgentTurn,
  type RookAgentInput,
} from "../integrations/excel-agent";
import { executeAgentTool } from "../integrations/agent-tool-executor";
import {
  invokeAiStream,
  isStreamUnsupportedError,
  supportsModelStream,
} from "./openai-stream";
import { invokeAiResilient } from "./fallback-router";
import { recordTurn } from "./telemetry";
import {
  MAX_OUTPUT_CONTINUATIONS,
  OUTPUT_LIMIT_TAIL,
  ROOK_AGENT_MAX_ROUNDS,
  ROOK_TURN_TOOL_BUDGET_CHARS,
  backoffSleep,
  friendlyAgentError,
  isMaxTokensError,
  isTransientAgentError,
  parseRetryAfterMs,
  stripScaffolding,
  toolCallFingerprint,
  toolResultText,
} from "./agent-reliability";
import type { AgentTraceStep } from "../../shared/agent-trace";
import type { ExcelAgentApproval } from "../integrations/excel-agent";
import type { ComputerProposal } from "../integrations/computer-tools";

export type AgentStreamEvent =
  | { type: "trace"; step: AgentTraceStep }
  | { type: "token"; delta: string }
  | { type: "approval"; approval: ExcelAgentApproval }
  | { type: "proposal"; proposal: ComputerProposal };

export type AgentStreamEmit = (event: AgentStreamEvent) => void;

/** Thrown when a stream dies after tokens already went out. */
class PartialStreamError extends Error {
  partialText: string;
  constructor(partialText: string) {
    super("Stream cut off mid-answer.");
    this.partialText = partialText;
  }
}

type RoundAnswer = {
  content: string;
  toolCalls: ToolCall[];
  model: string;
  finishReason: string | null;
  files?: Array<{ name: string; mimeType: string; content: string }>;
};

export async function runRookAgentStream(
  input: RookAgentInput,
  emit: AgentStreamEmit,
  signal?: AbortSignal,
) {
  const requestId = randomUUID().slice(0, 8);
  const startedAt = Date.now();
  const setup = await prepareAgentTurn(input, requestId);
  const {
    requestedModel,
    connection,
    github,
    computer,
    tools,
    publicSearchQuery,
    suggestedMemories,
    outputBudget,
    codeTask,
    reasoning,
  } = setup;
  const messages: Message[] = setup.messages;
  const trace: AgentTraceStep[] = [];
  // The prepared trace is static ([context, search?, response]): emit the
  // setup steps now, hold the closing "response" step for the end.
  for (const step of setup.trace.slice(0, -1)) {
    trace.push(step);
    emit({ type: "trace", step });
  }
  const closingStep = setup.trace[setup.trace.length - 1];

  const approvals: ExcelAgentApproval[] = [];
  const usedTools: string[] = [];
  const computerProposals: ComputerProposal[] = [];
  const seenToolCalls = new Set<string>();
  let resolvedModel = requestedModel;
  let fellBackToAuto = false;
  let attemptedProviders: string[] = [];
  let toolPayloadChars = 0;
  let canStream = supportsModelStream(requestedModel);
  let effectiveBudget = outputBudget;
  let budgetHalved = false;
  let continuationsUsed = 0;
  let continuedText = "";
  let turnFiles: RoundAnswer["files"];

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

  const finishText = (
    rawText: string,
    finishReason: string | null,
  ): { text: string; stripped: number } => {
    const { clean, stripped } = stripScaffolding(
      continuedText ? `${continuedText}\n${rawText.trim()}` : rawText.trim(),
    );
    if (stripped > 0) {
      console.warn("[RookAI] stripped scaffolding lines from streamed reply", {
        requestId,
        stripped,
        model: resolvedModel,
      });
    }
    const truncatedNote =
      finishReason === "length" ? OUTPUT_LIMIT_TAIL : "";
    return { text: `${clean}${truncatedNote}`, stripped };
  };

  const endTurn = (text: string) => {
    if (closingStep) {
      trace.push(closingStep);
      emit({ type: "trace", step: closingStep });
    }
    if (continuationsUsed > 0) {
      const step = {
        kind: "response",
        title: "Kept writing past the output limit",
        detail: `Continued ${continuationsUsed}× for a complete answer`,
      } as const;
      trace.push(step);
      emit({ type: "trace", step });
    }
    const finalText =
      text.trim() ||
      (approvals.length
        ? "I've prepared it for your approval - confirm it right here in this chat."
        : computerProposals.length
          ? "I proposed a computer task below - approve it right here in this chat, then run it from the Computer panel."
          : friendlyAgentError(new Error("empty reply")));
    emitTelemetry();
    return {
      text: finalText,
      model: resolvedModel,
      requestedModel,
      fellBack: fellBackToAuto,
      attemptedProviders: [...attemptedProviders],
      approvals,
      usedTools,
      trace,
      files: turnFiles ?? [],
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
      streamed: true,
    };
  };

  const friendlyTurnEnd = (error: unknown) => {
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
      streamed: true,
      error: errorMessage,
    };
  };

  /** One model round: streaming first, honest fallbacks on failure. */
  const invokeRound = async (round: number): Promise<RoundAnswer> => {
    if (canStream) {
      let emittedText = "";
      try {
        const streamed = await invokeAiStream(
          {
            model: requestedModel,
            messages,
            tools,
            toolChoice: tools ? "auto" : undefined,
            maxTokens: effectiveBudget,
            ...(reasoning ? { reasoning } : {}),
          },
          {
            signal,
            onToken: (delta) => {
              emittedText += delta;
              emit({ type: "token", delta });
            },
            // OpenCode runs its own tools server-side (already executed):
            // surface them as progress only, never into Rook's tool loop.
            onToolActivity: (tool) => {
              const step = {
                kind: "tool" as const,
                title: `OpenCode ran ${tool}`,
              };
              trace.push(step);
              emit({ type: "trace", step });
            },
          },
        );
        if (streamed.model) {
          resolvedModel = streamed.model;
          if (
            requestedModel !== resolvedModel &&
            (resolvedModel === "openrouter/free" || requestedModel === "openrouter/free")
          ) {
            fellBackToAuto = true;
          }
        }
        return {
          content: streamed.text,
          toolCalls: streamed.toolCalls,
          model: streamed.model || resolvedModel,
          finishReason: streamed.finishReason,
          files: streamed.files,
        };
      } catch (error) {
        if (isStreamUnsupportedError(error)) {
          canStream = false;
        } else if (emittedText.length > 0) {
          // Tokens already went to the client: ending here with the partial
          // text is the only honest option (a regeneration could double up
          // approvals already recorded this turn).
          throw new PartialStreamError(emittedText);
        } else if (isTransientAgentError(error)) {
          // Nothing emitted yet: drop to the resilient non-streaming path
          // for the rest of this turn rather than failing the chat.
          canStream = false;
        } else {
          throw error;
        }
      }
    }

    try {
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
      attemptedProviders = invoked.attemptedProviders;
      fellBackToAuto = fellBackToAuto || invoked.fellBack;
      const answer = invoked.result.choices[0]?.message;
      if (!answer) throw new Error("The model did not return a response");
      resolvedModel = invoked.result.model || resolvedModel;
      const text =
        typeof answer.content === "string"
          ? answer.content
          : Array.isArray(answer.content)
            ? answer.content
                .map((part) =>
                  typeof part === "string" ? part : ((part as { text?: string }).text ?? ""),
                )
                .join("\n")
            : "";
      if (text) {
        // Non-streamed rounds in a streaming turn still surface text live.
        emit({ type: "token", delta: text });
      }      return {
        content: text,
        toolCalls: answer.tool_calls ?? [],
        model: resolvedModel,
        finishReason: invoked.result.choices[0]?.finish_reason ?? null,
      };
    } catch (error) {
      if (isMaxTokensError(error) && !budgetHalved) {
        budgetHalved = true;
        effectiveBudget = Math.max(800, Math.floor(effectiveBudget / 2));
        await backoffSleep(0, parseRetryAfterMs(null));
        return invokeRoundBare();
      }
      if (isTransientAgentError(error) && round === 0 && !attemptedProviders.length) {
        await backoffSleep(0, parseRetryAfterMs(null));
        return invokeRoundBare();
      }
      throw error;
    }
  };

  /** Plain resilient round without further fallback games (single retry). */
  const invokeRoundBare = async (): Promise<RoundAnswer> => {
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
    attemptedProviders = invoked.attemptedProviders;
    fellBackToAuto = fellBackToAuto || invoked.fellBack;
    const answer = invoked.result.choices[0]?.message;
    if (!answer) throw new Error("The model did not return a response");
    resolvedModel = invoked.result.model || resolvedModel;
    const text = typeof answer.content === "string" ? answer.content : "";
    if (text) emit({ type: "token", delta: text });
    return {
      content: text,
      toolCalls: answer.tool_calls ?? [],
      model: resolvedModel,
      finishReason: invoked.result.choices[0]?.finish_reason ?? null,
    };
  };

  for (let round = 0; round < ROOK_AGENT_MAX_ROUNDS; round += 1) {
    let answer: RoundAnswer;
    try {
      answer = await invokeRound(round);
      if (answer.files?.length) turnFiles = answer.files;
    } catch (error) {
      if (error instanceof PartialStreamError) {
        const { text } = finishText(
          error.partialText ||
            "I started answering but the stream cut out before I could finish.",
          null,
        );
        return endTurn(
          `${text}\n\n(The live reply cut out — ask me to continue and I'll pick up where I left off.)`,
        );
      }
      console.warn("[RookAI] streamed turn failed", {
        requestId,
        round,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      return friendlyTurnEnd(error);
    }

    const calls = answer.toolCalls;
    if (!calls.length) {
      // Length-truncated answers keep streaming server-side (the partial
      // text already went out live) instead of stopping with homework.
      if (
        answer.finishReason === "length" &&
        continuationsUsed < MAX_OUTPUT_CONTINUATIONS &&
        answer.content.trim()
      ) {
        continuationsUsed += 1;
        continuedText += (continuedText ? "\n" : "") + answer.content.trim();
        messages.push({ role: "assistant", content: answer.content });
        continue;
      }
      const { text } = finishText(answer.content, answer.finishReason);
      return endTurn(text);
    }

    messages.push({
      role: "assistant",
      content: answer.content,
      tool_calls: calls,
    });

    for (const call of calls) {
      const name = call.function.name;
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

      let rendered: string;
      try {
        const proposalsBefore = computerProposals.length;
        const approvalsBefore = approvals.length;
        const executed = await executeAgentTool({
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
        });
        trace.push(executed.traceStep);
        emit({ type: "trace", step: executed.traceStep });
        for (const approval of approvals.slice(approvalsBefore)) {
          emit({ type: "approval", approval });
        }
        for (const proposal of computerProposals.slice(proposalsBefore)) {
          emit({ type: "proposal", proposal });
        }
        rendered = toolResultText(executed.resultPayload);
      } catch (error) {
        const step = {
          kind: "tool",
          title: "A connected-tool step could not be completed",
        } as const;
        trace.push(step);
        emit({ type: "trace", step });
        rendered = toolResultText({
          status: "error",
          message: error instanceof Error ? error.message : "Connected tool failed",
        });
      }
      toolPayloadChars += rendered.length;
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

  console.warn("[RookAI] streamed turn hit tool-round limit", {
    requestId,
    model: resolvedModel,
    usedTools,
    latencyMs: Date.now() - startedAt,
  });
  return endTurn(
    approvals.length
      ? "I've prepared it for your approval - confirm it right here in this chat."
      : computerProposals.length
        ? "I proposed a computer task below - approve it right here in this chat, then run it from the Computer panel."
        : "I reached the tool limit for this turn. Try asking for a smaller range or one operation at a time.",
  );
}

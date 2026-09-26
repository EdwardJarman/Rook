/**
 * Token-streaming transport for OpenAI-compatible providers (v2 loop-mode).
 *
 * `invokeAi*` is request/response: the user stares at a spinner until the
 * whole turn finishes. This module adds the streaming half — Server-Sent
 * Events parsed into token deltas + accumulated tool calls — used by the
 * streaming agent turn and the `/api/agent/stream` endpoint.
 *
 * Providers route exactly like `invokeAi`:
 * - openrouter:* / concrete free models -> OpenRouter `stream: true`
 * - orcarouter:* / tokenrouter:* -> their OpenAI-compat `/chat/completions`
 * - opencode:* -> local `opencode serve` turn (one-shot; the whole answer is
 *   emitted as a single token event so the UI still streams it live)
 * - chatgpt:* -> NOT supported (its proxy path is one-shot); the agent
 *   falls back to a non-streaming round for those models.
 *
 * Robustness notes:
 * - If a provider ignores `stream: true` and returns a single JSON body,
 *   it is accepted (whole text emitted as one token event).
 * - An `{"error": ...}` event mid-stream throws with the upstream message
 *   and status code embedded, so `isTransientAgentError` keeps working.
 */

import type { InvokeParams, ToolCall } from "../_core/llm";
import { normalizeMessages, normalizeToolChoice, responseFormatFor } from "./openai-compat";
import { isChatGPTModel } from "./chatgpt";
import { collectOpenCodeFiles, invokeOpenCode, isOpenCodeModel } from "./opencode";
import {
  gatewayStreamTarget,
  isOrcaRouterModel,
  isTokenRouterModel,
} from "./router-gateways";
import { OPENROUTER_API_BASE, openRouterHeaders, resolveOpenRouterModel } from "./openrouter";
import { isReasoningRejectedError } from "./agent-reliability";

export const STREAM_NOT_SUPPORTED_MESSAGE =
  "Streaming is not supported for this model route.";

export const supportsModelStream = (model: string | undefined): boolean =>
  !isChatGPTModel(model);

export type StreamedRound = {
  text: string;
  toolCalls: ToolCall[];
  model: string;
  finishReason: string | null;
  /** Agent-built files to offer in the browser (OpenCode turns only). */
  files?: Array<{ name: string; mimeType: string; content: string }>;
};

type DeltaChoice = {
  delta?: {
    role?: string;
    content?: string | null;
    tool_calls?: Array<{
      index?: number;
      id?: string;
      type?: string;
      function?: { name?: string; arguments?: string };
    }>;
  };
  finish_reason?: string | null;
};

type StreamChunk = {
  id?: string;
  model?: string;
  error?: { message?: string; code?: string | number };
  choices?: DeltaChoice[];
};

const readErrorText = async (response: Response): Promise<string> => {
  try {
    const text = await response.text();
    return text.slice(0, 2000);
  } catch {
    return "";
  }
};

/** Idle watchdog: a stream getting slower is fine, a silent one is dead. */
export const STREAM_IDLE_TIMEOUT_MS = 45_000;
const STREAM_OVERALL_FLOOR_MS = 120_000;
const STREAM_OVERALL_CAP_MS = 600_000;
/** Milliseconds of overall budget per requested output token (~7 tok/s floor). */
const STREAM_MS_PER_TOKEN = 150;

/**
 * Overall stream budget derived from the requested output size, so a
 * 6000-token answer on a slow free model is allowed minutes while a
 * hung connection still dies fast via the idle watchdog.
 */
export function streamTimeoutsFor(maxTokens: number | undefined): {
  overallMs: number;
  idleMs: number;
} {
  const tokens = Number.isFinite(maxTokens) && (maxTokens as number) > 0 ? (maxTokens as number) : 1200;
  return {
    overallMs: Math.min(
      STREAM_OVERALL_CAP_MS,
      Math.max(STREAM_OVERALL_FLOOR_MS, Math.floor(tokens * STREAM_MS_PER_TOKEN)),
    ),
    idleMs: STREAM_IDLE_TIMEOUT_MS,
  };
}

/** Collects one streaming chat completion, forwarding text deltas live. */
export async function streamChatCompletion(input: {
  url: string;
  headers: Record<string, string>;
  payload: Record<string, unknown>;
  timeoutMs?: number;
  idleTimeoutMs?: number;
  signal?: AbortSignal;
  onToken?: (delta: string) => void;
}): Promise<StreamedRound> {
  const scaled = streamTimeoutsFor(input.payload.max_tokens as number | undefined);
  const timeoutMs = input.timeoutMs ?? scaled.overallMs;
  const idleMs = input.idleTimeoutMs ?? scaled.idleMs;
  const signals: AbortSignal[] = [AbortSignal.timeout(timeoutMs)];
  const idleController = new AbortController();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleController.abort(new Error("stalled"));
    }, idleMs);
    // Don't hold the process open for the watchdog alone.
    (idleTimer as unknown as { unref?: () => void }).unref?.();
  };
  resetIdle();
  signals.push(idleController.signal);
  if (input.signal) signals.push(input.signal);
  // NOTE: if this function returns early (HTTP error / single-JSON body),
  // the unref'd idle timer may still fire later — aborting a finished
  // controller is a safe no-op.
  const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];

  const response = await fetch(input.url, {
    method: "POST",
    headers: { ...input.headers, Accept: "text/event-stream" },
    body: JSON.stringify({ ...input.payload, stream: true }),
    signal,
  }).catch((error: unknown) => {
    if (idleController.signal.aborted) {
      throw new Error("The AI stream stalled (no data for a while). Please try again.");
    }
    if (error instanceof Error && /aborted|timeout/i.test(error.name + error.message)) {
      throw new Error("The AI stream timed out before finishing. Please try again.");
    }
    throw error instanceof Error ? error : new Error("The AI stream request failed.");
  });

  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok || !response.body || contentType.includes("application/json")) {
    // Either an HTTP error, an empty body, or a provider that ignored
    // `stream: true` and answered with one JSON document: handle uniformly.
    const bodyText = await readErrorText(response);
    if (!response.ok) {
      let detail = "";
      try {
        const parsed = JSON.parse(bodyText) as { error?: { message?: string } };
        detail = parsed.error?.message?.trim() ?? "";
      } catch {
        detail = "";
      }
      const failure = new Error(
        `AI stream failed with status ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ". Please try again."}`,
      );
      // A model rejecting the reasoning params fails the whole stream
      // before any token. Retry once without them — same policy as the
      // non-streaming transports.
      if (
        (input.payload.reasoning !== undefined || input.payload.thinking !== undefined) &&
        isReasoningRejectedError(failure)
      ) {
        const stripped = { ...input.payload };
        delete stripped.reasoning;
        delete stripped.thinking;
        return streamChatCompletion({ ...input, payload: stripped });
      }
      throw failure;
    }
    if (bodyText) {
      try {
        const parsed = JSON.parse(bodyText) as {
          model?: string;
          choices?: Array<{
            message?: { content?: unknown; tool_calls?: ToolCall[] };
            finish_reason?: string | null;
          }>;
        };
        const message = parsed.choices?.[0]?.message;
        const text =
          typeof message?.content === "string" ? message.content : "";
        if (text) input.onToken?.(text);
        return {
          text,
          toolCalls: message?.tool_calls ?? [],
          model: parsed.model ?? "",
          finishReason: parsed.choices?.[0]?.finish_reason ?? "stop",
        };
      } catch {
        // Fall through to the empty-stream error below.
      }
    }
    throw new Error("The AI stream ended without any content. Please try again.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let model = "";
  let finishReason: string | null = null;
  const toolAcc = new Map<number, { id: string; name: string; args: string }>();

  const processEvent = (raw: string): void => {
    const dataLines = raw
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trim());
    if (!dataLines.length) return;
    const data = dataLines.join("\n").trim();
    if (!data || data === "[DONE]") return;
    let chunk: StreamChunk;
    try {
      chunk = JSON.parse(data) as StreamChunk;
    } catch {
      return;
    }
    if (chunk.error?.message) {
      throw new Error(chunk.error.message.slice(0, 300));
    }
    if (chunk.model && !model) model = chunk.model;
    for (const choice of chunk.choices ?? []) {
      if (choice.finish_reason) finishReason = choice.finish_reason;
      const delta = choice.delta;
      if (!delta) continue;
      if (typeof delta.content === "string" && delta.content) {
        text += delta.content;
        input.onToken?.(delta.content);
      }
      for (const call of delta.tool_calls ?? []) {
        const index = call.index ?? 0;
        const entry = toolAcc.get(index) ?? { id: "", name: "", args: "" };
        if (call.id) entry.id = call.id;
        if (call.function?.name) entry.name = call.function.name;
        if (typeof call.function?.arguments === "string") entry.args += call.function.arguments;
        toolAcc.set(index, entry);
      }
    }
  };

  try {
    for (;;) {
      let read: ReadableStreamReadResult<Uint8Array>;
      try {
        read = await reader.read();
      } catch (error) {
        if (idleController.signal.aborted) {
          throw new Error("The AI stream stalled (no data for a while). Please try again.");
        }
        // Caller hung up (client disconnect) — propagate, don't relabel.
        if (input.signal?.aborted) throw error;
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error("The AI stream timed out before finishing. Please try again.");
        }
        throw error;
      }
      if (read.done) break;
      // Any bytes at all prove the connection is alive — slow models are
      // fine, silent ones are dead.
      resetIdle();
      buffer += decoder.decode(read.value, { stream: true });
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() ?? "";
      for (const part of parts) processEvent(part);
    }
    buffer += decoder.decode();
    if (buffer.trim()) processEvent(buffer);
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    try {
      reader.releaseLock();
    } catch {
      // Already closed; nothing to do.
    }
  }

  return {
    text,
    toolCalls: [...toolAcc.entries()]
      .sort(([a], [b]) => a - b)
      .filter(([, entry]) => entry.id && entry.name)
      .map(([, entry]) => ({
        id: entry.id,
        type: "function",
        function: { name: entry.name, arguments: entry.args || "{}" },
      })),
    model,
    finishReason,
  };
}

/** Streaming twin of `invokeAi`. Throws STREAM-flagged errors for ChatGPT. */
export async function invokeAiStream(
  params: InvokeParams,
  input?: {
    signal?: AbortSignal;
    onToken?: (delta: string) => void;
    onToolActivity?: (tool: string) => void;
    request?: unknown;
  },
): Promise<StreamedRound> {
  void input?.request;
  if (isChatGPTModel(params.model)) {
    const error = new Error(STREAM_NOT_SUPPORTED_MESSAGE);
    (error as Error & { streamUnsupported?: boolean }).streamUnsupported = true;
    throw error;
  }

  const messages = normalizeMessages(params.messages);
  const max_tokens = params.max_tokens ?? params.maxTokens ?? 1200;
  const toolChoice = normalizeToolChoice(params.toolChoice ?? params.tool_choice, params.tools);
  const responseFormat = responseFormatFor(params);
  const reasoning = params.reasoning;
  const thinking = params.thinking;

  if (params.model && isOpenCodeModel(params.model)) {
    // Live tail: text deltas stream to the client while the OpenCode turn
    // runs (no more "thinking finished, text appears seconds later"). If
    // the event stream was unavailable, nothing was forwarded yet, so the
    // whole answer goes out as one token event instead — never both.
    let forwarded = false;
    const invoked = await invokeOpenCode(params, {
      onToken: (delta) => {
        forwarded = true;
        input?.onToken?.(delta);
      },
      onToolActivity: input?.onToolActivity,
      signal: input?.signal ?? null,
    });
    const answer = invoked.choices[0]?.message;
    const text =
      typeof answer?.content === "string"
        ? answer.content
        : Array.isArray(answer?.content)
          ? answer.content
              .map((part) => (typeof part === "string" ? part : part.type === "text" ? part.text : ""))
              .join("\n")
          : "";
    if (text && !forwarded) input?.onToken?.(text);
    // Pull freshly built files into the turn so the chat can offer them
    // as real in-browser files instead of server-local paths. Best-effort:
    // a failed read leaves the text answer (with its paths) untouched.
    const files = await collectOpenCodeFiles(text).catch(() => []);
    return {
      text,
      toolCalls: answer?.tool_calls ?? [],
      model: invoked.model || params.model,
      finishReason: invoked.choices[0]?.finish_reason ?? null,
      files,
    };
  }

  if (params.model && (isOrcaRouterModel(params.model) || isTokenRouterModel(params.model))) {
    const target = gatewayStreamTarget(params.model);
    if (!target) throw new Error("That model is not available in Rook.");
    return streamChatCompletion({
      url: target.url,
      headers: { Authorization: `Bearer ${target.apiKey}`, "Content-Type": "application/json" },
      payload: {
        model: target.upstream,
        messages,
        max_tokens,
        ...(params.tools?.length ? { tools: params.tools } : {}),
        ...(toolChoice ? { tool_choice: toolChoice } : {}),
        ...(responseFormat ? { response_format: responseFormat } : {}),
        ...(reasoning ? { reasoning } : {}),
        ...(thinking ? { thinking } : {}),
      },
      signal: input?.signal,
      onToken: input?.onToken,
    });
  }

  if (params.model && !params.model.startsWith("orcarouter:") && !params.model.startsWith("tokenrouter:") && !params.model.startsWith("chatgpt:") && !params.model.startsWith("opencode:")) {
    const needsTools = Boolean(params.tools?.length);
    const { resolved } = await resolveOpenRouterModel(params.model, needsTools);
    return streamChatCompletion({
      url: `${OPENROUTER_API_BASE}/chat/completions`,
      headers: openRouterHeaders(true) as Record<string, string>,
      payload: {
        models: [resolved],
        messages,
        max_tokens,
        ...(params.tools?.length ? { tools: params.tools } : {}),
        ...(toolChoice ? { tool_choice: toolChoice } : {}),
        ...(responseFormat ? { response_format: responseFormat } : {}),
        ...(reasoning ? { reasoning } : {}),
        ...(thinking ? { thinking } : {}),
      },
      signal: input?.signal,
      onToken: input?.onToken,
    });
  }

  throw new Error("That model is not available in Rook.");
}

export const isStreamUnsupportedError = (error: unknown): boolean =>
  error instanceof Error &&
  (error as Error & { streamUnsupported?: boolean }).streamUnsupported === true;

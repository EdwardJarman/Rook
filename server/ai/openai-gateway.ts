/**
 * OpenAI-compat gateway mapping (pure — no network, no express).
 *
 * Translates between the OpenAI `/v1` wire shapes (what grok custom models,
 * opencode, and every OpenAI client speaks) and Rook's `InvokeParams` /
 * `InvokeResult` dispatch. The Express handlers in
 * `server/openai-gateway-routes.ts` own auth, transport, and SSE framing;
 * everything contractual about shapes lives here, unit-tested.
 *
 * Honesty rules (pinned by tests):
 * - Unknown/extra fields (temperature, top_p, …) are accepted and ignored —
 *   never 400 on them. Sampling belongs to provider routing.
 * - `developer` role maps to `system`. Anything else outside the six known
 *   roles is a 400.
 * - `chatgpt:` models are blocked with an honest 400 (they need a connected
 *   ChatGPT session, unavailable over the gateway).
 * - Usage is passed through when providers report it, omitted otherwise —
 *   never estimated or fabricated.
 */

import { z } from "zod";

import type { InvokeParams, InvokeResult, Message, Tool, ToolCall } from "../_core/llm";
import { classifyRetryDecision } from "./agent-reliability";

/** Mount point. Clients set `base_url` to `<rook>/api/openai/v1`. */
export const GATEWAY_BASE_PATH = "/api/openai/v1";

/** Kill-switch. Default on; `ROOK_OPENAI_GATEWAY=0` disables the routes. */
export function isGatewayEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.ROOK_OPENAI_GATEWAY ?? "1").trim() !== "0";
}

/** Model prefixes the gateway refuses (need interactive sessions). */
export const GATEWAY_BLOCKED_PREFIXES = ["chatgpt:"] as const;

export function isGatewayModel(modelId: string): boolean {
  return !GATEWAY_BLOCKED_PREFIXES.some((prefix) => modelId.trim().toLowerCase().startsWith(prefix));
}

export function filterGatewayModels<T extends { id: string }>(models: T[]): T[] {
  return models.filter((model) => isGatewayModel(model.id));
}

// ---------------------------------------------------------------------------
// Request in: OpenAI chat body -> InvokeParams
// ---------------------------------------------------------------------------

const contentPartSchema = z.union([
  z.string(),
  z.object({ type: z.literal("text"), text: z.string() }).passthrough(),
  z
    .object({ type: z.literal("image_url"), image_url: z.object({ url: z.string() }).passthrough() })
    .passthrough(),
  z
    .object({ type: z.literal("file_url"), file_url: z.record(z.string(), z.unknown()) })
    .passthrough(),
]);

const toolCallSchema = z.object({
  id: z.string().min(1),
  type: z.literal("function").optional(),
  function: z.object({
    name: z.string().min(1),
    arguments: z.unknown(),
  }),
});

const messageSchema = z.object({
  role: z.enum(["system", "developer", "user", "assistant", "tool", "function"]),
  content: z.union([z.string(), z.array(contentPartSchema)]).nullish(),
  name: z.string().max(128).optional(),
  tool_call_id: z.string().max(128).optional(),
  tool_calls: z.array(toolCallSchema).max(32).optional(),
});

const toolSchema = z.object({
  type: z.literal("function"),
  function: z
    .object({
      name: z.string().min(1).max(128),
      description: z.string().max(4000).optional(),
      parameters: z.record(z.string(), z.unknown()).optional(),
    })
    .passthrough(),
});

const toolChoiceSchema = z.union([
  z.enum(["none", "auto", "required"]),
  z.object({ name: z.string().min(1) }),
  z.object({ type: z.literal("function"), function: z.object({ name: z.string().min(1) }) }),
]);

const chatBodySchema = z
  .object({
    model: z.string().min(1).max(180),
    messages: z.array(messageSchema).min(1).max(500),
    tools: z.array(toolSchema).max(64).optional(),
    tool_choice: z.unknown().optional(),
    max_tokens: z.number().int().positive().max(200_000).optional(),
    response_format: z.unknown().optional(),
  })
  .passthrough();

export type GatewayRequestError = { message: string; status: number };

const bad = (message: string, status = 400): GatewayRequestError => ({ message, status });

function normalizeToolChoice(choice: unknown): InvokeParams["tool_choice"] {
  if (choice === undefined) return undefined;
  const parsed = toolChoiceSchema.safeParse(choice);
  if (!parsed.success) throw bad("tool_choice must be none, auto, required, or a function reference.");
  const value = parsed.data;
  if (typeof value === "string") return value;
  // safeParse already pinned one of the object variants; discriminate by shape.
  const record = value as Record<string, unknown>;
  if (record.type === "function") {
    const fn = record.function as { name?: unknown } | undefined;
    if (fn && typeof fn.name === "string" && fn.name) {
      return { type: "function", function: { name: fn.name } };
    }
  } else if (typeof record.name === "string" && record.name) {
    return { name: record.name };
  }
  throw bad("tool_choice must be none, auto, required, or a function reference.");
}

function normalizeToolCalls(calls: z.infer<typeof toolCallSchema>[]): ToolCall[] {
  return calls.map((call) => ({
    id: call.id,
    type: "function" as const,
    function: {
      name: call.function.name,
      arguments:
        typeof call.function.arguments === "string"
          ? call.function.arguments
          : JSON.stringify(call.function.arguments ?? {}),
    },
  }));
}

/**
 * Parse an OpenAI chat body into dispatch params. Returns `{ params }` or
 * `{ error }` — the route maps errors to the OpenAI error envelope.
 */
export function toInvokeParams(
  body: unknown,
): { params?: InvokeParams; error?: GatewayRequestError } {
  const parsed = chatBodySchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first && first.path.length ? ` (${first.path.join(".")})` : "";
    return { error: bad(`That chat request was malformed${where}.`) };
  }
  const input = parsed.data;
  if (!isGatewayModel(input.model)) {
    return {
      error: bad(
        "That model needs a signed-in ChatGPT session and is not available over the gateway. Pick a catalog model from GET /v1/models.",
      ),
    };
  }
  let toolChoice: InvokeParams["tool_choice"];
  try {
    toolChoice = normalizeToolChoice(input.tool_choice);
  } catch (error) {
    return { error: error as GatewayRequestError };
  }
  const messages: Message[] = input.messages.map((message) => ({
    role: message.role === "developer" ? "system" : message.role,
    content: (message.content ?? "") as Message["content"],
    ...(message.name ? { name: message.name } : {}),
    ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
    ...(message.tool_calls?.length ? { tool_calls: normalizeToolCalls(message.tool_calls) } : {}),
  }));
  const params: InvokeParams = {
    model: input.model,
    messages,
    ...(input.tools?.length ? { tools: input.tools as Tool[] } : {}),
    ...(toolChoice !== undefined ? { tool_choice: toolChoice } : {}),
    ...(input.max_tokens !== undefined ? { max_tokens: input.max_tokens } : {}),
    ...(input.response_format !== undefined
      ? { response_format: input.response_format as InvokeParams["response_format"] }
      : {}),
  };
  return { params };
}

// ---------------------------------------------------------------------------
// Response out: InvokeResult -> OpenAI shapes
// ---------------------------------------------------------------------------

const mapFinishReason = (reason: string | null): string | null => {
  if (reason === "stop" || reason === "length" || reason === "tool_calls" || reason === "content_filter") {
    return reason;
  }
  return null;
};

function assistantContent(result: InvokeResult): { content: unknown; tool_calls?: ToolCall[] } {
  const message = result.choices[0]?.message;
  const content = message?.content ?? "";
  if (typeof content === "string") {
    return { content, ...(message?.tool_calls?.length ? { tool_calls: message.tool_calls } : {}) };
  }
  const parts = content.map((part) => {
    if (part.type === "text" || part.type === "image_url") return part;
    return { type: "text", text: "[unsupported content part]" };
  });
  return { content: parts, ...(message?.tool_calls?.length ? { tool_calls: message.tool_calls } : {}) };
}

/** Build an OpenAI chat.completion object from a dispatch result. */
export function toChatCompletion(result: InvokeResult, requestedModel: string): Record<string, unknown> {
  const created = result.created || Math.floor(Date.now() / 1000);
  const first = result.choices[0];
  const { content, tool_calls } = assistantContent(result);
  return {
    id: result.id || `chatcmpl-rook-${created}`,
    object: "chat.completion",
    created,
    model: requestedModel,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content,
          ...(tool_calls ? { tool_calls } : {}),
        },
        finish_reason: mapFinishReason(first?.finish_reason ?? null),
      },
    ],
    ...(result.usage ? { usage: result.usage } : {}),
  };
}

/**
 * Build SSE `data:` payloads for `stream: true`. One content/tool delta
 * chunk, one terminal chunk carrying the finish reason, then the route
 * appends `data: [DONE]`. (One-shot today — same honesty pattern as the
 * OpenCode streaming branch; true token streaming is a follow-up.)
 */
export function toSseChunks(result: InvokeResult, requestedModel: string): string[] {
  const created = result.created || Math.floor(Date.now() / 1000);
  const id = result.id || `chatcmpl-rook-${created}`;
  const first = result.choices[0];
  const { content, tool_calls } = assistantContent(result);
  const head: Record<string, unknown> = {
    id,
    object: "chat.completion.chunk",
    created,
    model: requestedModel,
    choices: [
      {
        index: 0,
        delta: {
          role: "assistant",
          ...(typeof content === "string"
            ? { content }
            : { content: JSON.stringify(content) }),
          ...(tool_calls ? { tool_calls: tool_calls.map((call, index) => ({ ...call, index })) } : {}),
        },
        finish_reason: null,
      },
    ],
  };
  const tail: Record<string, unknown> = {
    id,
    object: "chat.completion.chunk",
    created,
    model: requestedModel,
    choices: [{ index: 0, delta: {}, finish_reason: mapFinishReason(first?.finish_reason ?? null) }],
  };
  return [`data: ${JSON.stringify(head)}`, `data: ${JSON.stringify(tail)}`];
}

// ---------------------------------------------------------------------------
// Models out
// ---------------------------------------------------------------------------

export function toModelList(models: Array<{ id: string }>): {
  object: "list";
  data: Array<{ id: string; object: "model"; created: number; owned_by: string }>;
} {
  return {
    object: "list",
    data: models.map((model) => ({
      id: model.id,
      object: "model" as const,
      created: 0,
      owned_by: ownerOf(model.id),
    })),
  };
}

/** Owner from either id style (`orcarouter:x`, `openrouter/free`); `rook` when bare. */
function ownerOf(id: string): string {
  const colon = id.indexOf(":");
  if (colon > 0) return id.slice(0, colon);
  const slash = id.indexOf("/");
  if (slash > 0) return id.slice(0, slash);
  return "rook";
}

// ---------------------------------------------------------------------------
// Errors out: OpenAI envelope + status
// ---------------------------------------------------------------------------

export type GatewayErrorBody = {
  error: { message: string; type: string; code: string | null };
};

/** Map a dispatch failure to an OpenAI-style error. Pure. */
export function toGatewayError(error: unknown): { status: number; body: GatewayErrorBody } {
  const message = error instanceof Error ? error.message : String(error ?? "Unknown error");
  if (/not available in Rook|unknown model|no such model/i.test(message)) {
    return {
      status: 404,
      body: { error: { message, type: "invalid_request_error", code: "model_not_found" } },
    };
  }
  const kind = classifyRetryDecision(error);
  if (kind === "emit") {
    return {
      status: 500,
      body: { error: { message, type: "server_error", code: null } },
    };
  }
  if (kind === "rate-limit") {
    return {
      status: 429,
      body: { error: { message, type: "rate_limit_exceeded", code: "rate_limit_exceeded" } },
    };
  }
  return {
    status: 500,
    body: { error: { message, type: "server_error", code: null } },
  };
}

/** Shape a request-validation failure ({ message, status }) into the envelope. */
export function gatewayRequestError(
  status: number,
  message: string,
  type = "invalid_request_error",
  code: string | null = null,
): { status: number; body: GatewayErrorBody } {
  return {
    status,
    body: { error: { message, type, code } },
  };
}

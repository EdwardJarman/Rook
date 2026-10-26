/**
 * OpenCode failures as typed `ProviderError`s (the same taxonomy the ChatGPT
 * path uses). Every shape below was captured from a real `opencode serve`
 * (v1.18.34); see docs/opencode-rook-integration.md "Failure handling".
 *
 * Layers name where the failure was observed:
 * - opencode-config    no base URL / management disabled
 * - opencode-server    server unreachable, health, request timeout
 * - opencode-catalog   the model is not served by this server
 * - opencode-session   POST /api/session
 * - opencode-prompt    POST /api/session/{id}/prompt
 * - opencode-poll      history / message / permission / active reads
 * - opencode-turn      the turn itself: stalled, empty, over budget, permission
 * - opencode-upstream  the model gateway behind OpenCode failed a step
 */
import {
  aiDebug,
  classifyProviderFailure,
  ProviderError,
  redactAndTruncate,
  type ProviderFailureKind,
} from "./provider-error";

export type OpenCodeLayer =
  | "opencode-config"
  | "opencode-server"
  | "opencode-catalog"
  | "opencode-session"
  | "opencode-prompt"
  | "opencode-poll"
  | "opencode-turn"
  | "opencode-upstream";

export type OpenCodeErrorInput = {
  layer: OpenCodeLayer;
  model?: string;
  kind: ProviderFailureKind;
  message: string;
  status?: number;
  code?: string;
  /** Raw provider/server body: only ever logged, redacted, under ROOK_AI_DEBUG. */
  raw?: string;
};

export function openCodeError(input: OpenCodeErrorInput, cause?: unknown): ProviderError {
  const error = new ProviderError(
    {
      layer: input.layer,
      provider: "opencode",
      model: input.model,
      kind: input.kind,
      status: input.status,
      code: input.code,
      providerMessage: redactAndTruncate(input.message),
    },
    cause === undefined ? undefined : { cause },
  );
  aiDebug("opencode failure", {
    layer: input.layer,
    model: input.model,
    kind: input.kind,
    status: input.status,
    code: input.code,
    rawBody: input.raw ? redactAndTruncate(input.raw, 1000) : undefined,
  });
  return error;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value : undefined;
const tryJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/**
 * OpenCode server error bodies: `{ _tag: "UnauthorizedError", message }`,
 * `{ name, data: { message } }`, or plain text.
 */
export function parseOpenCodeBody(raw: string): { code?: string; message: string } {
  const body = asRecord(tryJson(raw));
  if (!body) return { message: raw };
  const data = asRecord(body.data);
  const nested = asRecord(body.error);
  return {
    code: asString(body._tag) ?? asString(body.name) ?? asString(nested?.type),
    message: asString(body.message) ?? asString(data?.message) ?? asString(nested?.message) ?? asString(body.error) ?? raw,
  };
}

/**
 * A failed assistant step, as `session.next.step.failed` /
 * `GET …/message/{id}` report it: `{ type: "unknown", message }` where the
 * message is typically
 * `Provider request failed with HTTP 400: {"error":{"type":"server_error","message":"…"}}`.
 */
export function stepFailure(error: { type?: unknown; message?: unknown } | undefined, model: string): ProviderError {
  const text = asString(error?.message) ?? "";
  const http = /HTTP (\d{3})\b/.exec(text);
  const status = http ? Number(http[1]) : undefined;
  const embedded = http ? text.slice(text.indexOf(":", http.index) + 1).trim() : text;
  const parsed = parseOpenCodeBody(embedded);
  const message = parsed.message || text || "OpenCode reported a failed step with no detail.";
  let kind = classifyProviderFailure({ status, code: parsed.code, message: `${message} ${text}` });
  let code = parsed.code;
  // Seen live for Big Pickle: the gateway sent a malformed chunk mid-stream. A fresh turn normally works.
  if (kind === "unknown" && /invalid .{0,60}stream event|stream (?:error|closed|interrupted|ended)|unexpected end of/i.test(message)) {
    kind = "transient";
    code ??= "invalid_stream_event";
  }
  return openCodeError({ layer: "opencode-upstream", model, kind, status, code, message, raw: text });
}

export type ServedModel = { id: string; status?: string; enabled?: boolean };

/** Why a catalog id is unusable on this server, or undefined when it is served. */
export function unservedReason(model: ServedModel | undefined, upstreamId: string): string | undefined {
  if (!model)
    return `This OpenCode server doesn't serve ${upstreamId} — Rook's catalog is ahead of the server (upgrade or reconfigure opencode serve).`;
  if (model.enabled === false) return `${upstreamId} is disabled on this OpenCode server.`;
  return undefined;
}

/** How long a "gateway says this model's endpoint is down" label is believed: short, because outages clear. */
export const GATEWAY_DOWN_TTL_MS = 5 * 60_000;

/** The model gateway behind OpenCode explicitly reports this model's endpoint as down (observed for Ling 3 Flash). */
export const isGatewayEndpointDown = (error: unknown): error is ProviderError =>
  error instanceof ProviderError &&
  error.info.layer === "opencode-upstream" &&
  /endpoint is unavailable/i.test(error.info.providerMessage);

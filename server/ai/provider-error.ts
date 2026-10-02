/**
 * Typed provider failures. Every layer that talks to a model provider turns
 * what it saw (HTTP status, provider code, provider message) into a
 * `ProviderError`, so classification, fallback, the user-facing line and the
 * logs all work from the same facts instead of regexing a vague message.
 *
 * Dependency-free on purpose: imported by the reliability helpers.
 */

export type ProviderFailureKind =
  | "model-unavailable"
  | "auth"
  | "rate-limit"
  | "transient"
  | "bad-request"
  | "empty"
  | "unknown";

export type ProviderErrorInfo = {
  /** Which layer observed the failure, e.g. "chatgpt-responses". */
  layer: string;
  provider: string;
  model?: string;
  kind: ProviderFailureKind;
  status?: number;
  code?: string;
  /** Redacted, truncated provider text. */
  providerMessage: string;
};

export type FallbackFailure = { provider: string; model?: string; kind: ProviderFailureKind; message: string };

export class ProviderError extends Error {
  readonly info: ProviderErrorInfo;
  /** Set when a fallback was tried after this error and failed too. */
  fallbackFailure?: FallbackFailure;

  constructor(info: ProviderErrorInfo, options?: { cause?: unknown }) {
    super(
      `${info.provider} ${info.kind}${info.status ? ` (${info.status})` : ""}${info.code ? ` [${info.code}]` : ""}: ${info.providerMessage}`,
      options,
    );
    this.name = "ProviderError";
    this.info = info;
  }

  get kind(): ProviderFailureKind {
    return this.info.kind;
  }
}

export const isProviderError = (error: unknown): error is ProviderError => error instanceof ProviderError;

export const PROVIDER_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT",
  openrouter: "OpenRouter",
  orcarouter: "OrcaRouter",
  tokenrouter: "TokenRouter",
  opencode: "OpenCode",
};

export const providerLabelFor = (provider: string): string => PROVIDER_LABELS[provider] ?? provider;

/** Strips bearer tokens, JWTs and API-key shapes, then bounds the length. */
export function redactAndTruncate(text: string, max = 300): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, "[redacted-jwt]")
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}/g, "[redacted-key]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
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

export type ParsedProviderBody = { status?: number; code?: string; message: string };

/**
 * Reads the shapes seen from the ChatGPT proxy: `{error, status, detail}`
 * where `detail` is itself the upstream body — `{error:{message,code}}`,
 * `{detail:"…"}`, or plain text.
 */
export function parseProviderBody(raw: string | undefined): ParsedProviderBody {
  const text = raw ?? "";
  const outer = asRecord(tryJson(text));
  if (!outer) return { message: text };
  const proxyCode = asString(outer.error);
  const status = typeof outer.status === "number" ? outer.status : undefined;
  const detailText = asString(outer.detail);
  const upstream = detailText ? (tryJson(detailText) ?? detailText) : outer;
  const upstreamRecord = asRecord(upstream);
  const nested = asRecord(upstreamRecord?.error);
  const code =
    asString(nested?.code) ?? asString(upstreamRecord?.code) ?? (proxyCode && proxyCode !== "responses_request_failed" ? proxyCode : undefined);
  const message =
    asString(nested?.message) ??
    asString(upstreamRecord?.detail) ??
    asString(upstreamRecord?.message) ??
    asString(outer.message) ??
    (typeof upstream === "string" ? upstream : undefined) ??
    proxyCode ??
    text;
  return { status, code, message };
}

const AUTH_CODES = /^(not_authenticated|token_refresh_failed|refresh_token_invalid|authorization_expired|invalid_token|token_exchange_failed)$/;
const MODEL_GONE =
  /model_not_found|model_not_allowed|model.{0,60}(does not exist|not found|not supported|unsupported|not available|no access)|(unknown|invalid) model|not supported when using codex/i;

export function classifyProviderFailure(input: { status?: number; code?: string; message: string }): ProviderFailureKind {
  const { status, code, message } = input;
  if (code === "model_not_found" || ((!status || [400, 403, 404, 422].includes(status)) && MODEL_GONE.test(`${code ?? ""} ${message}`)))
    return "model-unavailable";
  if ((code && AUTH_CODES.test(code)) || status === 401 || status === 403) return "auth";
  if (status === 429 || /rate.?limit|too many requests/i.test(`${code ?? ""} ${message}`)) return "rate-limit";
  if (code === "network_error" || (status !== undefined && (status >= 500 || status === 408 || status === 425))) return "transient";
  if (status !== undefined && status >= 400) return "bad-request";
  // Message-only errors (no HTTP status): same buckets, by wording.
  if (/\b401\b|unauthorized|api key|needs attention|not configured/i.test(message)) return "auth";
  if (/capacity.{0,20}full|temporarily|\b50[234]\b|timed out|timeout/i.test(message)) return "transient";
  return "unknown";
}

export type ProviderErrorContext = { layer: string; provider: string; model?: string };

/** Normalises any thrown value (AI SDK APICallError, plain Error, string) into a ProviderError. */
export function toProviderError(error: unknown, context: ProviderErrorContext): ProviderError {
  if (error instanceof ProviderError) return error;
  // The AI SDK wraps retried failures (429/5xx) in a RetryError whose own
  // message and status are useless; the attempt that failed is inside it.
  const retried = asRecord(error)?.lastError ?? (Array.isArray(asRecord(error)?.errors) ? (asRecord(error)!.errors as unknown[]).at(-1) : undefined);
  if (retried && retried !== error) return toProviderError(retried, context);
  const record = asRecord(error) ?? {};
  const cause = asRecord(record.cause);
  const body = asString(record.responseBody) ?? asString(cause?.responseBody);
  const parsed = parseProviderBody(body);
  const status =
    [record.statusCode, record.status, cause?.statusCode, parsed.status].find((value): value is number => typeof value === "number") ??
    undefined;
  const ownMessage = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const noOutput = record.name === "AI_NoOutputGeneratedError";
  const message = redactAndTruncate(parsed.message || (noOutput ? "The provider returned no output and no error detail." : ownMessage) || "Unknown provider failure.");
  const code = parsed.code ?? asString(record.code);
  let kind = classifyProviderFailure({ status, code, message: `${message} ${ownMessage}` });
  if (kind === "unknown" && noOutput) kind = "empty";
  if (kind === "unknown" && /fetch failed|network|timed? ?out|timeout|abort|ECONN|ETIMEDOUT/i.test(ownMessage)) kind = "transient";
  return new ProviderError({ ...context, kind, status, code, providerMessage: message }, { cause: error });
}

/** Log-safe description naming the layer at fault. Never includes request bodies or credentials. */
export function describeErrorForLog(error: unknown): Record<string, unknown> {
  if (error instanceof ProviderError) {
    return {
      errorName: error.name,
      layer: error.info.layer,
      provider: error.info.provider,
      model: error.info.model,
      kind: error.info.kind,
      status: error.info.status,
      code: error.info.code,
      message: error.info.providerMessage,
      ...(error.fallbackFailure ? { fallbackFailure: error.fallbackFailure } : {}),
    };
  }
  return {
    errorName: error instanceof Error ? error.name : "UnknownError",
    layer: "unclassified",
    message: redactAndTruncate(error instanceof Error ? error.message : String(error ?? "")),
  };
}

export const aiDebugEnabled = (): boolean => /^(1|true|on)$/i.test(process.env.ROOK_AI_DEBUG ?? "");

/** Debug-only trace; silent unless ROOK_AI_DEBUG is set. */
export function aiDebug(event: string, fields: Record<string, unknown>): void {
  if (aiDebugEnabled()) console.debug(`[RookAI:debug] ${event}`, fields);
}

/** Raw provider body for debug logs only, redacted and bounded. */
export function debugBody(error: unknown): string | undefined {
  if (!aiDebugEnabled()) return undefined;
  const record = asRecord(error) ?? {};
  const body = asString(record.responseBody) ?? asString(asRecord(record.cause)?.responseBody);
  return body ? redactAndTruncate(body, 1000) : undefined;
}

/** One-line reason a turn left the requested model, for the user-visible trace. */
export function fallbackReasonText(error: unknown): string {
  if (!(error instanceof ProviderError)) return "the requested model failed";
  const { kind, model } = error.info;
  const label = providerLabelFor(error.info.provider);
  if (kind === "model-unavailable") return `${label} doesn't offer ${model ?? "that model"} on this account`;
  if (kind === "auth") return `the ${label} connection needs to be reconnected`;
  if (kind === "rate-limit") return `${label} is rate limited`;
  return `${label} failed (${kind}${error.info.status ? ` ${error.info.status}` : ""})`;
}

/** User-visible trace line for a turn that left the requested model. Contains no credentials or provider bodies. */
export function fallbackTraceStep(
  invoked: { fellBack: boolean; fallbackReason?: string; result: { model?: string } },
): { kind: "response"; title: string; detail: string } | undefined {
  if (!invoked.fellBack || !invoked.fallbackReason) return undefined;
  return {
    kind: "response",
    title: "Answered with a backup model",
    detail: `${invoked.fallbackReason[0]!.toUpperCase()}${invoked.fallbackReason.slice(1)}, so this reply came from ${invoked.result.model || "Rook's free model"} instead.`,
  };
}

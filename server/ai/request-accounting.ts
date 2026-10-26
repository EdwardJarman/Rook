/** Request-level measurements. No prompts, tool arguments, URLs or credentials leave this scope. */
import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac, randomBytes } from "node:crypto";

export type TokenUsage = {
  input: number | null;
  output: number | null;
  cachedInput: number | null;
  /** Includes cache writes; do not price these as ordinary input without a write rate. */
  uncachedInput: number | null;
  cacheWriteInput: number | null;
  /** Subset of output, never added to output again. */
  reasoningOutput: number | null;
  providerCostUsd: number | null;
};

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? value as Record<string, unknown> : {};
const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const money = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

/** OpenAI-compatible usage; absent cache details are unknown, including on a zero-cost route. */
export function normalizeTokenUsage(value?: unknown): TokenUsage {
  const usage = object(value);
  const input = count(usage.prompt_tokens);
  const output = count(usage.completion_tokens);
  const details = object(usage.prompt_tokens_details);
  const reportedCache = count(details.cached_tokens);
  const cachedInput = reportedCache !== null && (input === null || reportedCache <= input)
    ? reportedCache : null;
  const uncachedInput = input !== null && cachedInput !== null ? input - cachedInput : null;
  const reportedWrites = count(details.cache_write_tokens);
  const cacheWriteInput = reportedWrites !== null && (uncachedInput === null || reportedWrites <= uncachedInput)
    ? reportedWrites : null;
  const reasoning = count(object(usage.completion_tokens_details).reasoning_tokens);
  return {
    input, output, cachedInput, uncachedInput, cacheWriteInput,
    reasoningOutput: reasoning !== null && (output === null || reasoning <= output) ? reasoning : null,
    providerCostUsd: money(usage.cost),
  };
}

export const INPUT_SOURCES = [
  "system", "setup", "toolDefinitions", "skills", "memory", "ledger", "searchResults",
  "history", "user", "toolResults", "assistant", "other",
] as const;
export type InputSource = typeof INPUT_SOURCES[number];
export type RequestSources = Record<InputSource, number>;
type Section = { source: InputSource; text: string };

/** Character attribution, not tokenizer output or measured cache placement. */
export function measureRequestSources(payload: Record<string, unknown>, sections: Section[] = []): RequestSources {
  const sizes = Object.fromEntries(INPUT_SOURCES.map((source) => [source, 0])) as RequestSources;
  if (payload.tools) sizes.toolDefinitions = JSON.stringify(payload.tools).length;
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  let lastUser = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (object(messages[index]).role === "user") { lastUser = index; break; }
  }
  for (const [index, raw] of messages.entries()) {
    const message = object(raw);
    const serialized = JSON.stringify(raw);
    let source: InputSource = message.role === "tool" || message.role === "function" ? "toolResults"
      : index === 0 && message.role === "system" ? "system"
        : index === lastUser ? "user"
          : index < lastUser ? "history" : "assistant";
    const setup = index === 1 && message.role === "user"
      ? sections.find((section) => section.source === "setup" && section.text === message.content)
      : undefined;
    if (setup) source = "setup";
    sizes[source] += serialized.length;
    // Split only known harness blocks, never matching ordinary user/history text.
    if ((source === "system" || setup) && typeof message.content === "string") {
      let remaining = message.content;
      for (const section of sections) {
        if (section === setup) continue;
        if (!section.text || !remaining.includes(section.text)) continue;
        const length = JSON.stringify(section.text).length - 2;
        sizes[source] -= length;
        sizes[section.source] += length;
        remaining = remaining.replace(section.text, "");
      }
    }
  }
  sizes.other = Math.max(0, JSON.stringify(payload).length - Object.values(sizes).reduce((a, b) => a + b, 0));
  return sizes;
}

export type ModelRequestRecord = {
  sequence: number;
  provider: string;
  model: string;
  resolvedModel?: string;
  /** A provider-managed agent/SDK may hide additional physical inference requests. */
  scope: "request" | "sdk-call" | "managed-agent";
  streaming: boolean;
  status: "pending" | "completed" | "failed";
  httpStatus?: number;
  latencyMs: number;
  firstTokenMs: number | null;
  usage: TokenUsage;
  inputCharacters: RequestSources;
};

type AccountingContext = {
  taskKey?: string;
  requests: ModelRequestRecord[];
  sections: Section[];
  now: () => number;
  recorded: boolean;
};
const active = new AsyncLocalStorage<AccountingContext>();
// Ephemeral, process-local attribution: not a new deployment secret or durable identifier.
const salt = randomBytes(32);
export function accountingTaskKey(owner: string, bot: string, task: string, key: Uint8Array = salt): string {
  return createHmac("sha256", key).update(JSON.stringify([owner, bot, task])).digest("hex").slice(0, 24);
}

export function withRequestAccounting<T>(
  taskKey: string | undefined,
  run: () => T,
  now: () => number = Date.now,
): T {
  return active.run({ taskKey, requests: [], sections: [], now, recorded: false }, run);
}

export function accountingTurnRecorded(): boolean { return active.getStore()?.recorded ?? false; }
export function markAccountingTurnRecorded(): void {
  const context = active.getStore();
  if (context) context.recorded = true;
}

export function setAccountingSections(sections: Section[]): void {
  const context = active.getStore();
  if (context) context.sections = sections;
}

export function requestAccountingSnapshot(): { taskKey?: string; modelRequests: ModelRequestRecord[] } | undefined {
  const context = active.getStore();
  return context ? { taskKey: context.taskKey, modelRequests: structuredClone(context.requests) } : undefined;
}

export function startModelRequest(input: {
  provider: string;
  model: string;
  payload: Record<string, unknown>;
  streaming?: boolean;
  scope?: ModelRequestRecord["scope"];
}) {
  const context = active.getStore();
  const started = context?.now() ?? 0;
  const record: ModelRequestRecord | undefined = context ? {
    sequence: context.requests.length + 1,
    provider: input.provider,
    model: input.model,
    scope: input.scope ?? "request",
    streaming: input.streaming ?? false,
    status: "pending",
    latencyMs: 0,
    firstTokenMs: null,
    usage: normalizeTokenUsage(),
    inputCharacters: measureRequestSources(input.payload, context.sections),
  } : undefined;
  if (record) context!.requests.push(record);
  return {
    token() {
      if (record && record.firstTokenMs === null) record.firstTokenMs = Math.max(0, context!.now() - started);
    },
    usage(usage: unknown, model?: string) {
      if (!record) return;
      record.usage = normalizeTokenUsage(usage);
      if (model) record.resolvedModel = model;
    },
    end(status: "completed" | "failed", httpStatus?: number) {
      if (!record || record.status !== "pending") return;
      record.status = status;
      record.latencyMs = Math.max(0, context!.now() - started);
      if (httpStatus !== undefined) record.httpStatus = httpStatus;
    },
  };
}

/** Opaque SDK/agent boundary: reported usage may cover only its final step. */
export async function observeManagedCall<T extends { usage?: unknown; model?: string }>(
  metadata: Parameters<typeof startModelRequest>[0], run: () => Promise<T>,
): Promise<T> {
  const span = startModelRequest(metadata);
  try {
    const result = await run();
    span.usage(result.usage, result.model);
    span.end("completed");
    return result;
  } catch (error) {
    span.end("failed");
    throw error;
  }
}

type Span = ReturnType<typeof startModelRequest>;
const responseSpans = new WeakMap<Response, Span>();

/** Each retry reaches this boundary separately. Headers/body are never retained in telemetry. */
export async function fetchModelCompletion(
  url: string,
  init: RequestInit,
  metadata: { provider: string; model: string; payload: Record<string, unknown> },
): Promise<Response> {
  const span = startModelRequest(metadata);
  try {
    const response = await fetch(url, init);
    if (!response.ok) span.end("failed", response.status);
    else responseSpans.set(response, span);
    return response;
  } catch (error) {
    span.end("failed");
    throw error;
  }
}

export async function readModelJson<T>(response: Response): Promise<T> {
  const span = responseSpans.get(response);
  try {
    const body = await response.json();
    span?.usage(body.usage, body.model);
    span?.end("completed", response.status);
    return body as T;
  } catch (error) {
    span?.end("failed", response.status);
    throw error;
  } finally {
    responseSpans.delete(response);
  }
}

export type UsageTotals = {
  requests: number;
  completed: number;
  /** Each number is a known subtotal; corresponding unknown count prevents false completeness. */
  known: TokenUsage;
  unknown: Record<keyof TokenUsage, number>;
};
export function summarizeUsage(requests: ModelRequestRecord[]): UsageTotals {
  const fields = Object.keys(normalizeTokenUsage()) as Array<keyof TokenUsage>;
  const known = Object.fromEntries(fields.map((key) => [key, 0])) as TokenUsage;
  const unknown = Object.fromEntries(fields.map((key) => [key, 0])) as UsageTotals["unknown"];
  for (const request of requests) for (const key of fields) {
    const value = request.usage[key];
    if (value === null) unknown[key] += 1;
    else known[key] = (known[key] ?? 0) + value;
  }
  return { requests: requests.length, completed: requests.filter((r) => r.status === "completed").length, known, unknown };
}

export type TokenRates = { uncachedInput: number; cachedInput: number; output: number; cacheWriteInput?: number };
/** Rates are USD per million tokens, supplied with a separately verified model/rate snapshot. */
export function priceTokenUsage(usage: TokenUsage, rates: TokenRates): number | null {
  if (Object.values(rates).some((rate) => !Number.isFinite(rate) || rate < 0)) return null;
  if (usage.uncachedInput === null || usage.cachedInput === null || usage.output === null) return null;
  // Unknown cache writes prevent a cost claim when writes have a distinct price.
  if (rates.cacheWriteInput !== undefined && usage.cacheWriteInput === null) return null;
  const writes = usage.cacheWriteInput ?? 0;
  return ((usage.uncachedInput - writes) * rates.uncachedInput + usage.cachedInput * rates.cachedInput
    + writes * (rates.cacheWriteInput ?? rates.uncachedInput) + usage.output * rates.output) / 1_000_000;
}

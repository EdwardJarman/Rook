/**
 * OpenCode provider: Rook talks to a real `opencode serve` headless server
 * over its HTTP API (verified against opencode v1.18.31):
 *
 * - `GET /global/health` -> `{ healthy: true, version }`
 * - `GET /api/model` -> `{ data: [{ id, providerID, modelID, name }] }`
 * - `POST /api/session { model: { providerID, id } }` -> `{ data: { id: ses_* } }`
 * - `POST /api/session/{id}/prompt { prompt: { text } }` -> `{ data: { id: msg_* } }`
 * - `GET /api/session/{id}/history` -> `{ data: [events] }` where completion is
 *   a `session.next.step.ended` event and the answer lives at
 *   `GET /api/session/{id}/message/{assistantMessageID}` ->
 *   `{ data: { content: [{ type: "text", text }], finish, tokens } }`.
 *
 * One Rook turn = one fresh OpenCode session (stateless from Rook's side, no
 * cross-talk between turns). Auth is HTTP Basic: username `opencode` (or
 * `OPENCODE_SERVER_USERNAME`) + `OPENCODE_SERVER_PASSWORD`, matching
 * `opencode serve` / `opencode run -u/-p` semantics.
 *
 * Configuration (server env):
 * - `OPENCODE_BASE_URL` (e.g. `http://127.0.0.1:4123`) — required. Models are
 *   listed only when this is set, so the UI shows OpenCode as "not ready"
 *   with setup guidance instead of a dead button.
 * - `OPENCODE_SERVER_PASSWORD` / `OPENCODE_SERVER_USERNAME` — when the
 *   `opencode serve` instance requires Basic auth.
 */

import type { InvokeParams, InvokeResult, Message } from "../_core/llm";
import type { RookAiModel } from "./openrouter";
import { observeManagedCall } from "./request-accounting";
import { modelHealth } from "./model-health";
import { aiDebug, classifyProviderFailure, ProviderError } from "./provider-error";
import {
  GATEWAY_DOWN_TTL_MS,
  isGatewayEndpointDown,
  openCodeError,
  parseOpenCodeBody,
  stepFailure,
  unservedReason,
  type OpenCodeLayer,
  type ServedModel,
} from "./opencode-errors";
import {
  OPENCODE_DEFAULT_BASE,
  ensureManagedServer,
  isLoopbackBaseUrl,
  isManagedEnabled,
  managedAuthPassword,
} from "./opencode-server";

export const OPENCODE_MODEL_PREFIX = "opencode:";
export const OPENCODE_DEFAULT_MODEL = `${OPENCODE_MODEL_PREFIX}big-pickle`;

/** History poll cadence; `OPENCODE_POLL_INTERVAL_MS` exists so hermetic tests don't wait in real seconds. */
const pollIntervalMs = (): number => {
  const raw = Number(process.env.OPENCODE_POLL_INTERVAL_MS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 1_000;
};
const HEALTH_TIMEOUT_MS = 15_000;
/**
 * How long one turn may run. OpenCode agents legitimately work for many
 * minutes (multi-step plans, tool calls, big generations), so the default
 * is 20 minutes — override with `OPENCODE_TURN_TIMEOUT_MS` (milliseconds).
 * This is a backstop against wedged turns, not a leash on good work.
 */
const turnTimeoutMs = (): number => {
  const raw = Number(process.env.OPENCODE_TURN_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  return 20 * 60 * 1_000;
};
/** Polls with an unchanged history after a step ended before idling out. */
const IDLE_QUIET_POLLS = 3;
/**
 * No new history events for this long = suspected stall → check whether
 * the agent is waiting on a permission decision. Override with
 * `OPENCODE_STALL_AFTER_MS` (milliseconds).
 */
const stallAfterMs = (): number => {
  const raw = Number(process.env.OPENCODE_STALL_AFTER_MS);
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  return 45_000;
};

/**
 * Curated free models on OpenCode's own `opencode` provider gateway
 * (verified live via `GET /api/model`: `{ id, providerID: "opencode" }`).
 * Kept small and fast on purpose — `big-pickle` answered a probe turn in
 * ~250ms. Rook ids are `opencode:<id>`; the part after the prefix is passed
 * straight through as the OpenCode model `id`.
 */
const OPENCODE_MODELS = [
  {
    upstreamId: "big-pickle",
    name: "Big Pickle",
    description: "Fast free model served directly through your OpenCode server.",
  },
  {
    upstreamId: "muse-spark-1.3-contributor-free",
    name: "Muse Spark 1.3",
    description: "Free Muse Spark 1.3 model served directly through your OpenCode server.",
  },
  {
    upstreamId: "muse-spark-1.2-contributor-free",
    name: "Muse Spark 1.2",
    description: "Free Muse Spark 1.2 model served directly through your OpenCode server.",
  },
  {
    upstreamId: "ling-3.0-flash-fin-free",
    name: "Ling 3 Flash",
    description: "Free Ling 3 Flash model served directly through your OpenCode server.",
  },
  {
    upstreamId: "mimo-v2.5-free",
    name: "MiMo V2.5",
    description: "Free MiMo V2.5 model served directly through your OpenCode server.",
  },
  {
    upstreamId: "nemotron-3-ultra-free",
    name: "Nemotron 3 Ultra",
    description: "Free Nemotron 3 Ultra model served directly through your OpenCode server.",
  },
  {
    upstreamId: "nemotron-3.5-lightning-free",
    name: "Nemotron 3.5 Lightning",
    description: "Free Nemotron 3.5 Lightning model served directly through your OpenCode server.",
  },
] as const;

export const opencodeBaseUrl = (): string =>
  (process.env.OPENCODE_BASE_URL ?? "").trim().replace(/\/+$/, "");

export const isOpenCodeConfigured = (): boolean => opencodeBaseUrl().length > 0;

/**
 * Where turns actually dial. Explicit OPENCODE_BASE_URL wins; otherwise a
 * managed Rook server on loopback is assumed (zero-config local dev) —
 * unless management is disabled, in which case there is no server.
 */
export const effectiveOpenCodeBase = (): string => {
  const explicit = opencodeBaseUrl();
  if (explicit) return explicit;
  return isManagedEnabled() ? OPENCODE_DEFAULT_BASE : "";
};

export const isOpenCodeManaged = (): boolean =>
  !isOpenCodeConfigured() &&
  isManagedEnabled() &&
  isLoopbackBaseUrl(effectiveOpenCodeBase());

const opencodeAuthHeader = (): Record<string, string> => {
  const password = managedAuthPassword();
  if (!password) return {};
  const username = (process.env.OPENCODE_SERVER_USERNAME ?? "").trim() || "opencode";
  return {
    Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
  };
};

export const listOpenCodeModels = (): RookAiModel[] => {
  if (!effectiveOpenCodeBase()) return [];
  return OPENCODE_MODELS.map((model) => ({
    id: `${OPENCODE_MODEL_PREFIX}${model.upstreamId}`,
    name: model.name,
    provider: "OpenCode",
    description: model.description,
    contextLength: 0,
    supportsTools: false,
    supportsVision: false,
    automatic: false,
    free: true,
    usageLabel: "Free · OpenCode",
  }));
};

export const isOpenCodeModel = (modelId?: string): boolean => {
  if (!modelId?.startsWith(OPENCODE_MODEL_PREFIX)) return false;
  const raw = modelId.slice(OPENCODE_MODEL_PREFIX.length);
  return OPENCODE_MODELS.some((model) => model.upstreamId === raw);
};

const SERVED_TTL_MS = 60_000;
const SERVED_TIMEOUT_MS = 5_000;
let servedCache: { base: string; at: number; models: Map<string, ServedModel> } | undefined;

/**
 * The models the live server serves under the `opencode` provider, or
 * undefined when that can't be established (unreachable, old/odd shape).
 * Never throws: an unknown answer must not block a turn the server may
 * well be able to run.
 */
export const fetchServedModels = async (options?: { force?: boolean }): Promise<Map<string, ServedModel> | undefined> => {
  const base = effectiveOpenCodeBase();
  if (!base) return undefined;
  if (!options?.force && servedCache && servedCache.base === base && Date.now() - servedCache.at < SERVED_TTL_MS) {
    return servedCache.models;
  }
  try {
    const response = await apiFetch("/api/model", { method: "GET", timeoutMs: SERVED_TIMEOUT_MS });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return undefined;
    }
    const body = (await response.json().catch(() => undefined)) as
      | { data?: Array<{ id?: unknown; providerID?: unknown; status?: unknown; enabled?: unknown }> }
      | undefined;
    const models = new Map<string, ServedModel>();
    for (const entry of Array.isArray(body?.data) ? body.data : []) {
      if (entry.providerID !== "opencode" || typeof entry.id !== "string") continue;
      models.set(entry.id, {
        id: entry.id,
        status: typeof entry.status === "string" ? entry.status : undefined,
        enabled: typeof entry.enabled === "boolean" ? entry.enabled : undefined,
      });
    }
    if (!models.size) return undefined;
    servedCache = { base, at: Date.now(), models };
    return models;
  } catch (error) {
    aiDebug("opencode model list unavailable", { message: error instanceof Error ? error.message : String(error) });
    return undefined;
  }
};

const UNAVAILABLE_LABEL = "Unavailable on this server";

/**
 * The catalog with truth applied: ids the live server doesn't serve (or has
 * disabled), and ids whose last turn proved them dead, come back flagged
 * `unavailable` with the reason — the picker shows them disabled instead of
 * offering a model that can only fail.
 */
export const listOpenCodeModelsLive = async (): Promise<RookAiModel[]> => {
  const models = listOpenCodeModels();
  if (!models.length) return models;
  const served = await fetchServedModels();
  const scope = effectiveOpenCodeBase();
  return models.map((model) => {
    const upstream = model.id.slice(OPENCODE_MODEL_PREFIX.length);
    const state = modelHealth.stateOf(scope, upstream);
    const reason =
      (served ? unservedReason(served.get(upstream), upstream) : undefined) ??
      (state?.state === "unavailable" ? (state.reason ?? "OpenCode rejected this model.") : undefined);
    return reason ? { ...model, description: reason, usageLabel: UNAVAILABLE_LABEL, unavailable: true, unavailableReason: reason } : model;
  });
};

const upstreamModelId = (modelId: string | undefined): string => {
  if (!modelId) throw new Error("Choose an OpenCode model first.");
  if (!isOpenCodeModel(modelId))
    throw new Error("That OpenCode model is not available in Rook.");
  return modelId.slice(OPENCODE_MODEL_PREFIX.length);
};

type OpenCodeApiError = { message?: string; error?: string };

const readErrorSnippet = async (response: Response): Promise<string> => {
  try {
    const text = await response.text();
    return text.slice(0, 2000).trim();
  } catch {
    return "";
  }
};

const layerForAction = (action: string): OpenCodeLayer => {
  if (action === "session create") return "opencode-session";
  if (action === "prompt") return "opencode-prompt";
  if (action === "health check" || action === "model list") return "opencode-server";
  return "opencode-poll";
};

const throwForStatus = async (response: Response, action: string, model?: string): Promise<never> => {
  const raw = await readErrorSnippet(response);
  const parsed = parseOpenCodeBody(raw);
  const snippet = parsed.message.slice(0, 300).trim();
  const detail = snippet ? ` — ${snippet}` : "";
  const status = response.status;
  let message: string;
  if (status === 401 || status === 403) {
    message = `Rook's OpenCode connection needs attention (the server rejected our credentials)${detail}.`;
  } else if (status === 404) {
    message = `OpenCode ${action} was not found (404)${detail}.`;
  } else if ([429, 502, 503, 504].includes(status)) {
    message = `OpenCode is temporarily unavailable (${status})${detail}.`;
  } else {
    message = `OpenCode ${action} failed (${status})${detail}.`;
  }
  const kind = classifyProviderFailure({ status, code: parsed.code, message });
  throw openCodeError({ layer: layerForAction(action), model, kind, status, code: parsed.code, message, raw });
};

const combineSignal = (userSignal?: AbortSignal | null, timeoutMs?: number): AbortSignal => {
  const timeout = AbortSignal.timeout(timeoutMs ?? turnTimeoutMs());
  if (!userSignal) return timeout;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([userSignal, timeout]);
  if (userSignal.aborted) {
    const controller = new AbortController();
    controller.abort(userSignal.reason);
    return controller.signal;
  }
  return timeout;
};

const apiFetch = async (
  path: string,
  init?: RequestInit & { userSignal?: AbortSignal | null; timeoutMs?: number },
): Promise<Response> => {
  const base = effectiveOpenCodeBase();
  if (!base)
    throw openCodeError({
      layer: "opencode-config",
      kind: "auth",
      code: "not_configured",
      message:
        "OpenCode is not connected. Set OPENCODE_BASE_URL (e.g. http://127.0.0.1:4123) or enable the managed server with OPENCODE_MANAGED=1, then select OpenCode again.",
    });
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...opencodeAuthHeader(),
        ...(init?.headers ?? {}),
      },
      signal: init?.signal ?? combineSignal(init?.userSignal, init?.timeoutMs),
    });
  } catch (error) {
    if ((init?.userSignal as AbortSignal | undefined)?.aborted) {
      throw new Error("OpenCode request was aborted.");
    }
    const reason = error instanceof Error ? error.message : String(error);
    if (error instanceof Error && error.name === "TimeoutError") {
      throw openCodeError(
        { layer: "opencode-server", kind: "transient", code: "request_timeout", message: `OpenCode server at ${base} did not answer ${path} in time (request timed out).` },
        error,
      );
    }
    const code = (error as { cause?: { code?: unknown } } | undefined)?.cause?.code;
    throw openCodeError(
      {
        layer: "opencode-server",
        kind: "transient",
        code: typeof code === "string" ? code : "unreachable",
        message: `OpenCode server is unreachable at ${base} (fetch failed: ${reason}). Start \`opencode serve\` and check OPENCODE_BASE_URL.`,
      },
      error,
    );
  }
  return response;
};

/**
 * Live tail of `GET /api/event` for one session. Forwards
 * `session.next.text.delta` chunks as they arrive (reasoning deltas stay
 * internal — the UI already shows a thinking state) and resolves when that
 * session's `session.next.step.ended` arrives. The stream is server-global,
 * so events for other sessions are ignored by `sessionID`.
 *
 * Rejects on early close/error so the caller can fall back to history
 * polling — live tokens are a speedup, never load-bearing.
 */
const subscribeSessionEvents = async (args: {
  sessionId: string;
  onDelta?: (delta: string) => void;
  onToolActivity?: (tool: string) => void;
  userSignal?: AbortSignal | null;
  deadline: number;
  /**
   * Multi-step turns emit `step.ended` between steps: only exit the tail
   * when the turn itself is complete, otherwise later steps stream into
   * the void and their text lands as one end-of-turn blob.
   */
  shouldExit?: () => boolean;
}): Promise<void> => {
  const response = await apiFetch(
    "/api/event",
    {
      method: "GET",
      headers: { Accept: "text/event-stream" },
      userSignal: args.userSignal,
      timeoutMs: Math.max(1000, args.deadline - Date.now()),
    },
  );
  if (!response.ok || !response.body) {
    throw new Error(`OpenCode event stream unavailable (${response.status}).`);
  }
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      if (Date.now() > args.deadline) throw new Error("OpenCode request timed out before finishing.");
      const { done, value } = await reader.read();
      if (done) throw new Error("OpenCode event stream closed early.");
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice("data:".length).trim())
          .join("\n")
          .trim();
        if (!data) continue;
        let event: {
          type?: string;
          data?: { sessionID?: string; delta?: string; tool?: string };
        };
        try {
          event = JSON.parse(data) as {
            type?: string;
            data?: { sessionID?: string; delta?: string; tool?: string };
          };
        } catch {
          continue;
        }
        if (event.data?.sessionID !== args.sessionId) continue;
        if (
          event.type === "session.next.text.delta" &&
          typeof event.data.delta === "string" &&
          event.data.delta
        ) {
          try {
            args.onDelta?.(event.data.delta);
          } catch {
            // Render hints must never break the turn.
          }
        }
        if (
          event.type === "session.next.tool.called" &&
          typeof event.data.tool === "string" &&
          event.data.tool
        ) {
          try {
            args.onToolActivity?.(event.data.tool);
          } catch {
            // Render hints must never break the turn.
          }
        }
        // Multi-step turns end intermediate steps while more work
        // follows: only leave the tail once the turn itself is done.
        // Without a callback the historic one-shot behavior is kept.
        if (event.type === "session.next.step.ended" && (!args.shouldExit || args.shouldExit())) {
          return;
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Already closed.
    }
    try {
      await response.body?.cancel();
    } catch {
      // Already settled.
    }
  }
};

/** Single text prompt for one turn: system context first, then user turns in order. */
export const promptTextFor = (messages: Message[]): string => {
  const parts: string[] = [];
  for (const message of messages) {
    if (message.role !== "system" && message.role !== "user") continue;
    const content = Array.isArray(message.content) ? message.content : [message.content];
    const text = content
      .map((part) => (typeof part === "string" ? part : part.type === "text" ? part.text : ""))
      .join("")
      .trim();
    if (text) parts.push(text);
  }
  const prompt = parts.join("\n\n").trim();
  if (!prompt) throw new Error("There is no message text to send to OpenCode.");
  return prompt;
};

type HistoryEvent = {
  type: string;
  data?: {
    assistantMessageID?: string;
    [key: string]: unknown;
  };
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export type OpenCodeStatus = {
  provider: "opencode";
  configured: boolean;
  operational: boolean;
  freeModels: number;
  dailyFreeRequestAllowance: null;
  message: string;
};

export const opencodeStatus = async (): Promise<OpenCodeStatus> => {
  const base = effectiveOpenCodeBase();
  const managed = isOpenCodeManaged();
  if (!base) {
    return {
      provider: "opencode",
      configured: false,
      operational: false,
      freeModels: OPENCODE_MODELS.length,
      dailyFreeRequestAllowance: null,
      message:
        "OpenCode management is off and no server is set. Set OPENCODE_BASE_URL (e.g. http://127.0.0.1:4123) or enable it with OPENCODE_MANAGED=1, then select OpenCode again.",
    };
  }
  try {
    // Managed loopback servers self-heal here: a dead server is restarted
    // before we report, so the card flips back to Online by itself.
    let started = false;
    if (managed) {
      started = (await ensureManagedServer(base)).started;
    }
    const response = await apiFetch("/global/health", {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (!response.ok) {
      await throwForStatus(response, "health check");
    }
    const body = (await response.json().catch(() => ({}))) as {
      healthy?: boolean;
      version?: string;
    };
    const operational = body.healthy !== false;
    const where = managed
      ? `Rook runs your OpenCode server locally${started ? " (just started)" : ""}`
      : `OpenCode server at ${base}`;
    return {
      provider: "opencode",
      configured: true,
      operational,
      freeModels: OPENCODE_MODELS.length,
      dailyFreeRequestAllowance: null,
      message: operational
        ? `${where}: ${OPENCODE_MODELS.length} selected free models are available${body.version ? ` (opencode v${body.version})` : ""}.`
        : "The OpenCode server answered but reported unhealthy.",
    };
  } catch (error) {
    return {
      provider: "opencode",
      configured: true,
      operational: false,
      freeModels: OPENCODE_MODELS.length,
      dailyFreeRequestAllowance: null,
      message:
        error instanceof ProviderError
          ? error.info.providerMessage
          : error instanceof Error
            ? error.message
            : "OpenCode health check failed.",
    };
  }
};

export type InvokeOpenCodeOptions = {
  /** Live text deltas, forwarded as the model generates (powers streaming UI). */
  onToken?: (delta: string) => void;
  /** Fired for every tool the OpenCode agent runs (powers live progress). */
  onToolActivity?: (tool: string) => void;
  /** Client abort (e.g. user navigates away) stops the SSE tail + polling. */
  signal?: AbortSignal | null;
};

export async function invokeOpenCode(
  params: InvokeParams,
  opts?: InvokeOpenCodeOptions,
): Promise<InvokeResult> {
  return observeManagedCall({ provider: "opencode", model: params.model ?? OPENCODE_DEFAULT_MODEL,
    payload: params, scope: "managed-agent" }, () => invokeAccountedOpenCode(params, opts));
}

async function invokeAccountedOpenCode(
  params: InvokeParams,
  opts?: InvokeOpenCodeOptions,
): Promise<InvokeResult> {
  const requested = params.model ?? OPENCODE_DEFAULT_MODEL;
  const modelId = upstreamModelId(requested);
  try {
    const result = await runOpenCodeTurn(requested, modelId, params, opts);
    modelHealth.mark(effectiveOpenCodeBase(), modelId, "ok");
    return result;
  } catch (error) {
    if (error instanceof ProviderError && error.kind === "model-unavailable") {
      modelHealth.mark(effectiveOpenCodeBase(), modelId, "unavailable", error.info.providerMessage);
    } else if (isGatewayEndpointDown(error)) {
      modelHealth.mark(effectiveOpenCodeBase(), modelId, "unavailable", error.info.providerMessage, GATEWAY_DOWN_TTL_MS);
    }
    throw error;
  }
}

type StepError = { type?: unknown; message?: unknown };
type TurnState = {
  assistantMessageId?: string;
  /** How the most recent step ended; cleared while a newer step is running. */
  terminal?: { kind: "ended"; finish?: string } | { kind: "failed"; error?: StepError };
  started: boolean;
  eventCount: number;
};

async function runOpenCodeTurn(
  requested: string,
  modelId: string,
  params: InvokeParams,
  opts?: InvokeOpenCodeOptions,
): Promise<InvokeResult> {
  // Standing instruction (scoped to OpenCode turns only): files the agent
  // builds are only attachable when the answer states their absolute paths.
  // Without this, models write "in your workspace" and the files strand.
  const prompt =
    `${promptTextFor(params.messages)}\n\n` +
    `(If you create or modify files, always state each file's absolute path in your reply.)`;
  const userSignal = opts?.signal ?? null;
  if (userSignal?.aborted) throw new Error("OpenCode request was aborted.");

  // Managed servers self-heal per turn: a rebooted machine or a dead
  // process restarts transparently instead of failing the chat.
  if (isOpenCodeManaged()) {
    await ensureManagedServer(effectiveOpenCodeBase());
  }

  // The server accepts a prompt for a model it doesn't serve and then never
  // starts a step (no error, no event) — so ask first instead of waiting out
  // the turn budget.
  const served = await fetchServedModels();
  const unserved = served ? unservedReason(served.get(modelId), modelId) : undefined;
  if (unserved) {
    throw openCodeError({ layer: "opencode-catalog", model: requested, kind: "model-unavailable", code: "model_not_served", message: unserved });
  }
  aiDebug("opencode dispatch", { requestedModel: requested, upstream: modelId, base: effectiveOpenCodeBase(), served: served?.get(modelId) });

  const post = async (path: string, body: Record<string, unknown>, action: string) => {
    const response = await apiFetch(path, {
      method: "POST",
      body: JSON.stringify(body),
      userSignal,
    });
    if (!response.ok) await throwForStatus(response, action, requested);
    return (await response.json().catch(() => ({}))) as { data?: { id?: string } };
  };

  const created = await post(
    "/api/session",
    { model: { providerID: "opencode", id: modelId } },
    "session create",
  );
  const sessionId = created.data?.id;
  if (!sessionId) {
    throw openCodeError({ layer: "opencode-session", model: requested, kind: "unknown", code: "no_session_id", message: "OpenCode did not return a session id (unexpected response from the server)." });
  }

  const deadline = Date.now() + turnTimeoutMs();
  // Best-effort live tail: text deltas stream to the UI while the turn runs.
  // If the event stream is unavailable, history polling below still
  // completes the turn (just without incremental tokens).
  const turnDone = { current: false };
  const tailController = new AbortController();
  const tailSignal =
    userSignal && typeof AbortSignal.any === "function"
      ? AbortSignal.any([tailController.signal, userSignal])
      : tailController.signal;
  const liveTail = subscribeSessionEvents({
    sessionId,
    onDelta: opts?.onToken,
    onToolActivity: opts?.onToolActivity,
    userSignal: tailSignal,
    deadline,
    shouldExit: () => turnDone.current,
  });
  // Swallow rejections here — completion is decided by the poll loop
  // below, and a dead event stream must never fail a turn that polling
  // can still finish. The tail exists only to forward live text deltas.
  void liveTail.then(
    () => undefined,
    (error) => aiDebug("opencode event tail ended", { message: error instanceof Error ? error.message : String(error) }),
  );

  const admitted = await post(
    `/api/session/${sessionId}/prompt`,
    { prompt: { text: prompt } },
    "prompt",
  );
  if (!admitted.data?.id) {
    throw openCodeError({ layer: "opencode-prompt", model: requested, kind: "unknown", code: "prompt_not_admitted", message: "OpenCode did not admit the prompt (unexpected response from the server)." });
  }

  const readAnswer = async (assistantMessageId: string): Promise<InvokeResult | null> => {
    const messageResponse = await apiFetch(
      `/api/session/${sessionId}/message/${assistantMessageId}`,
      { userSignal, timeoutMs: HEALTH_TIMEOUT_MS },
    );
    if (!messageResponse.ok) await throwForStatus(messageResponse, "message read", requested);
    const message = (await messageResponse.json().catch(() => ({}))) as {
      data?: {
        content?: Array<{ type?: string; text?: string }>;
        finish?: string;
        error?: StepError;
        tokens?: { input?: number; output?: number };
        time?: { completed?: number };
      };
    };
    const content = message.data?.content ?? [];
    if (!message.data?.time?.completed) return null;
    const text = content
      .filter((part) => part.type === "text" && part.text)
      .map((part) => part.text as string)
      .join("\n")
      .trim();
    // A failed step carries its reason in `error`, not in the (empty) content.
    if (message.data.finish === "error") throw stepFailure(message.data.error ?? { message: text }, requested);
    const input = message.data.tokens?.input;
    const output = message.data.tokens?.output;
    if (!text) {
      throw openCodeError({
        layer: "opencode-turn",
        model: requested,
        kind: "empty",
        code: message.data.finish,
        message: `OpenCode returned an empty reply (finish: ${message.data.finish ?? "none"}, ${output ?? 0} output tokens).`,
      });
    }
    return {
      id: assistantMessageId,
      created: Date.now(),
      model: requested,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: text },
          finish_reason: message.data.finish ?? "stop",
        },
      ],
      usage: {
        prompt_tokens: input,
        completion_tokens: output,
        total_tokens: input !== undefined && output !== undefined ? input + output : undefined,
      },
    };
  };

  const pollSession = async (): Promise<TurnState> => {
    const historyResponse = await apiFetch(`/api/session/${sessionId}/history`, {
      userSignal,
      timeoutMs: HEALTH_TIMEOUT_MS,
    });
    if (!historyResponse.ok) await throwForStatus(historyResponse, "history poll", requested);
    const history = (await historyResponse.json().catch(() => ({}))) as {
      data?: HistoryEvent[];
    };
    const events = history.data ?? [];
    const state: TurnState = { started: false, eventCount: events.length };
    for (const event of events) {
      if (event.type === "session.next.step.started" && event.data?.assistantMessageID) {
        state.assistantMessageId = event.data.assistantMessageID;
        state.started = true;
        state.terminal = undefined;
      } else if (event.type === "session.next.step.ended") {
        const finish = event.data?.finish;
        state.terminal = { kind: "ended", finish: typeof finish === "string" ? finish : undefined };
      } else if (event.type === "session.next.step.failed") {
        state.terminal = { kind: "failed", error: event.data?.error as StepError | undefined };
      }
    }
    return state;
  };

  const activeSessions = async (): Promise<Set<string> | undefined> => {
    try {
      const response = await apiFetch("/api/session/active", { userSignal, timeoutMs: HEALTH_TIMEOUT_MS });
      if (!response.ok) return undefined;
      const body = (await response.json().catch(() => undefined)) as { data?: unknown } | undefined;
      return body?.data && typeof body.data === "object" ? new Set(Object.keys(body.data)) : undefined;
    } catch {
      return undefined;
    }
  };

  /**
   * A stalled turn is usually the agent waiting on a permission decision
   * (shell/file writes default to ask). Rook never auto-approves those —
   * that would execute arbitrary commands on the user's machine — so a
   * stall surfaces as an honest, actionable message instead. A stall with
   * no pending permission and a session the server no longer runs means the
   * turn silently died: say so rather than wait out the budget.
   */
  const diagnoseStall = async (state: TurnState): Promise<void> => {
    const response = await apiFetch(`/api/session/${sessionId}/permission`, {
      userSignal,
      timeoutMs: HEALTH_TIMEOUT_MS,
    });
    if (response.ok) {
      const body = (await response.json().catch(() => ({}))) as { data?: unknown };
      const pending = Array.isArray(body.data) ? body.data : [];
      if (pending.length) {
        const first = pending[0] as { title?: string; action?: string; tool?: string; permission?: string } | undefined;
        const hint =
          (typeof first?.title === "string" && first.title) ||
          (typeof first?.action === "string" && first.action) ||
          (typeof first?.permission === "string" && first.permission) ||
          (typeof first?.tool === "string" && first.tool) ||
          "a tool call";
        throw openCodeError({
          layer: "opencode-turn",
          model: requested,
          kind: "permission",
          code: "permission_pending",
          message: `OpenCode paused waiting for a permission decision (${hint}). Approve or deny it in \`opencode web\` / the OpenCode TUI, or set that permission to allow in opencode.json — Rook will not approve shell or file writes on your machine by itself. Then send your message again.`,
        });
      }
    }
    const active = await activeSessions();
    if (active && !active.has(sessionId)) {
      throw openCodeError({
        layer: "opencode-turn",
        model: requested,
        kind: "empty",
        code: state.started ? "stopped_early" : "never_started",
        message: state.started
          ? "OpenCode stopped after a tool call without writing a reply (the session is idle on the server)."
          : "OpenCode accepted the prompt but never started processing it (the session is idle and no model step ran). Check the OpenCode server log.",
      });
    }
  };

  // Completion = the session went idle: a step ended with a final finish
  // reason AND the history stopped growing. `tool-calls` means more steps
  // follow (the next one may take seconds to start), so it never completes
  // a turn. A failed step is final once the history settles — a retry would
  // grow it. The live tail concurrently forwards text deltas so the UI
  // streams while the turn runs; the final text always comes from the
  // message read (source of truth, never partials).
  let lastEventCount = -1;
  let quietPolls = 0;
  let lastProgressAt = Date.now();
  let lastStallCheckAt = 0;
  try {
    for (;;) {
      if (userSignal?.aborted) throw new Error("OpenCode request was aborted.");
      const state = await pollSession();
      if (state.eventCount !== lastEventCount) {
        lastEventCount = state.eventCount;
        quietPolls = 0;
        lastProgressAt = Date.now();
      } else {
        quietPolls += 1;
      }
      const settled = quietPolls >= IDLE_QUIET_POLLS;
      if (settled && state.terminal?.kind === "failed") throw stepFailure(state.terminal.error, requested);
      const idle = settled && state.terminal?.kind === "ended" && state.terminal.finish !== "tool-calls";
      if (idle && state.assistantMessageId) {
        const answer = await readAnswer(state.assistantMessageId);
        if (answer) {
          turnDone.current = true;
          return answer;
        }
      }
      if (!idle && Date.now() - lastProgressAt > stallAfterMs() && Date.now() - lastStallCheckAt > 30_000) {
        lastStallCheckAt = Date.now();
        await diagnoseStall(state);
      }
      if (Date.now() > deadline) {
        throw openCodeError({
          layer: "opencode-turn",
          model: requested,
          kind: "timeout",
          code: "turn_budget",
          message:
            "OpenCode is still working past the turn budget. It keeps running server-side — ask for a status update, or raise OPENCODE_TURN_TIMEOUT_MS for very long jobs.",
        });
      }
      await sleep(pollIntervalMs());
    }
  } finally {
    // Release the event-stream connection however the turn ended.
    turnDone.current = true;
    tailController.abort();
  }
}

export const __resetOpenCodeForTests = (): void => {
  servedCache = undefined;
};

/* ------------------------------------------------------------------ */
/* Turn files: agent-built artifacts surfaced in the browser.          */
/*                                                                     */
/* When an OpenCode turn builds a file, the answer text names its      */
/* absolute path — but that path lives on the Rook server's machine,   */
/* useless to a browser (and unreachable in production). So Rook reads */
/* the bytes back through the OpenCode filesystem API and attaches     */
/* them to the turn: the chat renders them as real files the user can  */
/* open/download in the browser. Only text artifacts the model itself  */
/* named, size- and count-capped; anything else stays a path in text.  */
/* ------------------------------------------------------------------ */

export type TurnFile = {
  name: string;
  mimeType: string;
  content: string;
};

const ARTIFACT_EXTENSIONS: Record<string, string> = {
  html: "text/html",
  htm: "text/html",
  md: "text/markdown",
  txt: "text/plain",
  json: "application/json",
  js: "text/plain",
  jsx: "text/plain",
  ts: "text/plain",
  tsx: "text/plain",
  py: "text/plain",
  css: "text/plain",
  csv: "text/plain",
  xml: "text/plain",
  yml: "text/plain",
  yaml: "text/plain",
  sql: "text/plain",
  sh: "text/plain",
};

const MAX_TURN_FILES = 3;
const MAX_TURN_FILE_BYTES = 256 * 1024;

const stripTrailingPunct = (path: string): string =>
  path.replace(/[.,;:!?)\]}>"']+$/, "");

/**
 * Absolute file paths the answer text names (Windows `C:\…` or posix
 * `/…`), restricted to readable text-artifact extensions. Exported for
 * tests; the collector below verifies each one against the live server.
 */
export const extractArtifactPaths = (text: string): string[] => {
  const found: string[] = [];
  const patterns = [
    /[A-Za-z]:\\(?:[^\\/:*?"'<>|\r\n]+\\)*[^\\/:*?"'<>|\r\n]+\.[A-Za-z0-9]{1,5}/g,
    /(^|[\s"'(\[{])(\/(?:[^/:*?"'<>|\s]+\/)*[^/:*?"'<>|\s]+\.[A-Za-z0-9]{1,5})/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = stripTrailingPunct(match[2] ?? match[0]).trim();
      if (!raw) continue;
      const ext = raw.split(".").pop()?.toLowerCase() ?? "";
      if (!ARTIFACT_EXTENSIONS[ext]) continue;
      if (!found.includes(raw)) found.push(raw);
      if (found.length >= MAX_TURN_FILES) return found;
    }
  }
  return found;
};

const readTurnFile = async (absPath: string): Promise<TurnFile | null> => {
  const forward = absPath.replace(/\\/g, "/");
  let response: Response;
  try {
    response = await apiFetch(`/api/fs/read/${forward}`, {
      method: "GET",
      timeoutMs: HEALTH_TIMEOUT_MS,
    });
  } catch {
    return null;
  }
  if (!response.ok) {
    try {
      await response.body?.cancel();
    } catch {
      // Already settled.
    }
    return null;
  }
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_TURN_FILE_BYTES) {
    try {
      await response.body?.cancel();
    } catch {
      // Already settled.
    }
    return null;
  }
  let content: string;
  try {
    content = await response.text();
  } catch {
    return null;
  }
  if (content.length > MAX_TURN_FILE_BYTES) return null;
  const name = forward.split("/").pop() || "artifact";
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return { name, mimeType: ARTIFACT_EXTENSIONS[ext] ?? "text/plain", content };
};

/**
 * Best-effort: pull the files an OpenCode turn just built into memory so
 * the chat can offer them as real in-browser files. Never throws — a turn
 * answer is complete without its attachments.
 */
export const collectOpenCodeFiles = async (answerText: string): Promise<TurnFile[]> => {
  if (!effectiveOpenCodeBase() || !answerText) return [];
  const files: TurnFile[] = [];
  for (const path of extractArtifactPaths(answerText)) {
    try {
      const file = await readTurnFile(path);
      if (file) files.push(file);
    } catch {
      // One bad file must not sink the others.
    }
    if (files.length >= MAX_TURN_FILES) break;
  }
  return files;
};

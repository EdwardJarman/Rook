import type {
  InvokeParams,
  InvokeResult,
  ToolCall,
} from "../_core/llm";
import {
  normalizeMessages,
  normalizeToolChoice,
  readJson,
  responseFormatFor,
} from "./openai-compat";
import { isReasoningRejectedError } from "./agent-reliability";

export const OPENROUTER_API_BASE = "https://openrouter.ai/api/v1";
export const OPENROUTER_AUTO_MODEL = "openrouter/free";
const CATALOG_TTL_MS = 10 * 60 * 1000;
const STATUS_TTL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 90_000;
const FREE_AUDIO_TRANSCRIPTION_MODEL = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free";

export type RookAiModel = {
  id: string;
  name: string;
  provider: string;
  description: string;
  contextLength: number;
  supportsTools: boolean;
  supportsVision: boolean;
  automatic: boolean;
  free: boolean;
  usageLabel: string;
};

export type RookAiStatus = {
  provider: "openrouter";
  configured: boolean;
  operational: boolean;
  freeModels: number;
  dailyFreeRequestAllowance: 50 | 1000 | null;
  message: string;
};

type OpenRouterModel = {
  id: string;
  name?: string;
  description?: string;
  context_length?: number;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
  pricing?: {
    prompt?: string;
    completion?: string;
    request?: string;
  };
  supported_parameters?: string[];
};

type OpenRouterModelsResponse = { data?: OpenRouterModel[] };
type OpenRouterKeyResponse = { data?: { is_free_tier?: boolean } };
type OpenRouterErrorBody = {
  error?: {
    code?: number;
    message?: string;
    metadata?: Record<string, unknown>;
  };
};

type CacheValue<T> = { value: T; expiresAt: number };
let catalogCache: CacheValue<RookAiModel[]> | undefined;
let statusCache: CacheValue<RookAiStatus> | undefined;

const apiKey = () => process.env.OPENROUTER_API_KEY?.trim() || "";
const appOrigin = () =>
  process.env.APP_ORIGIN?.trim().replace(/\/$/, "") ||
  "https://www.rook.lighting";

export const isOpenRouterConfigured = () => Boolean(apiKey());

const providerName = (model: OpenRouterModel) => {
  const prefix = model.id.split("/")[0] || "OpenRouter";
  return prefix
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const isZero = (value: string | undefined) => {
  if (value === undefined) return true;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric === 0;
};

export function normalizeFreeOpenRouterModels(
  models: OpenRouterModel[],
): RookAiModel[] {
  const normalized = models
    .filter((model) => {
      const outputs = model.architecture?.output_modalities ?? ["text"];
      return (
        Boolean(model.id) &&
        outputs.includes("text") &&
        isZero(model.pricing?.prompt) &&
        isZero(model.pricing?.completion) &&
        isZero(model.pricing?.request) &&
        model.supported_parameters?.includes("tools")
      );
    })
    .map((model) => ({
      id: model.id,
      name:
        model.id === OPENROUTER_AUTO_MODEL
          ? "Auto · Best available"
          : (model.name || model.id).replace(/\s*\(free\)\s*$/i, ""),
      provider:
        model.id === OPENROUTER_AUTO_MODEL
          ? "OpenRouter"
          : providerName(model),
      description:
        model.id === OPENROUTER_AUTO_MODEL
          ? "Automatically chooses an available free model that supports this request."
          : model.description?.trim() ||
            "A zero-cost OpenRouter model with tool support.",
      contextLength: Math.max(0, model.context_length || 0),
      supportsTools: true,
      supportsVision:
        model.architecture?.input_modalities?.includes("image") ?? false,
      automatic: model.id === OPENROUTER_AUTO_MODEL,
      free: true as const,
      usageLabel: "Free · Shared Rook allowance",
    }));

  return normalized.sort((left, right) => {
    if (left.automatic !== right.automatic) return left.automatic ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}

const headers = (includeJson = false) => ({
  ...(apiKey() ? { Authorization: `Bearer ${apiKey()}` } : {}),
  "HTTP-Referer": appOrigin(),
  "X-OpenRouter-Title": "Rook",
  ...(includeJson ? { "Content-Type": "application/json" } : {}),
});

const errorMessage = (status: number, body: OpenRouterErrorBody) => {
  const upstream = body.error?.message?.trim();
  if (status === 401) return "Rook's OpenRouter connection needs attention.";
  if (status === 402)
    return "The OpenRouter account cannot accept requests right now.";
  if (status === 429)
    return "Free AI capacity is temporarily full. Please try again later.";
  if (status === 503)
    return "No compatible free model is available right now. Please try again shortly.";
  return upstream || `OpenRouter request failed (${status}).`;
};

export async function listOpenRouterModels(options?: {
  force?: boolean;
}): Promise<RookAiModel[]> {
  if (!options?.force && catalogCache?.expiresAt && catalogCache.expiresAt > Date.now()) {
    return catalogCache.value;
  }

  const response = await fetch(`${OPENROUTER_API_BASE}/models?limit=1000`, {
    headers: headers(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const body = await readJson<OpenRouterErrorBody>(response);
    throw new Error(errorMessage(response.status, body));
  }

  const body = await readJson<OpenRouterModelsResponse>(response);
  const models = normalizeFreeOpenRouterModels(body.data ?? []);
  if (!models.some((model) => model.id === OPENROUTER_AUTO_MODEL)) {
    models.unshift({
      id: OPENROUTER_AUTO_MODEL,
      name: "Auto · Best available",
      provider: "OpenRouter",
      description:
        "Automatically chooses an available free model that supports this request.",
      contextLength: 200_000,
      supportsTools: true,
      supportsVision: true,
      automatic: true,
      free: true,
      usageLabel: "Free · Shared Rook allowance",
    });
  }
  catalogCache = { value: models, expiresAt: Date.now() + CATALOG_TTL_MS };
  return models;
}

export async function openRouterStatus(options?: {
  force?: boolean;
}): Promise<RookAiStatus> {
  if (!options?.force && statusCache?.expiresAt && statusCache.expiresAt > Date.now()) {
    return statusCache.value;
  }

  if (!isOpenRouterConfigured()) {
    const models = await listOpenRouterModels().catch(() => []);
    const status: RookAiStatus = {
      provider: "openrouter",
      configured: false,
      operational: false,
      freeModels: models.length,
      dailyFreeRequestAllowance: null,
      message: "OpenRouter setup is required before Bots can respond.",
    };
    statusCache = { value: status, expiresAt: Date.now() + STATUS_TTL_MS };
    return status;
  }

  const [models, keyResponse] = await Promise.all([
    listOpenRouterModels(),
    fetch(`${OPENROUTER_API_BASE}/key`, {
      headers: headers(),
      signal: AbortSignal.timeout(15_000),
    }),
  ]);
  const keyBody = await readJson<OpenRouterKeyResponse & OpenRouterErrorBody>(
    keyResponse,
  );
  const operational = keyResponse.ok;
  const allowance = operational
    ? keyBody.data?.is_free_tier === false
      ? 1000
      : 50
    : null;
  const status: RookAiStatus = {
    provider: "openrouter",
    configured: true,
    operational,
    freeModels: models.length,
    dailyFreeRequestAllowance: allowance,
    message: operational
      ? `${models.length} free tool-capable models are available.`
      : errorMessage(keyResponse.status, keyBody),
  };
  statusCache = { value: status, expiresAt: Date.now() + STATUS_TTL_MS };
  return status;
}

export type ResolvedModel = {
  requested: string | undefined;
  resolved: string;
  fellBack: boolean;
  reason?: string;
};

const resolveModel = async (
  requestedModel: string | undefined,
  needsTools: boolean,
): Promise<ResolvedModel> => {
  const catalog = await listOpenRouterModels();
  const requested = catalog.find((model) => model.id === requestedModel);
  if (requested && (!needsTools || requested.supportsTools))
    return { requested: requestedModel, resolved: requested.id, fellBack: false };
  if (requestedModel === OPENROUTER_AUTO_MODEL || requestedModel === undefined) {
    return {
      requested: requestedModel,
      resolved: pickAutoModel(catalog, needsTools),
      fellBack: false,
    };
  }
  // Unknown / paid / tool-incapable IDs never error the chat: fall back to
  // the curated auto route — but report it honestly (see `fellBack`).
  return {
    requested: requestedModel,
    resolved: pickAutoModel(catalog, needsTools),
    fellBack: true,
    reason: `“${requestedModel}” is not in Rook's free tool-capable catalog; used Auto instead.`,
  };
};

export const resolveOpenRouterModelForTests = resolveModel;

/** Production alias (same resolver; the `ForTests` name is historical). */
export const resolveOpenRouterModel = resolveModel;

export const openRouterHeaders = (includeJson = false) => headers(includeJson);

/**
 * Quality ranking for the auto route, grounded in LIVE measurements
 * (2026-09-12 probe of the actual free catalog: cohere/north returned
 * coherent text + correct tool calls; laguna called tools but flaked;
 * gemma/nemotron-ultra 429d/timed out; dots-studio returned EMPTY).
 * The free catalog rotates monthly, so legacy strong families stay as
 * fallback patterns below the measured ones — and anything matching
 * WEAK_MODEL_PATTERN sinks to the bottom without being banned.
 */
const AUTO_MODEL_PREFERENCES: RegExp[] = [
  /cohere\//i,
  /poolside\/laguna/i,
  /nvidia\/nemotron-3-(nano|super|ultra)/i,
  /google\/gemma-4/i,
  /thinkingmachines\/inkling/i,
  /nex-agi\/nex/i,
  /inclusionai\/ling/i,
  /liquid\/lfm/i,
  /gpt-oss/i,
  /deepseek\/deepseek-v4/i,
  /deepseek\/deepseek-(?:chat|v3|seek|r1)/i,
  /qwen.*qwen3\.8/i,
  /qwen\d?\/qwen3?(?:\.|-max|-main|-coder|-instruct)/i,
  /meta-llama\/llama-4/i,
  /meta-llama\/llama-3\.3-70b/i,
  /meta-llama\/llama-3\.1-405b/i,
  /google\/gemini-3/i,
  /google\/gemini-2\.[05]/i,
  /mistralai\/(?:mistral-small-3|mistral-medium|mistral-nemo)/i,
  /nvidia\/(?:nemotron|llama-3\.)/i,
  /hy3/i,
  /microsoft\/(?:phi|wizardlm)/i,
];

/** Families observed leaking classifier scaffolding — deprioritize, never ban. */
const SCAFFOLD_PRONE_MODEL_PATTERN =
  /guard|moderation|safety|shield|filter|classifier|detox|llamaguard/i;

/** Families observed returning empty content — sink to the very bottom. */
const WEAK_MODEL_PATTERN =
  /dots-studio|note-preview|experimental|:\s*preview/i;

export function pickAutoModel(
  catalog: RookAiModel[],
  needsTools: boolean,
  excludeId?: string,
): string {
  const eligible = catalog.filter(
    (model) =>
      model.automatic !== true &&
      model.id !== OPENROUTER_AUTO_MODEL &&
      model.id !== excludeId &&
      (!needsTools || model.supportsTools),
  );
  const ranked = [...eligible].sort((a, b) => {
    const score = (id: string) =>
      (SCAFFOLD_PRONE_MODEL_PATTERN.test(id) ? 1 : 0) +
      (WEAK_MODEL_PATTERN.test(id) ? 2 : 0);
    return score(a.id) - score(b.id);
  });
  for (const pattern of AUTO_MODEL_PREFERENCES) {
    const match = ranked.find((model) => pattern.test(model.id));
    if (match) return match.id;
  }
  return ranked[0]?.id ?? OPENROUTER_AUTO_MODEL;
}

export async function invokeOpenRouter(
  params: InvokeParams,
): Promise<InvokeResult> {
  if (!isOpenRouterConfigured())
    throw new Error("OpenRouter is not configured for this Rook deployment.");

  const { resolved: model, fellBack: modelFellBack } = await resolveModel(
    params.model,
    Boolean(params.tools?.length),
  );
  const fallbacks = model === OPENROUTER_AUTO_MODEL
    ? [OPENROUTER_AUTO_MODEL]
    : [model, OPENROUTER_AUTO_MODEL];
  const payload: Record<string, unknown> = {
    models: fallbacks,
    messages: normalizeMessages(params.messages),
    max_tokens: params.max_tokens ?? params.maxTokens ?? 1200,
  };
  if (params.tools?.length) payload.tools = params.tools;
  const toolChoice = normalizeToolChoice(
    params.toolChoice ?? params.tool_choice,
    params.tools,
  );
  if (toolChoice) payload.tool_choice = toolChoice;
  const responseFormat = responseFormatFor(params);
  if (responseFormat) payload.response_format = responseFormat;
  if (params.reasoning) payload.reasoning = params.reasoning;
  if (params.thinking) payload.thinking = params.thinking;

  let response: Response | undefined;
  let lastNetworkError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      response = await fetch(`${OPENROUTER_API_BASE}/chat/completions`, {
        method: "POST",
        headers: headers(true),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      lastNetworkError = undefined;
    } catch (error) {
      // AbortSignal.timeout throws + transient network blips: retry with
      // jittered backoff instead of failing the whole chat turn (v1 threw).
      lastNetworkError = error;
      response = undefined;
      const backoff = Math.min(500 * 2 ** attempt, 4000);
      await new Promise((resolve) =>
        setTimeout(resolve, backoff / 2 + Math.random() * (backoff / 2)),
      );
      continue;
    }
    if (response.ok || ![429, 500, 502, 503, 504].includes(response.status) || attempt === 2)
      break;
    const rawRetryAfter = Number(response.headers.get("retry-after") || "0");
    const retryAfter = Math.min(Math.max(Number.isFinite(rawRetryAfter) ? rawRetryAfter : 0, 0) * 1000, 8000);
    await response.body?.cancel().catch(() => undefined);
    const backoff = Math.min(500 * 2 ** attempt, 4000);
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(backoff / 2 + Math.random() * (backoff / 2), Math.min(retryAfter, 8000))),
    );
  }

  if (!response) {
    throw new Error(
      lastNetworkError instanceof Error && /timed out|timeout|abort/i.test(lastNetworkError.message)
        ? "The AI request timed out before finishing. Please try again."
        : "The AI network request failed before reaching OpenRouter. Please try again.",
    );
  }

  if (!response?.ok) {
    const body = response
      ? await readJson<OpenRouterErrorBody>(response)
      : {};
    const failure = new Error(errorMessage(response?.status ?? 503, body));
    // Some free models reject the reasoning/thinking params outright. One
    // retry without them beats failing a turn the model could have answered.
    if (
      (payload.reasoning !== undefined || payload.thinking !== undefined) &&
      isReasoningRejectedError(failure)
    ) {
      delete payload.reasoning;
      delete payload.thinking;
      const retry = await fetch(`${OPENROUTER_API_BASE}/chat/completions`, {
        method: "POST",
        headers: headers(true),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }).catch(() => undefined);
      if (retry?.ok) {
        response = retry;
      } else {
        if (retry) {
          const retryBody = await readJson<OpenRouterErrorBody>(retry);
          throw new Error(errorMessage(retry.status, retryBody));
        }
        throw failure;
      }
    } else {
      throw failure;
    }
  }

  const result = (await response.json()) as InvokeResult & {
    choices?: Array<{
      message?: { tool_calls?: ToolCall[] };
    }>;
  };
  if (!result.choices?.length)
    throw new Error("The selected free model did not return a response.");
  const firstMessage = result.choices[0]?.message;
  const firstContent =
    typeof (firstMessage as { content?: unknown })?.content === "string"
      ? ((firstMessage as { content?: string }).content ?? "").trim()
      : "";
  const firstCalls = (firstMessage as { tool_calls?: ToolCall[] } | undefined)?.tool_calls ?? [];
  if (!firstContent && !firstCalls.length) {
    // Empty shell response (observed live: weak free models answer `length`
    // with no content). For auto-routed requests (explicit auto, or an
    // unknown id already substituted once), one retry on a different model
    // beats handing the user nothing. Explicitly-picked models throw
    // instead — and the recursion always terminates because the retry
    // carries a concrete model id.
    const requestedAuto =
      params.model === undefined ||
      params.model === OPENROUTER_AUTO_MODEL ||
      modelFellBack;
    if (requestedAuto) {
      const catalog = await listOpenRouterModels().catch(() => []);
      const alternate = pickAutoModel(catalog, Boolean(params.tools?.length), model);
      if (alternate && alternate !== model) {
        console.warn("[OpenRouter] empty response, retrying on alternate model", {
          from: model,
          to: alternate,
        });
        return invokeOpenRouter({ ...params, model: alternate });
      }
    }
    throw new Error("The selected free model returned an empty response.");
  }
  return result as InvokeResult;
}

export async function transcribeOpenRouterAudio(input: {
  data: string;
  format: "wav" | "mp3" | "aac" | "ogg" | "flac" | "m4a" | "webm";
}): Promise<string> {
  if (!isOpenRouterConfigured())
    throw new Error("Voice input is unavailable because OpenRouter is not configured.");

  const response = await fetch(`${OPENROUTER_API_BASE}/chat/completions`, {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify({
      model: FREE_AUDIO_TRANSCRIPTION_MODEL,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "Transcribe this voice message exactly. Return only the spoken words, with natural punctuation. Do not add commentary." },
          { type: "input_audio", input_audio: { data: input.data, format: input.format } },
        ],
      }],
      max_tokens: 900,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await readJson<OpenRouterErrorBody & {
    choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
  }>(response);
  if (!response.ok) throw new Error(errorMessage(response.status, body));
  const content = body.choices?.[0]?.message?.content;
  const text = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((part) => part.text || "").join(" ")
      : "";
  const clean = text.trim();
  if (!clean) throw new Error("Rook could not hear any speech in that recording.");
  return clean;
}

export const __resetOpenRouterCachesForTests = () => {
  catalogCache = undefined;
  statusCache = undefined;
};

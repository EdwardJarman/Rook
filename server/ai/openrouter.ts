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

const OPENROUTER_API_BASE = "https://openrouter.ai/api/v1";
export const OPENROUTER_AUTO_MODEL = "openrouter/free";
const CATALOG_TTL_MS = 10 * 60 * 1000;
const STATUS_TTL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 45_000;
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

const selectedModel = async (
  requestedModel: string | undefined,
  needsTools: boolean,
) => {
  const catalog = await listOpenRouterModels();
  const requested = catalog.find((model) => model.id === requestedModel);
  if (requested && (!needsTools || requested.supportsTools)) return requested.id;
  return OPENROUTER_AUTO_MODEL;
};

export async function invokeOpenRouter(
  params: InvokeParams,
): Promise<InvokeResult> {
  if (!isOpenRouterConfigured())
    throw new Error("OpenRouter is not configured for this Rook deployment.");

  const model = await selectedModel(params.model, Boolean(params.tools?.length));
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
  for (let attempt = 0; attempt < 2; attempt += 1) {
    response = await fetch(`${OPENROUTER_API_BASE}/chat/completions`, {
      method: "POST",
      headers: headers(true),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.ok || ![429, 500, 502, 503, 504].includes(response.status) || attempt === 1)
      break;
    const retryAfter = Math.min(
      Math.max(Number(response.headers.get("retry-after") || "0"), 0) * 1000,
      2_000,
    );
    await response.body?.cancel().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, Math.max(400, retryAfter)));
  }

  if (!response?.ok) {
    const body = response
      ? await readJson<OpenRouterErrorBody>(response)
      : {};
    throw new Error(errorMessage(response?.status ?? 503, body));
  }

  const result = (await response.json()) as InvokeResult & {
    choices?: Array<{
      message?: { tool_calls?: ToolCall[] };
    }>;
  };
  if (!result.choices?.length)
    throw new Error("The selected free model did not return a response.");
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

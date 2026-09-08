import type {
  InvokeParams,
  InvokeResult,
  Message,
  MessageContent,
  ResponseFormat,
  Tool,
  ToolChoice,
} from "../_core/llm";
import type { RookAiModel } from "./openrouter";

const REQUEST_TIMEOUT_MS = 45_000;
const ORCAROUTER_API_BASE = "https://api.orcarouter.ai/v1";
const TOKENROUTER_API_BASE = "https://api.tokenrouter.com/v1";

export const ORCAROUTER_MODEL_PREFIX = "orcarouter:";
export const TOKENROUTER_MODEL_PREFIX = "tokenrouter:";

const ORCAROUTER_MODELS = [
  {
    upstreamId: "deepseek/deepseek-v4-flash-free",
    name: "DeepSeek V4 Flash",
    provider: "DeepSeek",
    description: "Fast free DeepSeek V4 model served directly through OrcaRouter.",
    contextLength: 1_048_576,
  },
  {
    upstreamId: "qwen/qwen3.8-27b-free",
    name: "Qwen 3.8 27B",
    provider: "Qwen",
    description: "Free 27B Qwen 3.8 model served directly through OrcaRouter.",
    contextLength: 65_536,
  },
  {
    upstreamId: "deepseek/deepseek-v4-pro-free",
    name: "DeepSeek V4 Pro",
    provider: "DeepSeek",
    description: "Free flagship DeepSeek V4 model served directly through OrcaRouter.",
    contextLength: 1_048_576,
  },
  {
    upstreamId: "tencent/hy3-free",
    name: "Tencent Hy3",
    provider: "Tencent",
    description: "Free Tencent Hy3 model served directly through OrcaRouter.",
    contextLength: 0,
  },
] as const;

const TOKENROUTER_MODELS = [
  {
    upstreamId: "deepseek/deepseek-v4-pro-0813-free",
    name: "DeepSeek V4 Pro 0813",
    provider: "DeepSeek",
    description: "Free DeepSeek V4 Pro 0813 model served directly through TokenRouter.",
    contextLength: 1_048_576,
  },
  {
    upstreamId: "qwen/qwen3.8-max-free",
    name: "Qwen 3.8 Max",
    provider: "Qwen",
    description: "Free Qwen 3.8 Max model served directly through TokenRouter.",
    contextLength: 0,
  },
  {
    upstreamId: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
    name: "Nemotron 3 Nano Omni",
    provider: "NVIDIA",
    description: "Free multimodal Nemotron reasoning model served directly through TokenRouter.",
    contextLength: 256_000,
  },
] as const;

type FixedModel = (typeof ORCAROUTER_MODELS)[number] | (typeof TOKENROUTER_MODELS)[number];
type GatewayName = "OrcaRouter" | "TokenRouter";
type GatewayConfig = {
  name: GatewayName;
  apiBase: string;
  apiKey: () => string;
  prefix: string;
  models: readonly FixedModel[];
};

type GatewayErrorBody = {
  error?: { message?: string; code?: string | number; type?: string };
  message?: string;
};

export type RouterGatewayStatus = {
  provider: "orcarouter" | "tokenrouter";
  configured: boolean;
  operational: boolean;
  freeModels: number;
  dailyFreeRequestAllowance: null;
  message: string;
};

const orcaConfig: GatewayConfig = {
  name: "OrcaRouter",
  apiBase: ORCAROUTER_API_BASE,
  apiKey: () => process.env.ORCAROUTER_API_KEY?.trim() || "",
  prefix: ORCAROUTER_MODEL_PREFIX,
  models: ORCAROUTER_MODELS,
};

const tokenConfig: GatewayConfig = {
  name: "TokenRouter",
  apiBase: TOKENROUTER_API_BASE,
  apiKey: () => process.env.TOKENROUTER_API_KEY?.trim() || "",
  prefix: TOKENROUTER_MODEL_PREFIX,
  models: TOKENROUTER_MODELS,
};

const internalId = (config: GatewayConfig, upstreamId: string) =>
  `${config.prefix}${upstreamId}`;

const listModels = (config: GatewayConfig): RookAiModel[] =>
  config.apiKey()
    ? config.models.map((model) => ({
        id: internalId(config, model.upstreamId),
        name: model.name,
        provider: model.provider,
        description: model.description,
        contextLength: model.contextLength,
        supportsTools: true,
        supportsVision: model.upstreamId.includes("omni"),
        automatic: false,
        free: true,
        usageLabel: `Free · ${config.name}`,
      }))
    : [];

export const listOrcaRouterModels = () => listModels(orcaConfig);
export const listTokenRouterModels = () => listModels(tokenConfig);
export const isOrcaRouterConfigured = () => Boolean(orcaConfig.apiKey());
export const isTokenRouterConfigured = () => Boolean(tokenConfig.apiKey());

const matchesConfig = (modelId: string | undefined, config: GatewayConfig) => {
  if (!modelId?.startsWith(config.prefix)) return false;
  const raw = modelId.slice(config.prefix.length);
  return config.models.some((model) => model.upstreamId === raw);
};

export const isOrcaRouterModel = (modelId?: string) =>
  matchesConfig(modelId, orcaConfig);
export const isTokenRouterModel = (modelId?: string) =>
  matchesConfig(modelId, tokenConfig);

const upstreamModel = (modelId: string | undefined, config: GatewayConfig) => {
  if (!modelId) throw new Error(`Choose a ${config.name} model first.`);
  if (!modelId.startsWith(config.prefix))
    throw new Error(`That model does not belong to ${config.name}.`);
  const raw = modelId.slice(config.prefix.length);
  if (!config.models.some((model) => model.upstreamId === raw)) {
    throw new Error(`That model is not available through Rook's ${config.name} connection.`);
  }
  return raw;
};

const normalizeContent = (content: MessageContent | MessageContent[]) => {
  const parts = Array.isArray(content) ? content : [content];
  if (parts.length === 1 && typeof parts[0] === "string") return parts[0];
  return parts.map((part) =>
    typeof part === "string" ? { type: "text", text: part } : part,
  );
};

const normalizeMessages = (messages: Message[]) =>
  messages.map((message) => ({
    role: message.role,
    content:
      message.role === "tool" || message.role === "function"
        ? Array.isArray(message.content)
          ? message.content
              .map((part) =>
                typeof part === "string" ? part : JSON.stringify(part),
              )
              .join("\n")
          : typeof message.content === "string"
            ? message.content
            : JSON.stringify(message.content)
        : normalizeContent(message.content),
    ...(message.name ? { name: message.name } : {}),
    ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
    ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}),
  }));

const normalizeToolChoice = (
  choice: ToolChoice | undefined,
  tools: Tool[] | undefined,
) => {
  if (!choice || choice === "none" || choice === "auto") return choice;
  if (choice === "required") {
    if (!tools?.length) throw new Error("A required tool was not provided.");
    if (tools.length > 1) return "required";
    return { type: "function", function: { name: tools[0].function.name } };
  }
  if ("name" in choice)
    return { type: "function", function: { name: choice.name } };
  return choice;
};

const responseFormatFor = (params: InvokeParams): ResponseFormat | undefined => {
  const explicit = params.responseFormat ?? params.response_format;
  if (explicit) return explicit;
  const schema = params.outputSchema ?? params.output_schema;
  return schema
    ? { type: "json_schema", json_schema: schema }
    : undefined;
};

const readJson = async <T>(response: Response): Promise<T> => {
  try {
    return (await response.json()) as T;
  } catch {
    return {} as T;
  }
};

const errorMessage = (
  gateway: GatewayName,
  status: number,
  body: GatewayErrorBody,
) => {
  const upstream = body.error?.message?.trim() || body.message?.trim();
  if (status === 401 || status === 403)
    return `Rook's ${gateway} connection needs attention.`;
  if (status === 429)
    return `${gateway}'s free capacity is temporarily full. Please try again later.`;
  if ([500, 502, 503, 504].includes(status))
    return `${gateway} is temporarily unavailable. Please try again shortly.`;
  return upstream || `${gateway} request failed (${status}).`;
};

const gatewayStatus = async (
  config: GatewayConfig,
): Promise<RouterGatewayStatus> => {
  const provider = config.name === "OrcaRouter" ? "orcarouter" : "tokenrouter";
  if (!config.apiKey()) {
    return {
      provider,
      configured: false,
      operational: false,
      freeModels: config.models.length,
      dailyFreeRequestAllowance: null,
      message: `${config.name} setup is required before Bots can respond.`,
    };
  }
  const response = await fetch(`${config.apiBase}/models`, {
    headers: { Authorization: `Bearer ${config.apiKey()}` },
    signal: AbortSignal.timeout(15_000),
  });
  return {
    provider,
    configured: true,
    operational: response.ok,
    freeModels: config.models.length,
    dailyFreeRequestAllowance: null,
    message: response.ok
      ? `${config.models.length} selected free models are available.`
      : errorMessage(
          config.name,
          response.status,
          await readJson<GatewayErrorBody>(response),
        ),
  };
};

export const orcaRouterStatus = () => gatewayStatus(orcaConfig);
export const tokenRouterStatus = () => gatewayStatus(tokenConfig);

async function invokeGateway(
  config: GatewayConfig,
  params: InvokeParams,
): Promise<InvokeResult> {
  const key = config.apiKey();
  if (!key)
    throw new Error(`${config.name} is not configured for this Rook deployment.`);

  const upstream = upstreamModel(params.model, config);
  const payload: Record<string, unknown> = {
    model: upstream,
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
    response = await fetch(`${config.apiBase}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (
      response.ok ||
      ![429, 500, 502, 503, 504].includes(response.status) ||
      attempt === 1
    )
      break;
    const retryAfter = Math.min(
      Math.max(Number(response.headers.get("retry-after") || "0"), 0) * 1000,
      2_000,
    );
    await response.body?.cancel().catch(() => undefined);
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(400, retryAfter)),
    );
  }

  if (!response?.ok) {
    const body = response
      ? await readJson<GatewayErrorBody>(response)
      : {};
    throw new Error(errorMessage(config.name, response?.status ?? 503, body));
  }

  const result = await readJson<InvokeResult>(response);
  if (!result.choices?.length)
    throw new Error(`${config.name} did not return a response.`);

  return {
    ...result,
    model: internalId(config, upstream),
  };
}

export const invokeOrcaRouter = (params: InvokeParams) =>
  invokeGateway(orcaConfig, params);
export const invokeTokenRouter = (params: InvokeParams) =>
  invokeGateway(tokenConfig, params);

export const __routerGatewayModelIdsForTests = {
  orcarouter: ORCAROUTER_MODELS.map((model) => model.upstreamId),
  tokenrouter: TOKENROUTER_MODELS.map((model) => model.upstreamId),
};

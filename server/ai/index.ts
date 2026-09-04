import type { InvokeParams, InvokeResult } from "../_core/llm";
import type { Request } from "express";
import {
  invokeOpenRouter,
  listOpenRouterModels,
  openRouterStatus,
  type RookAiModel,
  type RookAiStatus,
} from "./openrouter";
import { invokeChatGPT, isChatGPTModel, listChatGPTModels } from "./chatgpt";
import {
  invokeOrcaRouter,
  invokeTokenRouter,
  isOrcaRouterModel,
  isTokenRouterModel,
  listOrcaRouterModels,
  listTokenRouterModels,
  orcaRouterStatus,
  ORCAROUTER_MODEL_PREFIX,
  tokenRouterStatus,
  TOKENROUTER_MODEL_PREFIX,
  type RouterGatewayStatus,
} from "./router-gateways";

export type AiModel = RookAiModel;
export type AiBackendStatus = RookAiStatus | RouterGatewayStatus;

export const listAiModels = async (request?: Request) => {
  const [openRouter, chatGPT] = await Promise.all([
    listOpenRouterModels().catch(() => []),
    request ? listChatGPTModels(request).catch(() => []) : Promise.resolve([]),
  ]);
  return [
    ...chatGPT,
    ...openRouter,
    ...listOrcaRouterModels(),
    ...listTokenRouterModels(),
  ];
};
export const getAiBackendStatus = async (
  provider: "openrouter" | "orcarouter" | "tokenrouter" = "openrouter",
): Promise<AiBackendStatus> => {
  if (provider === "orcarouter") return await orcaRouterStatus();
  if (provider === "tokenrouter") return await tokenRouterStatus();
  return await openRouterStatus();
};
export const invokeAi = (params: InvokeParams, request?: Request): Promise<InvokeResult> => {
  if (params.model?.startsWith(ORCAROUTER_MODEL_PREFIX)) {
    if (!isOrcaRouterModel(params.model))
      throw new Error("That OrcaRouter model is not available in Rook.");
    return invokeOrcaRouter(params);
  }
  if (params.model?.startsWith(TOKENROUTER_MODEL_PREFIX)) {
    if (!isTokenRouterModel(params.model))
      throw new Error("That TokenRouter model is not available in Rook.");
    return invokeTokenRouter(params);
  }
  if (isChatGPTModel(params.model)) {
    if (!request) throw new Error("ChatGPT needs an authenticated Rook request.");
    return invokeChatGPT(params, request).catch((error) => {
      console.warn("[AI] ChatGPT unavailable; using OpenRouter fallback", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      return invokeOpenRouter({ ...params, model: "openrouter/free" });
    });
  }
  return invokeOpenRouter(params);
};

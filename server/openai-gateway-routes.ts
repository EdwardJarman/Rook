/**
 * OpenAI-compat gateway routes: `GET /api/openai/v1/models` and
 * `POST /api/openai/v1/chat/completions` (+SSE) over Rook's dispatch.
 *
 * Auth reuses `authenticateClerkRequest`, so Clerk sessions AND `rook_`
 * CLI tokens both work (external agents sign in with a token — no browser).
 * Follows the `registerXRoutes(app, deps?)` precedent: handlers are pure
 * against injected deps and tested via a fake app object (no network/db).
 */

import type { Express, Request, Response } from "express";

import type { InvokeParams } from "./_core/llm";
import { invokeAiResilient, type ResilientInvokeResult } from "./ai/fallback-router";
import { listAiModels } from "./ai";
import { authenticateClerkRequest } from "./clerk-auth";
import {
  filterGatewayModels,
  gatewayRequestError,
  GATEWAY_BASE_PATH,
  isGatewayEnabled,
  toChatCompletion,
  toGatewayError,
  toInvokeParams,
  toModelList,
  toSseChunks,
} from "./ai/openai-gateway";

export type GatewayDeps = {
  auth?: (req: Request) => Promise<{ id: string } | null>;
  listModels?: (req?: Request) => Promise<Array<{ id: string }>>;
  invoke?: (params: InvokeParams, req?: Request) => Promise<ResilientInvokeResult>;
  gatewayOn?: () => boolean;
};

const defaultDeps = (): Required<GatewayDeps> => ({
  auth: (req) => authenticateClerkRequest(req),
  listModels: (req) => listAiModels(req),
  invoke: (params, req) => invokeAiResilient(params, req),
  gatewayOn: () => isGatewayEnabled(),
});

const disabled = (res: Response): void => {
  const mapped = gatewayRequestError(404, "The OpenAI gateway is disabled on this server.");
  res.status(mapped.status).json(mapped.body);
};

const unauthorized = (res: Response): void => {
  const mapped = gatewayRequestError(
    401,
    "A valid Rook token is required. Sign in with `rook login`, then send it as `Authorization: Bearer rook_…`.",
    "invalid_request_error",
    "invalid_api_key",
  );
  res.status(mapped.status).json(mapped.body);
};

export function registerOpenAiGatewayRoutes(app: Express, deps?: GatewayDeps): void {
  const { auth, listModels, invoke, gatewayOn } = { ...defaultDeps(), ...deps };
  const base = GATEWAY_BASE_PATH;

  app.get(`${base}/models`, async (req: Request, res: Response) => {
    if (!gatewayOn()) {
      disabled(res);
      return;
    }
    const user = await auth(req);
    if (!user) {
      unauthorized(res);
      return;
    }
    try {
      const models = await listModels(req);
      res.json(toModelList(filterGatewayModels(models)));
    } catch (error) {
      const mapped = toGatewayError(error);
      res.status(mapped.status).json(mapped.body);
    }
  });

  app.post(`${base}/chat/completions`, async (req: Request, res: Response) => {
    if (!gatewayOn()) {
      disabled(res);
      return;
    }
    const user = await auth(req);
    if (!user) {
      unauthorized(res);
      return;
    }
    const mapped = toInvokeParams(req.body);
    if (mapped.error || !mapped.params) {
      const failed = gatewayRequestError(mapped.error?.status ?? 400, mapped.error?.message ?? "Bad request.");
      res.status(failed.status).json(failed.body);
      return;
    }
    const model = typeof (req.body as { model?: unknown }).model === "string"
      ? (req.body as { model: string }).model
      : "unknown";
    const stream = (req.body as { stream?: unknown }).stream === true;
    if (!stream) {
      try {
        const { result } = await invoke(mapped.params, req);
        res.json(toChatCompletion(result, model));
      } catch (error) {
        const failed = toGatewayError(error);
        res.status(failed.status).json(failed.body);
      }
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    try {
      const { result } = await invoke(mapped.params, req);
      for (const chunk of toSseChunks(result, model)) {
        res.write(`${chunk}\n\n`);
      }
      res.write("data: [DONE]\n\n");
      res.end();
    } catch (error) {
      const failed = toGatewayError(error);
      res.write(`data: ${JSON.stringify(failed.body)}\n\n`);
      res.end();
    }
  });
}

/** Re-exported for tests that assert the mount surface. */
export { GATEWAY_BASE_PATH };

import { describe, expect, it, vi } from "vitest";
import type { Express, Request, Response } from "express";

import type { InvokeResult } from "./_core/llm";
import {
  GATEWAY_BASE_PATH,
  registerOpenAiGatewayRoutes,
} from "./openai-gateway-routes";

type Handler = (req: Request, res: Response) => Promise<void> | void;

const fakeApp = () => {
  const handlers = new Map<string, Handler>();
  const app = {
    get: vi.fn((path: string, handler: Handler) => {
      handlers.set(`GET ${path}`, handler);
    }),
    post: vi.fn((path: string, handler: Handler) => {
      handlers.set(`POST ${path}`, handler);
    }),
  } as unknown as Express;
  return { app, handlers };
};

const fakeRes = () => {
  const chunks: string[] = [];
  let statusCode = 200;
  let payload: unknown;
  let ended = false;
  const res = {
    status: vi.fn((code: number) => {
      statusCode = code;
      return res;
    }),
    json: vi.fn((body: unknown) => {
      payload = body;
      return res;
    }),
    writeHead: vi.fn(() => res),
    write: vi.fn((chunk: string) => {
      chunks.push(chunk);
      return true;
    }),
    end: vi.fn(() => {
      ended = true;
      return res;
    }),
  } as unknown as Response & {
    __status: () => number;
    __payload: () => unknown;
    __chunks: () => string[];
    __ended: () => boolean;
  };
  return Object.assign(res, {
    __status: () => statusCode,
    __payload: () => payload,
    __chunks: () => chunks,
    __ended: () => ended,
  });
};

const result = (): InvokeResult => ({
  id: "gen-9",
  created: 1700000001,
  model: "openrouter/free",
  choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
});

const authed = { auth: async () => ({ id: "cli:abc" }) };

describe("gateway routes", () => {
  it("mounts models + completions under /api/openai/v1", () => {
    const { app, handlers } = fakeApp();
    registerOpenAiGatewayRoutes(app, { ...authed, invoke: async () => { throw new Error("unused"); } });
    expect(app.get).toHaveBeenCalledTimes(1);
    expect(app.post).toHaveBeenCalledTimes(1);
    expect(handlers.has(`GET ${GATEWAY_BASE_PATH}/models`)).toBe(true);
    expect(handlers.has(`POST ${GATEWAY_BASE_PATH}/chat/completions`)).toBe(true);
    expect(GATEWAY_BASE_PATH).toBe("/api/openai/v1");
  });

  it("401s without a user, 404s when disabled", async () => {
    const { handlers } = fakeApp();
    const app = { get: vi.fn(), post: vi.fn() } as unknown as Express;
    registerOpenAiGatewayRoutes(app, { auth: async () => null });
    const models = (app.get as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as Handler;
    expect(handlers.size).toBe(0);
    const res = fakeRes();
    await models({ headers: {}, body: {} } as unknown as Request, res as unknown as Response);
    expect(res.__status()).toBe(401);
    expect(JSON.stringify(res.__payload())).toContain("invalid_api_key");

    const app2 = { get: vi.fn(), post: vi.fn() } as unknown as Express;
    registerOpenAiGatewayRoutes(app2, { ...authed, gatewayOn: () => false });
    const models2 = (app2.get as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as Handler;
    const res2 = fakeRes();
    await models2({ headers: {}, body: {} } as unknown as Request, res2 as unknown as Response);
    expect(res2.__status()).toBe(404);
  });

  it("lists gateway models filtered", async () => {
    const app = { get: vi.fn(), post: vi.fn() } as unknown as Express;
    registerOpenAiGatewayRoutes(app, {
      ...authed,
      listModels: async () => [{ id: "openrouter/free" }, { id: "chatgpt:gpt-5" }],
    });
    const models = (app.get as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as Handler;
    const res = fakeRes();
    await models({ headers: {}, body: {} } as unknown as Request, res as unknown as Response);
    expect(res.__status()).toBe(200);
    const payload = res.__payload() as { object: string; data: Array<{ id: string }> };
    expect(payload.object).toBe("list");
    expect(payload.data.map((entry) => entry.id)).toEqual(["openrouter/free"]);
  });

  it("completes JSON, 400s malformed, 404s unknown models", async () => {
    const app = { get: vi.fn(), post: vi.fn() } as unknown as Express;
    const seen: Array<{ model?: string }> = [];
    registerOpenAiGatewayRoutes(app, {
      ...authed,
      invoke: async (params) => {
        seen.push({ model: params.model });
        if (params.model === "nope:nope") throw new Error("That model is not available in Rook.");
        return { result: result(), attemptedProviders: ["openrouter"], fellBack: false };
      },
    });
    const completions = (app.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as Handler;

    const ok = fakeRes();
    await completions(
      { headers: {}, body: { model: "openrouter/free", messages: [{ role: "user", content: "hi" }] } } as unknown as Request,
      ok as unknown as Response,
    );
    expect(ok.__status()).toBe(200);
    const body = ok.__payload() as { object: string; model: string };
    expect(body.object).toBe("chat.completion");
    expect(body.model).toBe("openrouter/free");
    expect(seen).toEqual([{ model: "openrouter/free" }]);

    const bad = fakeRes();
    await completions({ headers: {}, body: { messages: [] } } as unknown as Request, bad as unknown as Response);
    expect(bad.__status()).toBe(400);

    const missing = fakeRes();
    await completions(
      {
        headers: {},
        body: { model: "nope:nope", messages: [{ role: "user", content: "hi" }] },
      } as unknown as Request,
      missing as unknown as Response,
    );
    expect(missing.__status()).toBe(404);
  });

  it("streams deltas plus [DONE], and SSE errors without throwing", async () => {
    const app = { get: vi.fn(), post: vi.fn() } as unknown as Express;
    let fail = false;
    registerOpenAiGatewayRoutes(app, {
      ...authed,
      invoke: async () => {
        if (fail) throw new Error("kaput");
        return { result: result(), attemptedProviders: ["openrouter"], fellBack: false };
      },
    });
    const completions = (app.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as Handler;
    const body = { model: "m", messages: [{ role: "user", content: "hi" }], stream: true };

    const res = fakeRes();
    await completions({ headers: {}, body } as unknown as Request, res as unknown as Response);
    const text = res.__chunks().join("");
    expect(text).toContain('"content":"hi"');
    expect(text.trimEnd().endsWith("data: [DONE]")).toBe(true);
    expect(res.__ended()).toBe(true);

    fail = true;
    const err = fakeRes();
    await completions({ headers: {}, body } as unknown as Request, err as unknown as Response);
    expect(err.__chunks().join("")).toContain("kaput");
    expect(err.__ended()).toBe(true);
  });
});

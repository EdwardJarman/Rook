import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { invokeAi, listAiModels } from "../server/ai";
import {
  __routerGatewayModelIdsForTests,
  isOrcaRouterModel,
  isTokenRouterModel,
  orcaRouterStatus,
  tokenRouterStatus,
} from "../server/ai/router-gateways";

const previousOrcaKey = process.env.ORCAROUTER_API_KEY;
const previousTokenKey = process.env.TOKENROUTER_API_KEY;

beforeEach(() => {
  process.env.ORCAROUTER_API_KEY = "test-orca-key";
  process.env.TOKENROUTER_API_KEY = "test-token-key";
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (previousOrcaKey === undefined) delete process.env.ORCAROUTER_API_KEY;
  else process.env.ORCAROUTER_API_KEY = previousOrcaKey;
  if (previousTokenKey === undefined) delete process.env.TOKENROUTER_API_KEY;
  else process.env.TOKENROUTER_API_KEY = previousTokenKey;
});

describe("router gateway catalogs", () => {
  it("contains exactly the requested allowlisted free models", () => {
    expect(__routerGatewayModelIdsForTests.orcarouter).toEqual([
      "deepseek/deepseek-v4-flash-free",
      "qwen/qwen3.8-27b-free",
      "deepseek/deepseek-v4-pro-free",
      "tencent/hy3-free",
    ]);
    expect(__routerGatewayModelIdsForTests.tokenrouter).toEqual([
      "deepseek/deepseek-v4-pro-0813-free",
      "qwen/qwen3.8-max-free",
      "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
    ]);
  });

  it("uses explicit internal prefixes so overlapping vendor IDs cannot cross routers", () => {
    expect(
      isOrcaRouterModel(
        "orcarouter:deepseek/deepseek-v4-flash-free",
      ),
    ).toBe(true);
    expect(isOrcaRouterModel("deepseek/deepseek-v4-flash-free")).toBe(false);
    expect(
      isTokenRouterModel("tokenrouter:qwen/qwen3.8-max-free"),
    ).toBe(true);
    expect(isTokenRouterModel("qwen/qwen3.8-max-free")).toBe(false);
  });

  it("publishes configured models with provider-prefixed IDs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: [] }), { status: 200 }),
      ),
    );
    const models = await listAiModels();
    expect(
      models.find((model) =>
        model.id.startsWith("orcarouter:deepseek/deepseek-v4-flash-free"),
      ),
    ).toBeTruthy();
    expect(
      models.find((model) =>
        model.id.startsWith("tokenrouter:qwen/qwen3.8-max-free"),
      ),
    ).toBeTruthy();
  });

  it("checks each provider's own authenticated models endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(orcaRouterStatus()).resolves.toMatchObject({
      provider: "orcarouter",
      configured: true,
      operational: true,
      freeModels: 4,
    });
    await expect(tokenRouterStatus()).resolves.toMatchObject({
      provider: "tokenrouter",
      configured: true,
      operational: true,
      freeModels: 3,
    });
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.orcarouter.ai/v1/models");
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.tokenrouter.com/v1/models");
  });
});

describe("router gateway dispatch", () => {
  it("fails closed for an unknown provider-prefixed model", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(() =>
      invokeAi({
        model: "orcarouter:unknown/model",
        messages: [{ role: "user", content: "Hello" }],
      }),
    ).toThrow("not available in Rook");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends OrcaRouter selections to OrcaRouter with the exact upstream ID", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "orca-1",
          model: "deepseek/deepseek-v4-flash-free",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "DeepSeek response" },
              finish_reason: "stop",
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await invokeAi({
      model: "orcarouter:deepseek/deepseek-v4-flash-free",
      messages: [{ role: "user", content: "Identify yourself" }],
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.orcarouter.ai/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-orca-key",
    );
    expect(JSON.parse(String(init.body)).model).toBe(
      "deepseek/deepseek-v4-flash-free",
    );
    expect(result.model).toBe(
      "orcarouter:deepseek/deepseek-v4-flash-free",
    );
  });

  it("sends TokenRouter selections to TokenRouter with the exact upstream ID", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "token-1",
          model: "qwen/qwen3.8-max-free",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Qwen response" },
              finish_reason: "stop",
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await invokeAi({
      model: "tokenrouter:qwen/qwen3.8-max-free",
      messages: [{ role: "user", content: "Identify yourself" }],
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.tokenrouter.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-token-key",
    );
    expect(JSON.parse(String(init.body)).model).toBe(
      "qwen/qwen3.8-max-free",
    );
    expect(result.model).toBe("tokenrouter:qwen/qwen3.8-max-free");
  });
});

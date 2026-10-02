import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetOpenRouterCachesForTests,
  invokeOpenRouter,
  normalizeFreeOpenRouterModels,
  openRouterStatus,
  transcribeOpenRouterAudio,
} from "../server/ai/openrouter";

const previousKey = process.env.OPENROUTER_API_KEY;
const previousOrigin = process.env.APP_ORIGIN;

const model = (
  id: string,
  options?: {
    prompt?: string;
    completion?: string;
    tools?: boolean;
    outputs?: string[];
  },
) => ({
  id,
  name: `${id} (free)`,
  description: "Test model",
  context_length: 128_000,
  pricing: {
    prompt: options?.prompt ?? "0",
    completion: options?.completion ?? "0",
  },
  architecture: {
    input_modalities: ["text"],
    output_modalities: options?.outputs ?? ["text"],
  },
  supported_parameters: options?.tools === false ? ["temperature"] : ["tools", "tool_choice"],
});

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  process.env.APP_ORIGIN = "https://www.rook.lighting";
  __resetOpenRouterCachesForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = previousKey;
  if (previousOrigin === undefined) delete process.env.APP_ORIGIN;
  else process.env.APP_ORIGIN = previousOrigin;
  __resetOpenRouterCachesForTests();
});

describe("OpenRouter free model catalog", () => {
  it("only exposes zero-cost text models with tool support", () => {
    const result = normalizeFreeOpenRouterModels([
      model("openrouter/free"),
      model("good/free:free"),
      model("paid/model", { prompt: "0.000001" }),
      model("no-tools/free", { tools: false }),
      model("image-only/free", { outputs: ["image"] }),
    ]);

    expect(result.map((entry) => entry.id)).toEqual([
      "openrouter/free",
      "good/free:free",
    ]);
    expect(result[0]).toMatchObject({
      name: "Auto · Best available",
      automatic: true,
      free: true,
    });
  });

  it("reports setup required without pretending inference is operational", async () => {
    delete process.env.OPENROUTER_API_KEY;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: [model("openrouter/free")] }), {
          status: 200,
        }),
      ),
    );

    const status = await openRouterStatus({ force: true });
    expect(status).toMatchObject({
      configured: false,
      operational: false,
      dailyFreeRequestAllowance: null,
      freeModels: 1,
    });
  });
});

describe("OpenRouter inference", () => {
  it("sends the chosen free model first and automatic free routing as fallback", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [model("openrouter/free"), model("test/chosen:free")],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "generation-1",
            created: 1,
            model: "test/chosen:free",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "Ready." },
                finish_reason: "stop",
              },
            ],
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await invokeOpenRouter({
      model: "test/chosen:free",
      messages: [{ role: "user", content: "Hello" }],
      maxTokens: 200,
    });

    expect(response.model).toBe("test/chosen:free");
    const request = fetchMock.mock.calls[1];
    const body = JSON.parse(String((request[1] as RequestInit).body));
    expect(body.models).toEqual(["test/chosen:free", "openrouter/free"]);
    expect(body.max_tokens).toBe(200);
    expect((request[1] as RequestInit).headers).toMatchObject({
      Authorization: "Bearer test-openrouter-key",
      "HTTP-Referer": "https://www.rook.lighting",
      "X-OpenRouter-Title": "Rook",
    });
  });

  it("never accepts an unavailable or paid model ID from the client", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [model("openrouter/free")] }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "generation-2",
            created: 1,
            model: "some/free-model:free",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "Safe fallback." },
                finish_reason: "stop",
              },
            ],
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await invokeOpenRouter({
      model: "expensive/provider-model",
      messages: [{ role: "user", content: "Hello" }],
    });

    const body = JSON.parse(
      String((fetchMock.mock.calls[1][1] as RequestInit).body),
    );
    expect(body.models).toEqual(["openrouter/free"]);
  });

  it("transcribes recorded audio with the free audio-capable model", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{ message: { content: "Draft the quarterly update." } }],
      }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(transcribeOpenRouterAudio({ data: "d2ViLWF1ZGlv", format: "webm" }))
      .resolves.toBe("Draft the quarterly update.");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/chat/completions");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free");
    expect(body.messages[0].content[1]).toEqual({
      type: "input_audio",
      input_audio: { data: "d2ViLWF1ZGlv", format: "webm" },
    });
  });
});

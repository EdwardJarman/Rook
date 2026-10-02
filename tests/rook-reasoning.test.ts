import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  isReasoningRejectedError,
  reasoningFor,
} from "../server/ai/agent-reliability";
import {
  __resetOpenRouterCachesForTests,
  invokeOpenRouter,
  pickAutoModel,
} from "../server/ai/openrouter";
import { supportsAgentStream } from "../lib/agent-stream";

const previousKey = process.env.OPENROUTER_API_KEY;

const catalogEntry = (id: string) => ({
  id,
  name: `${id} (free)`,
  description: "Test model",
  context_length: 128_000,
  pricing: { prompt: "0", completion: "0" },
  architecture: {
    input_modalities: ["text"],
    output_modalities: ["text"],
  },
  supported_parameters: ["tools", "tool_choice"],
});

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  __resetOpenRouterCachesForTests();
});

describe("reasoning effort mapping", () => {
  it("defaults to medium (no params — today's behavior, byte-identical)", () => {
    expect(reasoningFor(undefined)).toBeUndefined();
    expect(reasoningFor("medium")).toBeUndefined();
    expect(reasoningFor("high")).toEqual({ effort: "high" });
    expect(reasoningFor("low")).toEqual({ effort: "low" });
  });

  it("recognizes provider rejections of reasoning params", () => {
    expect(
      isReasoningRejectedError(new Error("reasoning is not supported by this model (400)")),
    ).toBe(true);
    expect(
      isReasoningRejectedError(new Error("Unknown parameter: thinking")),
    ).toBe(true);
    expect(isReasoningRejectedError(new Error("Free AI capacity is temporarily full."))).toBe(
      false,
    );
    expect(isReasoningRejectedError(new Error("Rook's OpenRouter connection needs attention."))).toBe(
      false,
    );
  });
});

describe("auto picker prefers current families", () => {
  const entry = (id: string) => ({
    id,
    name: id,
    provider: "Test",
    description: "",
    contextLength: 128_000,
    supportsTools: true,
    supportsVision: false,
    automatic: false,
    free: true as const,
    usageLabel: "Free",
  });

  it("ranks deepseek v4 above v3 and qwen3.8 above qwen3", () => {
    expect(
      pickAutoModel(
        [entry("deepseek/deepseek-chat-v3:free"), entry("deepseek/deepseek-v4-flash-free")],
        true,
      ),
    ).toBe("deepseek/deepseek-v4-flash-free");
    expect(
      pickAutoModel(
        [entry("qwen/qwen3-32b:free"), entry("qwen/qwen3.8-27b-free")],
        true,
      ),
    ).toBe("qwen/qwen3.8-27b-free");
  });
});

describe("reasoning-param retry", () => {
  it("retries once without reasoning when the model rejects it", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [catalogEntry("test/fake:free")] }), {
          status: 200,
        }),
      )
      .mockImplementation(async (_url: string, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        if (bodies.length === 1) {
          return new Response(
            JSON.stringify({ error: { message: "reasoning is not supported by this model" } }),
            { status: 400 },
          );
        }
        return new Response(
          JSON.stringify({
            id: "gen-1",
            created: 1,
            model: "test/fake:free",
            choices: [
              { index: 0, message: { role: "assistant", content: "Answered plainly." }, finish_reason: "stop" },
            ],
          }),
          { status: 200 },
        );
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await invokeOpenRouter({
      model: "openrouter/free",
      messages: [{ role: "user", content: "Think hard about this." }],
      reasoning: { effort: "high" },
    });

    expect(result.choices[0]?.message.content).toBe("Answered plainly.");
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toMatchObject({ reasoning: { effort: "high" } });
    expect(bodies[1]).not.toHaveProperty("reasoning");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
  });
});

describe("stream client capability check", () => {
  it("still reports streaming support in a full runtime", () => {
    expect(supportsAgentStream()).toBe(true);
  });
});

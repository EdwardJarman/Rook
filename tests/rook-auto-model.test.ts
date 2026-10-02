import { beforeEach, describe, expect, it, vi } from "vitest";

import { isTransientAgentError } from "../server/ai/agent-reliability";
import {
  __resetOpenRouterCachesForTests,
  invokeOpenRouter,
  pickAutoModel,
  type RookAiModel,
} from "../server/ai/openrouter";

const entry = (id: string): RookAiModel => ({
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

const catalogEntry = (id: string) => ({
  id,
  name: `${id} (free)`,
  description: "Test model",
  context_length: 128_000,
  pricing: { prompt: "0", completion: "0" },
  architecture: { input_modalities: ["text"], output_modalities: ["text"] },
  supported_parameters: ["tools", "tool_choice"],
});

const chatOk = (text: string, model: string, finish = "stop") =>
  new Response(
    JSON.stringify({
      id: "gen-1",
      created: 1,
      model,
      choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: finish }],
    }),
    { status: 200 },
  );

const chatEmpty = (model: string) =>
  new Response(
    JSON.stringify({
      id: "gen-0",
      created: 1,
      model,
      choices: [{ index: 0, message: { role: "assistant", content: "" }, finish_reason: "length" }],
    }),
    { status: 200 },
  );

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  __resetOpenRouterCachesForTests();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("evidence-ranked auto picker (live catalog 2026-09-12)", () => {
  it("serves measured-good families before catalog-order junk", () => {
    expect(
      pickAutoModel(
        [entry("dots-studio/dots-3-note-preview:free"), entry("cohere/north-mini-code:free")],
        true,
      ),
    ).toBe("cohere/north-mini-code:free");
  });

  it("sinks empty-returning families to the bottom without banning", () => {
    expect(
      pickAutoModel([entry("some/good-model:free"), entry("dots-studio/dots-3-note-preview:free")], true),
    ).toBe("some/good-model:free");
    // …but still uses one when nothing else exists.
    expect(pickAutoModel([entry("dots-studio/dots-3-note-preview:free")], true)).toBe(
      "dots-studio/dots-3-note-preview:free",
    );
  });

  it("still prefers legacy strong families when they return", () => {
    expect(
      pickAutoModel([entry("junk/long:free"), entry("openai/gpt-oss-120b:free")], true),
    ).toBe("openai/gpt-oss-120b:free");
  });

  it("supports excluding the failed model for alternate retries", () => {
    expect(
      pickAutoModel(
        [entry("aa-first:free"), entry("bb-second:free")],
        true,
        "aa-first:free",
      ),
    ).toBe("bb-second:free");
  });
});

describe("empty-response alternate retry", () => {
  it("retries once on a different model, then returns its answer", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ data: [catalogEntry("openrouter/free"), catalogEntry("aa-first:free"), catalogEntry("bb-second:free")] }),
            { status: 200 },
          ),
        )
        .mockImplementation(async (_url: string, init?: RequestInit) => {
          bodies.push(JSON.parse(String(init?.body)));
          if (bodies.length === 1) return chatEmpty("aa-first:free");
          return chatOk("Recovered answer.", "bb-second:free");
        }),
    );

    const result = await invokeOpenRouter({
      // Unknown id: resolution falls back to the curated pick (aa-first),
      // whose empty shell then triggers the alternate retry (bb-second).
      model: "some/unknown:free",
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(result.choices[0]?.message.content).toBe("Recovered answer.");
    expect(bodies).toHaveLength(2);
    expect((bodies[0].models as string[])[0]).toBe("aa-first:free");
    expect((bodies[1].models as string[])[0]).toBe("bb-second:free");
  });

  it("does not retry explicitly-picked models (respects the choice, surfaces honestly)", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ data: [catalogEntry("openrouter/free"), catalogEntry("bb-second:free")] }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(chatEmpty("bb-second:free")),
    );

    await expect(
      invokeOpenRouter({ model: "bb-second:free", messages: [{ role: "user", content: "Hi" }] }),
    ).rejects.toThrow(/empty response/);
  });

  it("classifies empty responses as transient for cross-provider fallback", () => {
    expect(isTransientAgentError(new Error("The selected free model returned an empty response."))).toBe(
      true,
    );
  });
});

import { describe, expect, it } from "vitest";

import {
  canonicalModelForProvider,
  defaultModelForProvider,
  modelMatchesProvider,
  modelsForProvider,
  providerForModel,
  providerLabel,
} from "../lib/ai-provider";

const models = [
  { id: "openrouter/free", name: "Auto", provider: "OpenRouter", automatic: true },
  { id: "meta/free", name: "Meta", provider: "Meta", automatic: false },
  { id: "chatgpt:gpt-5", name: "GPT-5", provider: "ChatGPT", automatic: false },
  { id: "orcarouter:deepseek/deepseek-v4-flash-free", name: "DeepSeek V4 Flash", provider: "DeepSeek", automatic: false },
  { id: "tokenrouter:qwen/qwen3.8-max-free", name: "Qwen 3.8 Max", provider: "Qwen", automatic: false },
];

describe("AI provider preference", () => {
  it("separates ChatGPT subscription models from OpenRouter models", () => {
    expect(modelsForProvider(models, "chatgpt").map((model) => model.id)).toEqual(["chatgpt:gpt-5"]);
    expect(modelsForProvider(models, "openrouter").map((model) => model.id)).toEqual(["openrouter/free", "meta/free"]);
    expect(modelsForProvider(models, "orcarouter").map((model) => model.id)).toEqual(["orcarouter:deepseek/deepseek-v4-flash-free"]);
    expect(modelsForProvider(models, "tokenrouter").map((model) => model.id)).toEqual(["tokenrouter:qwen/qwen3.8-max-free"]);
    expect(modelMatchesProvider("chatgpt:gpt-5", "chatgpt")).toBe(true);
    expect(modelMatchesProvider("chatgpt:gpt-5", "openrouter")).toBe(false);
  });

  it("honors a Bot's explicit model provider over the global fallback", () => {
    expect(providerForModel("chatgpt:gpt-5.5", "openrouter")).toBe("chatgpt");
    expect(providerForModel("orcarouter:deepseek/free", "openrouter")).toBe("orcarouter");
    expect(providerForModel("openrouter/free", "tokenrouter")).toBe("tokenrouter");
  });

  it("chooses OpenRouter auto and the first connected ChatGPT model as safe defaults", () => {
    expect(defaultModelForProvider(models, "openrouter")?.id).toBe("openrouter/free");
    expect(defaultModelForProvider(models, "chatgpt")?.id).toBe("chatgpt:gpt-5");
    expect(defaultModelForProvider(models.filter((model) => !model.id.startsWith("chatgpt:")), "chatgpt")).toBeUndefined();
    expect(providerLabel("openrouter")).toBe("OpenRouter");
    expect(providerLabel("chatgpt")).toBe("ChatGPT");
    expect(providerLabel("orcarouter")).toBe("OrcaRouter");
    expect(providerLabel("tokenrouter")).toBe("TokenRouter");
    expect(canonicalModelForProvider("deepseek/deepseek-v4-flash-free", "orcarouter"))
      .toBe("orcarouter:deepseek/deepseek-v4-flash-free");
    expect(canonicalModelForProvider("qwen/qwen3.8-max-free", "tokenrouter"))
      .toBe("tokenrouter:qwen/qwen3.8-max-free");
  });
});

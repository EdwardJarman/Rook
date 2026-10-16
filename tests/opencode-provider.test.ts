import { describe, it, expect } from "vitest";
import {
  providerLabel,
  modelMatchesProvider,
  providerForModel,
  canonicalModelForProvider,
  modelsForProvider,
  defaultModelForProvider,
} from "../lib/ai-provider";

describe("ai-provider opencode wiring", () => {
  it("labels opencode correctly and matches prefix", () => {
    expect(providerLabel("opencode")).toBe("OpenCode");
    expect(modelMatchesProvider("opencode:gpt-5-nano", "opencode")).toBe(true);
    expect(modelMatchesProvider("opencode:big-pickle", "opencode")).toBe(true);
    expect(modelMatchesProvider("openrouter/free", "opencode")).toBe(false);
    expect(modelMatchesProvider("opencode:x", "openrouter")).toBe(false);
  });

  it("routes providerForModel to opencode when prefix matches", () => {
    expect(providerForModel("opencode:claude-opus", "openrouter")).toBe("opencode");
    expect(providerForModel("opencode:big-pickle", "chatgpt")).toBe("opencode");
    expect(providerForModel(undefined, "openrouter")).toBe("openrouter");
    expect(providerForModel("custom", "tokenrouter")).toBe("tokenrouter");
  });

  it("canonicalizes opencode models without duplicating prefix", () => {
    expect(canonicalModelForProvider("opencode:gpt-5-nano", "opencode")).toBe("opencode:gpt-5-nano");
    expect(canonicalModelForProvider("gpt-5-nano", "opencode")).toBe("opencode:gpt-5-nano");
    expect(canonicalModelForProvider("openrouter/free", "opencode")).toBe("openrouter/free");
  });

  it("filters and defaults opencode models like other providers", () => {
    const catalog = [
      { id: "openrouter/free", name: "auto", provider: "x", automatic: true },
      { id: "opencode:gpt-5-nano", name: "nano", provider: "OpenCode", automatic: false },
      { id: "opencode:big-pickle", name: "pickle", provider: "OpenCode", automatic: false },
      { id: "chatgpt:gpt-4o", name: "gpt4o", provider: "y", automatic: false },
    ];
    expect(modelsForProvider(catalog, "opencode").map((m) => m.id)).toEqual([
      "opencode:gpt-5-nano",
      "opencode:big-pickle",
    ]);
    expect(defaultModelForProvider(catalog, "opencode")?.id).toBe("opencode:gpt-5-nano");
    expect(defaultModelForProvider(catalog, "openrouter")?.id).toBe("openrouter/free");
  });

  it("does not break existing providers after opencode addition", () => {
    expect(providerLabel("openrouter")).toBe("OpenRouter");
    expect(providerLabel("chatgpt")).toBe("ChatGPT");
    expect(modelMatchesProvider("orcarouter:qwen", "orcarouter")).toBe(true);
    expect(modelMatchesProvider("tokenrouter:nemotron", "tokenrouter")).toBe(true);
  });
});

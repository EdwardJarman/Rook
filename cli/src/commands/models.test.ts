import { describe, expect, it } from "vitest";

import {
  defaultModelId,
  filterModels,
  groupModels,
  modelDisplay,
  providerForModelId,
  renderModels,
  type CatalogModel,
} from "./models.js";

const catalog: CatalogModel[] = [
  { id: "openrouter/free", name: "Auto · Best available", provider: "OpenRouter", automatic: true },
  { id: "opencode:big-pickle", name: "Big Pickle", provider: "OpenCode" },
  { id: "chatgpt:gpt-5.5", name: "GPT 5.5", provider: "ChatGPT" },
];

describe("model catalog", () => {
  it("routes ids to providers like the web app", () => {
    expect(providerForModelId("chatgpt:gpt-5.5")).toBe("chatgpt");
    expect(providerForModelId("orcarouter:x/y")).toBe("orcarouter");
    expect(providerForModelId("tokenrouter:x")).toBe("tokenrouter");
    expect(providerForModelId("opencode:big-pickle")).toBe("opencode");
    expect(providerForModelId("openrouter/free")).toBe("openrouter");
  });

  it("groups opencode first with headers", () => {
    const groups = groupModels(catalog);
    expect(groups.map((group) => group.provider)).toEqual(["opencode", "openrouter", "chatgpt"]);
    const text = renderModels(catalog, false);
    expect(text).toContain("OPENCODE (1)");
    expect(text).toContain("big-pickle");
    expect(text).toContain("Auto");
  });

  it("renders json verbatim on request", () => {
    expect(JSON.parse(renderModels(catalog, true))).toHaveLength(3);
  });

  it("formats Claude-style model indicators", () => {
    expect(modelDisplay("opencode:big-pickle")).toBe("OpenCode Big Pickle");
    expect(modelDisplay("chatgpt:gpt-5.5")).toBe("ChatGPT Gpt 5.5");
    expect(modelDisplay("openrouter:anthropic/claude-opus-4.1")).toBe("OpenRouter Claude Opus 4.1");
  });

  it("defaults to openrouter/free, else first", () => {
    expect(defaultModelId(catalog)).toBe("openrouter/free");
    expect(defaultModelId([catalog[1]!])).toBe("opencode:big-pickle");
    expect(defaultModelId([])).toBeUndefined();
  });

  it("filters by id, name, or provider substring", () => {
    expect(filterModels(catalog, "")).toHaveLength(3);
    expect(filterModels(catalog, "  ")).toHaveLength(3);
    expect(filterModels(catalog, "pickle").map((m) => m.id)).toEqual(["opencode:big-pickle"]);
    expect(filterModels(catalog, "GPT").map((m) => m.id)).toEqual(["chatgpt:gpt-5.5"]);
    expect(filterModels(catalog, "openrouter")).toHaveLength(1);
    expect(filterModels(catalog, "zzz")).toEqual([]);
    const text = renderModels(catalog, false, "pickle");
    expect(text).toContain("big-pickle");
    expect(text).not.toContain("GPT 5.5");
    expect(renderModels(catalog, false, "zzz")).toContain('No models match "zzz"');
    expect(JSON.parse(renderModels(catalog, true, "pickle"))).toHaveLength(1);
  });
});

import { describe, expect, it } from "vitest";

import {
  defaultModelId,
  groupModels,
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

  it("defaults to openrouter/free, else first", () => {
    expect(defaultModelId(catalog)).toBe("openrouter/free");
    expect(defaultModelId([catalog[1]!])).toBe("opencode:big-pickle");
    expect(defaultModelId([])).toBeUndefined();
  });
});

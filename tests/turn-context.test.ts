import { describe, expect, it } from "vitest";

import {
  __resetTurnContributorsForTests,
  applyTurnContributors,
  registerTurnContributor,
  resolveRequestedModel,
  turnContributorNames,
  TurnJournal,
} from "../server/ai/turn-context";

describe("grok turn-context seam (deterministic assembly)", () => {
  it("resolves the model route byte-identically", () => {
    expect(resolveRequestedModel(undefined)).toBe("openrouter/free");
    expect(resolveRequestedModel("")).toBe("openrouter/free");
    expect(resolveRequestedModel("auto")).toBe("openrouter/free");
    expect(resolveRequestedModel("OpenRouter/Free")).toBe("openrouter/free");
    expect(resolveRequestedModel("openrouter/auto")).toBe("openrouter/free");
    expect(resolveRequestedModel("  orcarouter:free  ")).toBe("orcarouter:free");
    expect(resolveRequestedModel("chatgpt:gpt-5")).toBe("chatgpt:gpt-5");
  });

  it("runs contributors in registration order with merged patches", async () => {
    __resetTurnContributorsForTests();
    try {
      registerTurnContributor({ name: "a", contribute: (seed) => ({ ...seed, a: 1 }) });
      registerTurnContributor({
        name: "b",
        contribute: async (seed) => ({ ...seed, b: (seed.a as number) + 1 }),
      });
      expect(turnContributorNames()).toEqual(["a", "b"]);
      expect(await applyTurnContributors({})).toEqual({ a: 1, b: 2 });
    } finally {
      __resetTurnContributorsForTests();
    }
  });

  it("unregister removes a contributor", async () => {
    __resetTurnContributorsForTests();
    try {
      const unregister = registerTurnContributor({
        name: "temp",
        contribute: (seed) => ({ ...seed, x: true }),
      });
      unregister();
      expect(await applyTurnContributors({})).toEqual({});
    } finally {
      __resetTurnContributorsForTests();
    }
  });

  it("journal dedups replays and caps memory", () => {
    const journal = new TurnJournal();
    expect(journal.hasCompleted("a:1")).toBe(false);
    journal.record({ fingerprint: "a:1", code: "UNKNOWN_TOOL", retryable: false });
    expect(journal.hasCompleted("a:1")).toBe(true);
    journal.record({ fingerprint: "", code: "FAILED", retryable: false });
    expect(journal.size).toBe(1);
    for (let i = 0; i < 150; i++) {
      journal.record({ fingerprint: `f:${i}`, code: "TIMEOUT", retryable: true });
    }
    expect(journal.size).toBe(100);
    expect(journal.hasCompleted("a:1")).toBe(false);
    expect(journal.hasCompleted("f:149")).toBe(true);
  });
});

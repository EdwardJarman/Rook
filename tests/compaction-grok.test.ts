import { describe, expect, it } from "vitest";

import {
  applyFocusNote,
  AUTO_COMPACT_THRESHOLD_PERCENT,
  buildCheckpointLedger,
  buildCompactionNotice,
  buildContextBudgetBlock,
  shouldEngageCompaction,
} from "../server/ai/compaction";

describe("grok compaction visibility (still $0)", () => {
  it("threshold defaults to 85 and guards bad input", () => {
    expect(AUTO_COMPACT_THRESHOLD_PERCENT).toBe(85);
    expect(shouldEngageCompaction(85, 100)).toBe(true);
    expect(shouldEngageCompaction(84, 100)).toBe(false);
    expect(shouldEngageCompaction(70, 100, 70)).toBe(true);
    expect(shouldEngageCompaction(10, 0)).toBe(false);
    expect(shouldEngageCompaction(Number.NaN, 100)).toBe(false);
  });

  it("ledger keeps its honest header and empty contract", () => {
    expect(buildCheckpointLedger([])).toBe("");
    const block = buildCheckpointLedger([
      { author: "user", body: "do the auth migration" },
    ]);
    expect(block).toContain("newest messages follow verbatim");
  });

  it("notice line only appears when something condensed", () => {
    expect(buildCompactionNotice(0)).toBe("");
    expect(buildCompactionNotice(3)).toContain("3 condensed");
  });

  it("budget block breaks down system/messages/free", () => {
    const block = buildContextBudgetBlock({
      systemTokens: 1000,
      messageTokens: 3000,
      totalTokens: 8000,
    });
    expect(block).toContain("50% used");
    expect(block).toContain("system 1,000");
    expect(block).toContain("messages 3,000");
    expect(block).toContain("free 4,000");
    expect(buildContextBudgetBlock({ systemTokens: 1, messageTokens: 1, totalTokens: 0 })).toBe(
      "Context: unknown window",
    );
  });

  it("focus note steers the ledger toward kept topics", () => {
    const dropped = [
      { author: "user" as const, body: "fix the login css" },
      { author: "user" as const, body: "migrate the auth module" },
    ];
    const steered = applyFocusNote(dropped, "keep the auth implementation details");
    expect(steered[0].body).toContain("auth");
    expect(applyFocusNote(dropped, "")).toEqual(dropped);
    expect(applyFocusNote(dropped, "a an")).toEqual(dropped);
  });
});

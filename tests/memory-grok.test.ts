import { describe, expect, it } from "vitest";

import {
  flushGateFor,
  gateMemoryCandidates,
  MEMORY_HARD_CHAR_THRESHOLD,
  MEMORY_HARD_TURN_THRESHOLD,
  MEMORY_SOFT_CHAR_THRESHOLD,
  MEMORY_SOFT_TURN_THRESHOLD,
  sanitizeMemoryCandidate,
} from "../server/ai/memory";

describe("grok memory flush gates + sanitization (still $0)", () => {
  it("gates escalate none → suggest → auto", () => {
    expect(flushGateFor(0, 0)).toBe("none");
    expect(flushGateFor(MEMORY_SOFT_TURN_THRESHOLD, 0)).toBe("suggest");
    expect(flushGateFor(0, MEMORY_SOFT_CHAR_THRESHOLD)).toBe("suggest");
    expect(flushGateFor(MEMORY_HARD_TURN_THRESHOLD, 0)).toBe("auto");
    expect(flushGateFor(0, MEMORY_HARD_CHAR_THRESHOLD)).toBe("auto");
    expect(flushGateFor(Number.NaN, Number.NaN)).toBe("none");
  });

  it("sanitization rejects junk, shapes keys, truncates", () => {
    expect(sanitizeMemoryCandidate({ key: "", value: "x" })).toBeNull();
    expect(sanitizeMemoryCandidate({ key: "note", value: "no reply" })).toBeNull();
    expect(sanitizeMemoryCandidate({ key: "wtf?!", value: "ok value here" })).toBeNull();
    expect(
      sanitizeMemoryCandidate({ key: "note", value: "my token is abc123" }),
    ).toBeNull();
    const long = sanitizeMemoryCandidate({ key: "note", value: `${"a".repeat(200)}` });
    expect(long?.value.length).toBeLessThanOrEqual(160);
    expect(sanitizeMemoryCandidate({ key: "Preference", value: "dark mode" })).toEqual({
      key: "preference",
      value: "dark mode",
    });
  });

  it("one-pass gate keeps the regex path honest", () => {
    const quiet = gateMemoryCandidates("hello there, how are you today?", 2);
    expect(quiet.gate).toBe("none");
    expect(quiet.candidates).toEqual([]);
    const fact = gateMemoryCandidates("remember that my workshop is downtown", 30);
    expect(fact.gate).toBe("auto");
    expect(fact.candidates.length).toBeGreaterThan(0);
    const secret = gateMemoryCandidates("remember that my api key is xyz", 30);
    expect(secret.candidates).toEqual([]);
  });
});

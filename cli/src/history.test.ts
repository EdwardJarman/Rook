import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HISTORY_LIMIT, historyPath, loadHistory, pushHistory, saveHistory } from "./history.js";

let dir: string;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  dir = mkdtempSync(join(tmpdir(), "rook-cli-hist-"));
  vi.stubEnv("ROOK_CONFIG_DIR", dir);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("pushHistory (pure)", () => {
  it("appends trimmed lines, skipping blanks and consecutive duplicates", () => {
    expect(pushHistory([], "  hello  ")).toEqual(["hello"]);
    expect(pushHistory(["hello"], "hello")).toEqual(["hello"]);
    expect(pushHistory(["hello"], "   ")).toEqual(["hello"]);
    expect(pushHistory(["a", "b"], "a")).toEqual(["a", "b", "a"]); // non-consecutive dup ok
  });

  it("caps at the limit, dropping the oldest", () => {
    const full = Array.from({ length: HISTORY_LIMIT }, (_, i) => `line ${i}`);
    const next = pushHistory(full, "newest");
    expect(next).toHaveLength(HISTORY_LIMIT);
    expect(next[0]).toBe("line 1");
    expect(next[next.length - 1]).toBe("newest");
  });
});

describe("history persistence", () => {
  it("round-trips through the config dir", () => {
    expect(historyPath().startsWith(dir)).toBe(true);
    saveHistory(["one", "two"]);
    expect(loadHistory()).toEqual(["one", "two"]);
    expect(JSON.parse(readFileSync(historyPath(), "utf8"))).toEqual(["one", "two"]);
  });

  it("starts fresh on a missing or corrupt file", () => {
    expect(loadHistory()).toEqual([]);
    writeFileSync(historyPath(), "{oops");
    expect(loadHistory()).toEqual([]);
    writeFileSync(historyPath(), JSON.stringify({ not: "an array" }));
    expect(loadHistory()).toEqual([]);
  });

  it("drops non-string and blank entries on load", () => {
    writeFileSync(historyPath(), JSON.stringify(["ok", 42, "", "  ", null, "also ok"]));
    expect(loadHistory()).toEqual(["ok", "also ok"]);
  });

  it("save is best-effort: an unwritable path never throws", () => {
    expect(() => saveHistory(["x"], join(dir, "history.json", "impossible", "h.json"))).not.toThrow();
  });
});

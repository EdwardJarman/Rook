import { describe, expect, it } from "vitest";

import { parseArgs } from "./args.js";
import { hintForError, levenshtein, suggestFrom, UsageError, withHint } from "./cli-errors.js";

describe("cli errors", () => {
  it("measures edit distance", () => {
    expect(levenshtein("models", "models")).toBe(0);
    expect(levenshtein("modles", "models")).toBe(2);
    expect(levenshtein("", "abc")).toBe(3);
  });

  it("suggests near misses, stays quiet on garbage", () => {
    expect(suggestFrom("modles", ["models", "chat", "ask"])).toBe("models");
    expect(suggestFrom("chta", ["models", "chat", "ask"])).toBe("chat");
    expect(suggestFrom("xyzzy", ["models", "chat", "ask"])).toBeUndefined();
  });

  it("maps error classes to next steps", () => {
    expect(hintForError("Not signed in")).toContain("rook login");
    expect(hintForError("unreachable at http://x")).toContain("rook doctor");
    expect(hintForError("No models available")).toContain("rook models");
    expect(hintForError("something totally new")).toBeUndefined();
    expect(withHint("Not signed in")).toContain("rook login");
    expect(withHint("something totally new")).toBe("something totally new");
  });

  it("parses args and suggests flags", () => {
    expect(parseArgs(["ask", "hi"])).toEqual({
      command: "ask",
      positionals: ["hi"],
      flags: {},
    });
    expect(parseArgs(["-m", "x", "chat"])).toEqual({
      command: "chat",
      positionals: [],
      flags: { model: "x" },
    });
    expect(() => parseArgs(["--modle"])).toThrowError(UsageError);
    expect(() => parseArgs(["--modle"])).toThrowError(/Did you mean --model/);
    expect(() => parseArgs(["--xyzzy"])).toThrowError(/rook help/);
    expect(() => parseArgs(["-m"])).toThrowError(UsageError);
  });
});

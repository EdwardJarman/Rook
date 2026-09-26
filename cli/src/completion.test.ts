import { describe, expect, it } from "vitest";

import { COMMANDS } from "./args.js";
import { renderCompletion } from "./completion.js";

describe("shell completions", () => {
  it("stays in sync with the router's commands and flags", () => {
    for (const shell of ["bash", "zsh", "powershell"] as const) {
      const script = renderCompletion(shell);
      expect(script).toBeDefined();
      for (const command of COMMANDS) {
        expect(script).toContain(command);
      }
      expect(script).toContain("--api-url");
      expect(script).toContain("--model");
    }
  });

  it("rejects unknown shells (and pwsh aliases powershell)", () => {
    expect(renderCompletion("fish")).toBeUndefined();
    expect(renderCompletion(undefined)).toBeUndefined();
    expect(renderCompletion("pwsh")).toContain("Register-ArgumentCompleter");
    expect(renderCompletion("BASH")).toContain("complete -F _rook rook");
  });

  it("keeps zsh compdef on the first line", () => {
    expect(renderCompletion("zsh")?.split("\n")[0]).toBe("#compdef rook");
  });
});

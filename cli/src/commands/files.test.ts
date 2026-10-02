import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { saveAnswerText, saveTurnFiles } from "./files.js";

describe("turn file saving", () => {
  it("writes files and never clobbers", () => {
    const dir = mkdtempSync(join(tmpdir(), "rook-files-"));
    writeFileSync(join(dir, "game.html"), "mine");
    const saved = saveTurnFiles(
      [
        { name: "game.html", mimeType: "text/html", content: "<html>" },
        { name: "../../evil.txt", mimeType: "text/plain", content: "x" },
      ],
      dir,
    );
    expect(saved).toHaveLength(2);
    expect(readFileSync(join(dir, "game.html"), "utf8")).toBe("mine");
    expect(saved[0]).toContain("game (1).html");
    expect(saved[1]).toContain("evil.txt");
    expect(readFileSync(saved[1]!, "utf8")).toBe("x");
  });

  it("handles empties", () => {
    const dir = mkdtempSync(join(tmpdir(), "rook-files-"));
    expect(saveTurnFiles(undefined, dir)).toEqual([]);
    expect(saveTurnFiles([], dir)).toEqual([]);
  });
});

describe("answer saving (/save)", () => {
  it("writes rook-answer.md and bumps collisions", () => {
    const dir = mkdtempSync(join(tmpdir(), "rook-save-"));
    const first = saveAnswerText("# Answer", dir);
    expect(first).toContain("rook-answer.md");
    expect(readFileSync(first, "utf8")).toBe("# Answer");
    const second = saveAnswerText("# Answer", dir);
    expect(second).toContain("rook-answer (1).md");
  });

  it("sanitizes explicit names", () => {
    const dir = mkdtempSync(join(tmpdir(), "rook-save-"));
    const saved = saveAnswerText("x", dir, "../../evil");
    expect(saved).toContain("evil.md");
    expect(saved).not.toContain("..");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  asciiMode,
  banner,
  box,
  c,
  centerBlock,
  commandMenu,
  createSpinner,
  footerRow,
  invert,
  launchScreen,
  md,
  pickerHint,
  promptGlyph,
  rule,
  selectGlyph,
  statusBar,
  statusline,
  stripAnsi,
  syncRows,
  terminalWidth,
  tipLine,
  toolRow,
  truncate,
  visibleWidth,
  wordmark,
  wrapAnsi,
} from "./ui.js";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("ROOK_COLOR", "1");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("terminal styling core", () => {
  it("strips escapes for width math and honors NO_COLOR", () => {
    expect(visibleWidth(c("mint", "rook"))).toBe(4);
    expect(stripAnsi(c("amber", "x"))).toBe("x");
    vi.stubEnv("NO_COLOR", "1");
    expect(c("mint", "rook")).toBe("rook");
  });

  it("truncates with an ellipsis", () => {
    expect(truncate("hello world", 5)).toBe("hell…");
    expect(truncate("hi", 5)).toBe("hi");
  });

  it("inverts a cell for the drawn cursor and degrades to plain text", () => {
    expect(invert("x")).toBe("\x1b[7mx\x1b[27m");
    expect(stripAnsi(invert("x"))).toBe("x");
    expect(visibleWidth(invert("x"))).toBe(1);
    vi.stubEnv("NO_COLOR", "1");
    expect(invert("x")).toBe("x");
  });

  it("clamps tiny terminals to 20 columns instead of pretending 80", () => {
    const stdout = process.stdout as { columns?: number };
    const original = stdout.columns;
    try {
      stdout.columns = 15;
      expect(terminalWidth()).toBe(20);
      stdout.columns = 120;
      expect(terminalWidth()).toBe(120);
      stdout.columns = undefined;
      expect(terminalWidth()).toBe(80);
    } finally {
      stdout.columns = original;
    }
  });

  it("draws rounded boxes with titles and exact widths", () => {
    const rendered = box({ title: "Files", lines: ["game.html", "a much longer file name here"] });
    const lines = rendered.split("\n");
    expect(lines[0]).toMatch(/^╭─ Files /);
    expect(lines[lines.length - 1]).toMatch(/^╰─+╯$/);
    const widths = new Set(lines.map(visibleWidth));
    expect(widths.size).toBe(1);
    expect(stripAnsi(rendered)).toContain("game.html");
  });

  it("wraps long lines keeping styles alive", () => {
    const rows = wrapAnsi(`plain ${c("mint", "green-text-here")}`, 10);
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.map(stripAnsi).join("").replace(/\s+/g, " ").trim()).toContain("green-text-here");
  });

  it("renders rules, statuslines, and tool rows", () => {
    expect(stripAnsi(rule("Models"))).toContain("Models");
    expect(stripAnsi(statusline(["big-pickle", undefined, ""]))).toBe("big-pickle");
    expect(statusline([])).toBe("");
    expect(stripAnsi(toolRow("write file", "running"))).toContain("●");
    expect(stripAnsi(toolRow("write file", "done", "ok"))).toContain("✓");
    expect(stripAnsi(toolRow("write file", "done", "ok"))).toContain("⎿");
    expect(stripAnsi(toolRow("write file", "error"))).toContain("✗");
  });

  it("renders the welcome banner", () => {
    const text = stripAnsi(banner("0.1.0", "opencode:big-pickle"));
    expect(text).toContain("Rook");
    expect(text).toContain("0.1.0");
    expect(text).toContain("opencode:big-pickle");
  });
});

describe("tui chrome", () => {
  it("draws a 5x23 pixel wordmark with a dim-to-bright gradient", () => {
    const raw = wordmark();
    const lines = stripAnsi(raw).split("\n");
    expect(lines).toHaveLength(5);
    expect(lines.every((line) => visibleWidth(line) === 23)).toBe(true);
    expect(stripAnsi(raw)).toContain("█");
    // Gradient: the first two letters ride a dim code, the rest do not.
    expect(raw.startsWith("\x1b[2m")).toBe(true);
  });

  it("centers blocks and builds the launch screen deterministically", () => {
    expect(stripAnsi(centerBlock("hi", 10))).toBe("    hi");
    const screen = launchScreen({ version: "9.9.9", model: "OpenCode Big Pickle", tip: "stay curious", width: 40 });
    const plain = stripAnsi(screen);
    expect(plain).toContain("v9.9.9");
    expect(plain).toContain("OpenCode Big Pickle");
    expect(plain).toContain("stay curious");
    expect(plain).toContain("Tip");
    for (const line of plain.split("\n")) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(40);
    }
  });

  it("lays the slash palette out with a straight hint rail", () => {
    const menu = commandMenu(
      [
        { command: "/model <id>", description: "switch model" },
        { command: "/exit", description: "leave", hint: "ctrl+d" },
      ],
      40,
    );
    const lines = menu.split("\n");
    expect(lines).toHaveLength(2);
    expect(new Set(lines.map(visibleWidth)).size).toBe(1);
    expect(visibleWidth(lines[0]!)).toBe(40);
    expect(stripAnsi(menu)).toContain("/model <id>");
    expect(stripAnsi(menu)).toContain("ctrl+d");
    expect(menu).toContain("\x1b[38;5;208m");
  });

  it("pins footer rows and the status bar to the terminal width", () => {
    expect(stripAnsi(footerRow("ab", "cd", 10))).toBe("ab      cd");
    expect(visibleWidth(footerRow("a-very-long-left-label-overflowing", "cd", 10))).toBe(10);
    vi.stubEnv("HOME", "/home/dev");
    const bar = stripAnsi(statusBar("/home/dev/proj", "0.1.0", 30));
    expect(bar.startsWith("~/proj")).toBe(true);
    expect(bar.endsWith("v0.1.0")).toBe(true);
    expect(visibleWidth(bar)).toBe(30);
    expect(stripAnsi(tipLine("drink water"))).toBe("● Tip drink water");
  });

  it("emits zero escapes under NO_COLOR", () => {
    vi.stubEnv("NO_COLOR", "1");
    const screen = launchScreen({ version: "1.0.0", model: "M", tip: "t", width: 40 });
    // eslint-disable-next-line no-control-regex
    expect(/\x1b\[/.test(screen + commandMenu([{ command: "/x", description: "y" }], 20))).toBe(false);
  });
});

describe("spinner", () => {
  it("writes frames and clears on stop without touching stdio in tests", async () => {
    const writes: string[] = [];
    const stream = { isTTY: true, write: (chunk: string) => writes.push(chunk) } as unknown as NodeJS.WriteStream;
    const spinner = createSpinner("Loading", stream);
    spinner.start();
    await new Promise((resolve) => setTimeout(resolve, 200));
    spinner.stop("Loaded");
    expect(writes.length).toBeGreaterThan(1);
    expect(writes.join("")).toContain("Loaded");
  });

  it("stays silent on non-TTY streams except the final message", () => {
    const writes: string[] = [];
    const stream = { isTTY: false, write: (chunk: string) => writes.push(chunk) } as unknown as NodeJS.WriteStream;
    const spinner = createSpinner("Loading", stream);
    spinner.start();
    spinner.stop("Loaded");
    expect(writes).toEqual(["Loaded\n"]);
  });
});

describe("markdown-lite renderer", () => {
  it("keeps code fences verbatim with markers", () => {
    const out = md("```python\ndef __init__(self):\n    x = a * 2\n```");
    expect(stripAnsi(out)).toContain("def __init__(self):");
    expect(stripAnsi(out)).toContain("x = a * 2");
    expect(stripAnsi(out)).toContain("code");
  });

  it("formats headings, bold, bullets, ordered lists, and quotes", () => {
    const out = md("## Title\nA **bold** move\n- one\n- two\n1. first\n> noted");
    const plain = stripAnsi(out);
    expect(plain).toContain("Title");
    expect(plain).toContain("bold");
    expect(plain).toContain("• one");
    expect(plain).toContain("1. first");
    expect(plain).toContain("│ noted");
    expect(out).toContain("\x1b[1m");
  });

  it("collapses blank runs and closes unclosed fences", () => {
    expect(md("a\n\n\n\nb")).toBe("a\n\nb");
    expect(stripAnsi(md("```\ncode"))).toContain("code");
  });
});

describe("ascii fallback (ROOK_ASCII=1)", () => {
  it("swaps every decorative glyph, keeps layout widths", () => {
    vi.stubEnv("ROOK_ASCII", "1");
    expect(asciiMode()).toBe(true);
    expect(promptGlyph()).toBe(">");
    expect(selectGlyph()).toBe(">");
    expect(pickerHint()).toContain("up/down");
    const panel = stripAnsi(box({ title: "T", lines: ["hi"] }));
    expect(panel).toContain("+");
    expect(panel).not.toContain("╭");
    expect(stripAnsi(toolRow("Run", "running"))).toContain("* Run");
    expect(stripAnsi(toolRow("Run", "done"))).toContain("+ Run");
    expect(stripAnsi(toolRow("Run", "error"))).toContain("x Run");
    expect(stripAnsi(banner("0.1.0"))).toContain("* Rook");
    expect(stripAnsi(wordmark())).toContain("#");
    expect(stripAnsi(wordmark())).not.toContain("█");
    const doc = stripAnsi(md("- one\n> noted\n```\nx\n```"));
    expect(doc).toContain("- one");
    expect(doc).toContain("| noted");
    expect(truncate("abcdef", 5)).toBe("ab...");
    expect(stripAnsi(tipLine("x"))).toContain("* Tip");
  });

  it("uses only glyphs every console font has", async () => {
    expect(promptGlyph()).toBe("›");
    expect(stripAnsi(toolRow("Run", "running"))).toContain("● Run");
    const writes: string[] = [];
    const stream = { write: (s: string) => writes.push(s), isTTY: true } as unknown as NodeJS.WriteStream;
    const spinner = createSpinner("busy", stream);
    spinner.start();
    await new Promise((resolve) => setTimeout(resolve, 200));
    spinner.stop();
    expect(writes.join("")).toContain("-");
    expect(writes.join("")).not.toContain("⠋");
  });
});

describe("status bar context", () => {
  it("appends model and turn extras without breaking the plain form", () => {
    const plain = stripAnsi(statusBar("/repo", "0.1.0", 40));
    expect(plain).toContain("v0.1.0");
    expect(plain).not.toContain("model");
    const rich = stripAnsi(statusBar("/repo", "0.1.0", 60, "model X · turn 3"));
    expect(rich).toContain("model X · turn 3 · v0.1.0");
    expect(rich).toContain("/repo");
  });
});

describe("syncRows (shrink clears stale rows, cursor lands right)", () => {
  const stream = () => {
    const writes: string[] = [];
    return {
      writes,
      stdout: { write: (s: string) => writes.push(s) } as unknown as NodeJS.WriteStream,
    };
  };

  it("grows, holds, and shrinks with surplus clears", () => {
    const { writes, stdout } = stream();
    const state = { drawn: 0 };
    syncRows(stdout, state, ["a", "b"]);
    expect(state.drawn).toBe(2);
    syncRows(stdout, state, ["a", "b"]);
    expect(state.drawn).toBe(2);
    syncRows(stdout, state, ["a"]);
    expect(state.drawn).toBe(1);
    // Shrink pass: up 2, draw 1 row, clear 1 surplus line, back up 1.
    const tail = writes.slice(-4);
    expect(tail[0]).toBe("\x1b[2A");
    expect(tail[1]).toBe("\r\x1b[2Ka\n");
    expect(tail[2]).toBe("\r\x1b[2K\n");
    expect(tail[3]).toBe("\x1b[1A");
  });

  it("emits no cursor motion on first draw", () => {
    const { writes, stdout } = stream();
    const state = { drawn: 0 };
    syncRows(stdout, state, ["only"]);
    expect(writes).toEqual(["\r\x1b[2Konly\n"]);
  });
});

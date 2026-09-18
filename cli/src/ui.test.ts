import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  banner,
  box,
  c,
  createSpinner,
  md,
  rule,
  statusline,
  stripAnsi,
  toolRow,
  truncate,
  visibleWidth,
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
    expect(stripAnsi(toolRow("write file", "running"))).toContain("⏺");
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

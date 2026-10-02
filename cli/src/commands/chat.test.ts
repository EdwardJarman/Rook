import { EventEmitter } from "node:events";

import { describe, expect, it } from "vitest";

import { buildRecentContext } from "./ask.js";
import {
  CHAT_COMMANDS,
  CHAT_HELP,
  CHAT_TIPS,
  chatStartupModel,
  modelPickerRows,
  OFFLINE_DEFAULT_MODEL,
  osc52Copy,
  parseSlash,
  pickModel,
  pickTip,
  type PickerItem,
} from "./chat.js";
import { isModelArg } from "./input.js";
import { stripAnsi, visibleWidth } from "../ui.js";

describe("chat helpers", () => {
  it("parses slash commands, defaulting to messages", () => {
    expect(parseSlash("hello there")).toEqual({ cmd: "message", text: "hello there" });
    expect(parseSlash("  /model opencode:big-pickle ")).toEqual({
      cmd: "model",
      arg: "opencode:big-pickle",
    });
    expect(parseSlash("/MODELS")).toEqual({ cmd: "models" });
    expect(parseSlash("/quit")).toEqual({ cmd: "exit" });
    expect(parseSlash("/copy")).toEqual({ cmd: "copy" });
    expect(parseSlash("/retry")).toEqual({ cmd: "retry" });
    expect(parseSlash("/save notes.md")).toEqual({ cmd: "save", arg: "notes.md" });
    expect(parseSlash("/save")).toEqual({ cmd: "save", arg: "" });
    expect(parseSlash("/bogus")).toEqual({ cmd: "unknown", arg: "bogus" });
    expect(parseSlash("   ")).toEqual({ cmd: "message", text: "" });
  });

  it("documents every slash command", () => {
    for (const cmd of ["/model", "/models", "/retry", "/copy", "/save", "/new", "/help", "/exit"]) {
      expect(CHAT_HELP).toContain(cmd);
    }
    expect(CHAT_COMMANDS.map((item) => item.command)).toEqual([
      "/model",
      "/models",
      "/retry",
      "/copy",
      "/save",
      "/new",
      "/help",
      "/exit",
    ]);
    // The <id> renders as a display hint, never a committed model value.
    expect(CHAT_COMMANDS[0]?.hint).toBe("<id>");
    expect(isModelArg(CHAT_COMMANDS[0]?.hint)).toBe(true);
  });

  it("rotates short tips", () => {
    expect(CHAT_TIPS.length).toBeGreaterThan(0);
    expect(CHAT_TIPS.every((tip) => tip.length > 0 && tip.length <= 80)).toBe(true);
    expect(CHAT_TIPS).toContain(pickTip());
  });

  it("caps recent context like the web client", () => {
    const history = Array.from({ length: 20 }, (_, i) => ({
      author: (i % 2 === 0 ? "user" : "bot") as "user" | "bot",
      body: `turn ${i} `.repeat(500),
    }));
    const capped = buildRecentContext(history);
    expect(capped).toHaveLength(8);
    expect(capped[0]?.body).toContain("turn 12");
    expect(capped.every((turn) => turn.body.length <= 2000)).toBe(true);
  });

  it("encodes OSC 52 clipboard writes that round-trip", () => {
    const seq = osc52Copy("hello ✓");
    expect(seq.startsWith("\x1b]52;c;")).toBe(true);
    expect(seq.endsWith("\x07")).toBe(true);
    const payload = seq.slice("\x1b]52;c;".length, -1);
    expect(Buffer.from(payload, "base64").toString("utf8")).toBe("hello ✓");
  });
});

describe("chat startup model (offline degradation)", () => {
  const catalog = [
    { id: "openrouter/free", name: "Auto", provider: "openrouter" },
    { id: "opencode:big-pickle", name: "Big Pickle", provider: "opencode" },
  ];

  it("prefers an explicit model, then the catalog default", () => {
    expect(chatStartupModel("opencode:big-pickle", catalog)).toEqual({
      model: "opencode:big-pickle",
      offline: false,
    });
    expect(chatStartupModel(undefined, catalog)).toEqual({
      model: "openrouter/free",
      offline: false,
    });
  });

  it("degrades to the documented default when the catalog is unreachable", () => {
    expect(chatStartupModel(undefined, undefined)).toEqual({
      model: OFFLINE_DEFAULT_MODEL,
      offline: true,
    });
    expect(chatStartupModel(undefined, [])).toEqual({
      model: OFFLINE_DEFAULT_MODEL,
      offline: true,
    });
    expect(chatStartupModel("  ", [])).toEqual({ model: OFFLINE_DEFAULT_MODEL, offline: true });
    // An explicit model still wins offline — no surprise substitution.
    expect(chatStartupModel("opencode:big-pickle", undefined)).toEqual({
      model: "opencode:big-pickle",
      offline: false,
    });
  });
});

describe("model picker rows (pure windowing)", () => {
  const items: PickerItem[] = Array.from({ length: 30 }, (_, i) => ({
    id: `m${i}`,
    label: `Model ${i}`,
  }));

  it("windows long catalogs around the selection", () => {
    expect(modelPickerRows(items, 0)).toHaveLength(7);
    expect(modelPickerRows(items, 0)[0]).toContain("›");
    expect(modelPickerRows(items, 0)[0]).toContain("Model 0");
    // Deep selection: the window follows, selection stays centered.
    const mid = modelPickerRows(items, 12);
    expect(mid).toHaveLength(7);
    expect(mid[3]).toContain("›");
    expect(mid[3]).toContain("Model 12");
    // Clamps instead of running off either end.
    expect(modelPickerRows(items, 29)[6]).toContain("Model 29");
    expect(modelPickerRows([], 0)).toEqual([]);
  });
});

describe("model picker on a fake TTY (exact cursor math)", () => {
  type FakeIn = NodeJS.ReadStream & EventEmitter;
  type FakeOut = NodeJS.WriteStream & EventEmitter;
  const fakeTty = (columns = 80): { stdin: FakeIn; stdout: FakeOut; writes: string[] } => {
    const stdin = new EventEmitter() as FakeIn;
    Object.assign(stdin, {
      isTTY: true,
      setRawMode: () => stdin,
      resume: () => stdin,
      pause: () => stdin,
    });
    const writes: string[] = [];
    const stdout = new EventEmitter() as FakeOut;
    Object.assign(stdout, {
      isTTY: true,
      columns,
      write: (chunk: string) => {
        writes.push(String(chunk));
        return true;
      },
    });
    return { stdin, stdout, writes };
  };
  const key = (stdin: FakeIn, name: string): void => {
    stdin.emit("keypress", undefined, { name });
  };
  /**
   * Cursor-row simulator: the invariant the old hand-rolled math broke
   * (one line of drift per keypress, then clear() erased the wrong rows).
   * Counts newlines minus cursor-up escapes — nothing else moves the row.
   */
  const rowAfter = (writes: string[]): number => {
    let row = 0;
    for (const chunk of writes) {
      row += (chunk.match(/\n/g) ?? []).length;
      for (const up of chunk.matchAll(/\x1b\[(\d+)A/g)) row -= Number(up[1]);
    }
    return row;
  };
  const drawnLines = (writes: string[]): string[] =>
    writes.flatMap((chunk) => [...chunk.matchAll(/\r\x1b\[2K([^\n]*)\n/g)].map((m) => m[1]!));
  const models = Array.from({ length: 30 }, (_, i) => ({
    id: `m${i}`,
    name: `Model ${i}`,
    provider: "opencode",
  }));
  const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  it("never drifts: every keypress keeps the cursor on the same row, finish returns to origin", async () => {
    const { stdin, stdout, writes } = fakeTty();
    const picked = pickModel(models, "m0", { stdin, stdout });
    await tick();
    const anchor = rowAfter(writes);
    expect(anchor).toBeGreaterThan(0); // the picker is on screen
    for (let i = 0; i < 12; i += 1) {
      key(stdin, "down");
      expect(rowAfter(writes)).toBe(anchor); // no drift, ever
    }
    key(stdin, "up");
    expect(rowAfter(writes)).toBe(anchor);
    key(stdin, "x"); // unbound keys never redraw
    expect(rowAfter(writes)).toBe(anchor);
    key(stdin, "return");
    await expect(picked).resolves.toBe("m11");
    expect(rowAfter(writes)).toBe(0); // erased back to the origin
    expect(writes.join("")).toContain("\x1b[?25l"); // cursor hidden while open
    expect(writes.join("").endsWith("\x1b[?25h")).toBe(true); // restored at finish
  });

  it("cancels with escape and keeps every row width-capped", async () => {
    const narrow = fakeTty(40);
    const longModels = models.map((m, i) => ({
      ...m,
      name: `Extraordinarily Long Model Name That Would Surely Wrap ${i}`,
    }));
    const picked = pickModel(longModels, "m0", { stdin: narrow.stdin, stdout: narrow.stdout });
    await tick();
    // The live block never outgrows the window: label + 7 rows + hint.
    expect(rowAfter(narrow.writes)).toBeLessThanOrEqual(9);
    key(narrow.stdin, "down");
    expect(rowAfter(narrow.writes)).toBeLessThanOrEqual(9);
    key(narrow.stdin, "escape");
    await expect(picked).resolves.toBeUndefined();
    expect(rowAfter(narrow.writes)).toBe(0);
    const lines = drawnLines(narrow.writes).filter((line) => stripAnsi(line).trim() !== "");
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(39);
  });

  it("shows the selection after deep travel and picks it", async () => {
    const { stdin, stdout, writes } = fakeTty();
    const picked = pickModel(models, "m0", { stdin, stdout });
    await tick();
    for (let i = 0; i < 25; i += 1) key(stdin, "down");
    key(stdin, "return");
    await expect(picked).resolves.toBe("m25");
    const lines = drawnLines(writes).map(stripAnsi);
    expect(lines.some((line) => line.includes("Model 25"))).toBe(true);
  });

  it("returns undefined off-TTY without writing anything", async () => {
    const writes: string[] = [];
    const stdin = new EventEmitter() as FakeIn;
    Object.assign(stdin, { isTTY: false, setRawMode: () => stdin, resume: () => stdin, pause: () => stdin });
    const stdout = new EventEmitter() as FakeOut;
    Object.assign(stdout, { isTTY: false, columns: 80, write: (s: string) => writes.push(s) });
    await expect(
      pickModel(models, "m0", { stdin: stdin as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream }),
    ).resolves.toBeUndefined();
    expect(writes).toEqual([]);
  });
});

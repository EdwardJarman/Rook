import { EventEmitter } from "node:events";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  askInput,
  clearRows,
  drawRows,
  feedPasteKey,
  finishRows,
  handleInput,
  initialFrame,
  initialPasteState,
  insertText,
  isModelArg,
  layoutFrame,
  lineEnd,
  lineStart,
  modelMatches,
  paletteRows,
  PASTE_END,
  PASTE_START,
  slashMatches,
  type InputFrame,
} from "./input.js";
import { clearRows as clearSyncRows, drawRows as drawSyncRows, rowsBackToStart, stripAnsi, visibleWidth } from "../ui.js";

const CMDS = [
  { command: "/model", hint: "<id>", description: "switch model for this session" },
  { command: "/models", description: "list every model" },
  { command: "/new", description: "forget this conversation" },
  { command: "/help", description: "show this palette" },
  { command: "/exit", description: "leave" },
];

const MODELS = [
  { command: "openrouter/free", description: "Auto · Best available" },
  { command: "opencode:big-pickle", description: "Big Pickle" },
  { command: "chatgpt:gpt-5.5", description: "GPT 5.5" },
];

describe("chat input engine", () => {
  it("matches slash commands only when the buffer starts with /", () => {
    expect(slashMatches(CMDS, "")).toEqual([]);
    expect(slashMatches(CMDS, "hello")).toEqual([]);
    expect(slashMatches(CMDS, "/")).toHaveLength(CMDS.length);
    expect(slashMatches(CMDS, "/m").map((s) => s.command)).toEqual(["/model", "/models"]);
    expect(slashMatches(CMDS, "/MODELS")).toEqual([{ command: "/models", description: "list every model" }]);
    expect(slashMatches(CMDS, "/nope")).toEqual([]);
  });

  it("filters models by id or name with an empty query listing all", () => {
    expect(modelMatches(MODELS, "")).toEqual(MODELS);
    expect(modelMatches(MODELS, "pickle")).toEqual([
      { command: "opencode:big-pickle", description: "Big Pickle" },
    ]);
    expect(modelMatches(MODELS, "GPT")).toEqual([
      { command: "chatgpt:gpt-5.5", description: "GPT 5.5" },
    ]);
  });

  it("marks the palette selection and windows long lists", () => {
    const rows = paletteRows(CMDS, 1, 5);
    expect(rows).toHaveLength(5);
    expect(rows[1]).toContain("›");
    expect(rows[0]).not.toContain("›");
    const clamped = paletteRows(CMDS, 4, 5);
    expect(clamped[4]).toContain("/exit");
  });

  it("types characters, edits with backspace and word ops", () => {
    let frame = initialFrame({ model: "OpenCode Big Pickle", commands: CMDS });
    frame = handleInput(frame, "h") as typeof frame;
    frame = handleInput(frame, "i") as typeof frame;
    expect(frame.buffer).toBe("hi");
    frame = handleInput(frame, undefined, { name: "backspace" }) as typeof frame;
    expect(frame.buffer).toBe("h");
    frame = handleInput(frame, undefined, { ctrl: true, name: "u" }) as typeof frame;
    expect(frame.buffer).toBe("");
    frame = handleInput(frame, "a") as typeof frame;
    frame = handleInput(frame, " ") as typeof frame;
    frame = handleInput(frame, "b") as typeof frame;
    frame = handleInput(frame, undefined, { ctrl: true, name: "w" }) as typeof frame;
    expect(frame.buffer).toBe("a ");
  });

  it("opens the palette as you type and commits with enter or tab", () => {
    let frame = initialFrame({ model: "M", commands: CMDS });
    frame = handleInput(frame, "/") as typeof frame;
    expect(frame.palette).toHaveLength(CMDS.length);
    frame = handleInput(frame, "m") as typeof frame;
    expect(frame.palette.map((s) => s.command)).toEqual(["/model", "/models"]);
    // Palette display keeps the <id> hint; the committed buffer never does.
    expect(paletteRows(frame.palette, 0)).toEqual(
      expect.arrayContaining([expect.stringContaining("<id>")]),
    );
    // Down selects /models; enter commits it to the buffer for args.
    frame = handleInput(frame, undefined, { name: "down" }) as typeof frame;
    frame = handleInput(frame, undefined, { name: "return" }) as typeof frame;
    expect(frame.buffer).toBe("/models ");
    // Exact match + enter submits; esc clears the line entirely.
    frame = handleInput(frame, undefined, { name: "backspace" }) as typeof frame;
    const done = handleInput(frame, undefined, { name: "return" });
    expect(done).toBe("/models");
    const wiped = handleInput(frame, undefined, { name: "escape" }) as typeof frame;
    expect(wiped.buffer).toBe("");
    // Tab completes the first match in one go.
    let f2 = initialFrame({ model: "M", commands: CMDS });
    f2 = handleInput(f2, "/") as typeof f2;
    f2 = handleInput(f2, "n") as typeof f2;
    f2 = handleInput(f2, undefined, { name: "tab" }) as typeof f2;
    expect(f2.buffer).toBe("/new ");
    // Typing bare /model and entering submits the command token only.
    let f3 = initialFrame({ model: "M", commands: CMDS });
    for (const ch of "/model") f3 = handleInput(f3, ch) as typeof f3;
    const modelCmd = handleInput(f3, undefined, { name: "return" });
    expect(modelCmd).toBe("/model");
    expect(isModelArg("<id>")).toBe(true);
    expect(isModelArg("opencode:big-pickle")).toBe(false);
  });

  it("returns exit on ctrl+d and pick on ctrl+n", () => {
    const frame = initialFrame({ model: "M", commands: CMDS });
    expect(handleInput(frame, undefined, { ctrl: true, name: "d" })).toEqual({ type: "exit" });
    expect(handleInput(frame, undefined, { ctrl: true, name: "n" })).toEqual({ type: "pick" });
  });

  it("walks history with arrows and keeps the in-flight draft", () => {
    let frame = initialFrame({ model: "M", commands: CMDS, history: ["first", "second"] });
    frame = handleInput(frame, "x") as typeof frame;
    frame = handleInput(frame, undefined, { name: "up" }) as typeof frame;
    expect(frame.buffer).toBe("second");
    frame = handleInput(frame, undefined, { name: "up" }) as typeof frame;
    expect(frame.buffer).toBe("first");
    frame = handleInput(frame, undefined, { name: "down" }) as typeof frame;
    expect(frame.buffer).toBe("second");
    frame = handleInput(frame, undefined, { name: "down" }) as typeof frame;
    expect(frame.buffer).toBe("x"); // the draft comes back
  });

  it("lays out boxed composer, ghost, palette, and hint rows", () => {
    let frame = initialFrame({
      model: "OpenCode Big Pickle",
      agent: { name: "build", label: "Build" },
      commands: CMDS,
    });
    const idle = layoutFrame(frame);
    expect(idle[0]).toContain("╭"); // composer box first — rules never redraw
    expect(idle.some((r) => /^─+$/.test(r.trim()))).toBe(false);
    expect(idle.some((r) => r.includes("›"))).toBe(true);
    expect(idle.some((r) => r.includes("Build · OpenCode Big Pickle"))).toBe(true);
    expect(idle[idle.length - 1]).toContain("tab complete");
    frame = handleInput(frame, "/") as typeof frame;
    frame = handleInput(frame, "h") as typeof frame;
    const live = layoutFrame(frame);
    expect(live.some((r) => r.includes("/help") && r.includes("show this palette"))).toBe(true);
    // Ghost shows the remainder of the selected command.
    expect(live.some((r) => r.includes("/h") && r.includes("elp"))).toBe(true);
  });

  it("syncs a fixed input block without leaving stray rows", () => {
    expect(rowsBackToStart(0)).toBe(0);
    expect(rowsBackToStart(6)).toBe(6);
    const writes: string[] = [];
    const stdout = { write: (s: string) => writes.push(s) } as unknown as NodeJS.WriteStream;
    const state = { drawn: 0 };
    drawSyncRows(stdout, state, ["a", "b", "c"]);
    expect(state.drawn).toBe(3);
    clearSyncRows(stdout, state);
    expect(state.drawn).toBe(0);
    // Every palette line got a full-line clear when the block was erased.
    expect(writes.filter((w) => w === "\r\x1b[2K\n")).toHaveLength(3);
  });
});

describe("multiline + bracketed paste", () => {
  const blank = () =>
    initialFrame({ model: "M", agent: { name: "build", label: "Build" }, commands: CMDS });

  it("ctrl+j inserts a newline while enter still sends", () => {
    let frame = handleInput(blank(), "a") as InputFrame;
    frame = handleInput(frame, undefined, { name: "enter" }) as InputFrame;
    frame = handleInput(frame, "b") as InputFrame;
    expect(frame.buffer).toBe("a\nb");
    expect(frame.palette).toEqual([]);
    const submitted = handleInput(frame, undefined, { name: "return" });
    expect(submitted).toBe("a\nb");
  });

  it("insertText splices at the cursor and hides the palette when multiline", () => {
    let frame = handleInput(blank(), "/") as InputFrame;
    expect(frame.palette.length).toBeGreaterThan(0);
    frame = insertText(frame, "pasted\nblock");
    expect(frame.buffer).toBe("/pasted\nblock");
    expect(frame.palette).toEqual([]);
  });

  it("renders continuation lines and keeps ghost single-line", () => {
    const frame = { ...blank(), buffer: "line one\nline two", cursor: 16 };
    const rows = layoutFrame(frame);
    expect(rows.some((row) => row.includes("line one"))).toBe(true);
    expect(rows.some((row) => row.includes("line two"))).toBe(true);
    expect(rows[rows.length - 1]).toContain("ctrl+j");
  });

  it("accumulates a bracketed paste across keypresses into one edit", () => {
    let paste = initialPasteState();
    let fed = feedPasteKey(paste, `${PASTE_START}hello`);
    paste = fed.state;
    expect(fed).toMatchObject({ consumed: true });
    expect(fed.text).toBeUndefined();
    fed = feedPasteKey(paste, " world");
    paste = fed.state;
    expect(fed.consumed).toBe(true);
    fed = feedPasteKey(paste, `!\nsecond line${PASTE_END}`);
    expect(fed).toMatchObject({ consumed: true, text: "hello world!\nsecond line" });
    expect(fed.state.active).toBe(false);
    const frame = insertText(blank(), fed.text ?? "");
    expect(frame.buffer).toBe("hello world!\nsecond line");
  });

  it("handles a single-event paste and ignores ordinary keys", () => {
    const fed = feedPasteKey(initialPasteState(), `${PASTE_START}abc${PASTE_END}`);
    expect(fed).toMatchObject({ consumed: true, text: "abc" });
    expect(feedPasteKey(initialPasteState(), "a")).toMatchObject({ consumed: false });
    expect(feedPasteKey(initialPasteState(), undefined)).toMatchObject({ consumed: false });
  });
});

describe("boxed composer (opencode look)", () => {
  const framed = (buffer: string) => ({
    ...initialFrame({ model: "M", agent: { name: "build", label: "Build" }, commands: CMDS }),
    buffer,
    cursor: buffer.length,
  });

  it("frames the prompt in a box with the footer inside and hints below", () => {
    const rows = layoutFrame(framed("hello"), 40);
    expect(rows[0]?.startsWith("╭")).toBe(true);
    expect(rows.some((row) => row.includes("hello"))).toBe(true);
    expect(rows.some((row) => row.includes("Build · M"))).toBe(true);
    expect(rows[rows.length - 1]).toContain("tab complete");
    for (const row of rows) expect(visibleWidth(row)).toBeLessThanOrEqual(40);
  });

  it("keeps palette rows outside and above the box", () => {
    let frame = handleInput(framed(""), "/") as InputFrame;
    const rows = layoutFrame(frame, 40);
    const boxTop = rows.findIndex((row) => row.startsWith("╭"));
    expect(boxTop).toBeGreaterThan(0);
    expect(rows.slice(0, boxTop).some((row) => row.includes("/model"))).toBe(true);
    for (const row of rows) expect(visibleWidth(row)).toBeLessThanOrEqual(40);
  });

  it("wraps long lines instead of breaking cursor math", () => {
    const rows = layoutFrame(framed(`a${" very long prompt line".repeat(6)}`), 40);
    expect(rows.length).toBeGreaterThan(4);
    for (const row of rows) expect(visibleWidth(row)).toBeLessThanOrEqual(40);
  });

  it("spans the full terminal width like opencode", () => {
    const rows = layoutFrame(framed("hello"), 40);
    const top = rows.findIndex((row) => row.startsWith("╭"));
    const bottom = rows.findIndex((row) => row.startsWith("╰"));
    expect(top).toBeGreaterThanOrEqual(0);
    expect(bottom).toBeGreaterThan(top);
    // Never touch the last column: conhost wraps exact-width writes and
    // every subsequent cursor move lands mid-row.
    for (const row of rows.slice(top, bottom + 1)) expect(visibleWidth(row)).toBe(39);
    for (const row of rows) expect(visibleWidth(row)).toBeLessThanOrEqual(39);
  });

  it("replaces the live block with echo rows on finish (no clear path)", () => {
    const echo = finishRows("hi", "Build", "M", 40);
    expect(echo.some((row) => row.includes("hi"))).toBe(true);
    expect(echo[echo.length - 1]).toContain("enter send");
    for (const row of echo) expect(visibleWidth(row)).toBeLessThanOrEqual(40);
    const multi = finishRows("one\ntwo", "Build", "M", 40);
    expect(multi.some((row) => row.includes("one"))).toBe(true);
    expect(multi.some((row) => row.includes("two"))).toBe(true);
  });
});

describe("readline editing depth", () => {
  const framed = (buffer: string, cursor = buffer.length): InputFrame => ({
    ...initialFrame({ model: "M", agent: { name: "build", label: "Build" }, commands: CMDS }),
    buffer,
    cursor,
  });

  it("computes line spans for multiline buffers", () => {
    expect(lineStart("ab\ncd", 0)).toBe(0);
    expect(lineStart("ab\ncd", 2)).toBe(0);
    expect(lineStart("ab\ncd", 4)).toBe(3);
    expect(lineStart("\nx", 0)).toBe(0);
    expect(lineEnd("ab\ncd", 0)).toBe(2);
    expect(lineEnd("ab\ncd", 3)).toBe(5);
  });

  it("moves to line start and end with home/end and ctrl+a/e", () => {
    expect((handleInput(framed("hello", 3), undefined, { name: "home" }) as InputFrame).cursor).toBe(0);
    expect((handleInput(framed("hello", 0), undefined, { name: "end" }) as InputFrame).cursor).toBe(5);
    expect((handleInput(framed("hello", 3), undefined, { ctrl: true, name: "a" }) as InputFrame).cursor).toBe(0);
    expect((handleInput(framed("hello", 3), undefined, { ctrl: true, name: "e" }) as InputFrame).cursor).toBe(5);
    // Multiline: home/end work on the cursor's line, not the whole buffer.
    expect((handleInput(framed("ab\ncd", 4), undefined, { name: "home" }) as InputFrame).cursor).toBe(3);
    expect((handleInput(framed("ab\ncd", 3), undefined, { name: "end" }) as InputFrame).cursor).toBe(5);
  });

  it("kills to end of line with ctrl+k and joins lines at a line end", () => {
    expect((handleInput(framed("hello", 2), undefined, { ctrl: true, name: "k" }) as InputFrame).buffer).toBe("he");
    expect((handleInput(framed("ab\ncd", 1), undefined, { ctrl: true, name: "k" }) as InputFrame).buffer).toBe("a\ncd");
    expect((handleInput(framed("ab\ncd", 2), undefined, { ctrl: true, name: "k" }) as InputFrame).buffer).toBe("abcd");
  });

  it("deletes forward with the delete key", () => {
    const f = handleInput(framed("abc", 1), undefined, { name: "delete" }) as InputFrame;
    expect(f.buffer).toBe("ac");
    expect(f.cursor).toBe(1);
    expect((handleInput(framed("abc", 3), undefined, { name: "delete" }) as InputFrame).buffer).toBe("abc");
  });

  it("jumps words with ctrl+arrows and alt+b/f, chars with ctrl+b/f", () => {
    expect((handleInput(framed("one two three", 13), undefined, { ctrl: true, name: "left" }) as InputFrame).cursor).toBe(8);
    expect((handleInput(framed("one two three", 8), undefined, { meta: true, name: "b" }) as InputFrame).cursor).toBe(4);
    expect((handleInput(framed("one two three", 0), undefined, { ctrl: true, name: "right" }) as InputFrame).cursor).toBe(3);
    expect((handleInput(framed("one two three", 3), undefined, { meta: true, name: "f" }) as InputFrame).cursor).toBe(7);
    expect((handleInput(framed("ab", 1), undefined, { ctrl: true, name: "b" }) as InputFrame).cursor).toBe(0);
    expect((handleInput(framed("ab", 1), undefined, { ctrl: true, name: "f" }) as InputFrame).cursor).toBe(2);
  });

  it("moves between multiline lines with arrows before touching history", () => {
    let f = framed("long line\nab", 12); // end of "ab"
    f.history = ["older"];
    f.histIndex = 1;
    f = handleInput(f, undefined, { name: "up" }) as InputFrame;
    expect(f.cursor).toBe(2); // column preserved onto "long line"... clamped to col 2
    expect(f.buffer).toBe("long line\nab");
    f = handleInput(f, undefined, { name: "down" }) as InputFrame;
    expect(f.cursor).toBe(12); // clamped to the short line's end
    // From the top line, up now walks history.
    f = handleInput({ ...f, cursor: 2 }, undefined, { name: "up" }) as InputFrame;
    expect(f.buffer).toBe("older");
  });
});

describe("rendered cursor (reverse video)", () => {
  beforeEach(() => {
    vi.stubEnv("ROOK_COLOR", "1");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const framed = (buffer: string, cursor: number): InputFrame => ({
    ...initialFrame({ model: "M", agent: { name: "build", label: "Build" }, commands: CMDS }),
    buffer,
    cursor,
  });

  it("marks the char under a mid-buffer cursor", () => {
    const rows = layoutFrame(framed("hello", 2), 40);
    const line = rows.find((row) => stripAnsi(row).includes("hello"))!;
    expect(line).toContain("he\x1b[7ml\x1b[27mlo");
    for (const row of rows) expect(visibleWidth(row)).toBeLessThanOrEqual(39);
  });

  it("draws a block cell at end of buffer and on the placeholder", () => {
    const rows = layoutFrame(framed("hi", 2), 40);
    expect(rows.some((row) => row.includes("hi\x1b[7m \x1b[27m"))).toBe(true);
    const idle = layoutFrame(framed("", 0), 40);
    expect(idle.some((row) => row.includes("\x1b[7m \x1b[27m"))).toBe(true);
  });

  it("sits on the first ghost character while completing", () => {
    let frame = framed("", 0);
    frame = handleInput(frame, "/") as InputFrame;
    frame = handleInput(frame, "h") as InputFrame;
    const rows = layoutFrame(frame, 40);
    // Ghost "elp": cursor inverts the "e", the rest stays dim.
    expect(rows.some((row) => row.includes("\x1b[7me\x1b[27m"))).toBe(true);
    expect(rows.some((row) => stripAnsi(row).includes("/help"))).toBe(true);
  });

  it("marks the cursor on continuation lines", () => {
    const rows = layoutFrame(framed("one\ntwo", 5), 40);
    const line = rows.find((row) => stripAnsi(row).includes("two"))!;
    expect(line).toContain("t\x1b[7mw\x1b[27mo");
  });
});

describe("paste normalization", () => {
  it("converts pasted CR and CRLF line breaks to LF", () => {
    const fed = feedPasteKey(initialPasteState(), `${PASTE_START}a\rb\r\nc${PASTE_END}`);
    expect(fed.text).toBe("a\nb\nc");
    let paste = initialPasteState();
    let step = feedPasteKey(paste, `${PASTE_START}x\r`);
    step = feedPasteKey(step.state, `y${PASTE_END}`);
    expect(step.text).toBe("x\ny");
  });
});

describe("askInput on a fake TTY (hermetic end-to-end)", () => {
  type FakeIn = NodeJS.ReadStream & EventEmitter;
  type FakeOut = NodeJS.WriteStream & EventEmitter;
  const fakeTty = (): { stdin: FakeIn; stdout: FakeOut; writes: string[] } => {
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
      columns: 40,
      write: (chunk: string) => {
        writes.push(String(chunk));
        return true;
      },
    });
    return { stdin, stdout, writes };
  };
  const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  it("returns null off-TTY so the REPL can fall back to readline", async () => {
    const { stdin, stdout } = fakeTty();
    (stdin as { isTTY: boolean }).isTTY = false;
    await expect(askInput({ model: "M", stdin, stdout })).resolves.toBeNull();
  });

  it("types through the real keypress decoder and submits on enter", async () => {
    const { stdin, stdout, writes } = fakeTty();
    const p = askInput({ model: "M", agent: { name: "build", label: "Build" }, stdin, stdout });
    stdin.emit("data", Buffer.from("hi\r"));
    await expect(p).resolves.toBe("hi");
    const all = writes.join("");
    expect(all).toContain("\x1b[?2004h"); // bracketed paste on
    expect(all).toContain("\x1b[?25l"); // hardware cursor hidden
    expect(all).toContain("\x1b[?2004l"); // …and both restored at finish
    expect(all).toContain("\x1b[?25h");
    expect(stripAnsi(all)).toContain("hi");
  });

  it("clears on ctrl+c with text and exits on ctrl+c when empty", async () => {
    const { stdin, stdout } = fakeTty();
    const p = askInput({ model: "M", stdin, stdout });
    stdin.emit("data", Buffer.from("ab"));
    stdin.emit("data", Buffer.from("\x03")); // clears "ab"
    stdin.emit("data", Buffer.from("\x03")); // empty now: exits
    await expect(p).resolves.toBe("exit");
  });

  it("mutes the composer while the picker is open and keeps keys apart", async () => {
    const { stdin, stdout, writes } = fakeTty();
    let resolvePick: (value: string | undefined) => void = () => {};
    const p = askInput({
      model: "M",
      stdin,
      stdout,
      pickModel: () => new Promise((resolve) => (resolvePick = resolve)),
    });
    stdin.emit("data", Buffer.from("\x0e")); // ctrl+n opens the picker
    stdin.emit("data", Buffer.from("zzz")); // picker keys must not leak in
    resolvePick("M2");
    await tick();
    stdin.emit("data", Buffer.from("ok\r"));
    await expect(p).resolves.toBe("ok"); // not "zzzok"
    expect(stripAnsi(writes.join(""))).toContain("M2"); // model swap rendered
  });

  it("abandons the block and redraws fresh on resize (never desyncs)", async () => {
    const { stdin, stdout, writes } = fakeTty();
    const p = askInput({ model: "M", stdin, stdout });
    stdin.emit("data", Buffer.from("a"));
    stdout.emit("resize");
    expect(writes.join("")).toContain("\r\x1b[J");
    stdin.emit("data", Buffer.from("\r"));
    await expect(p).resolves.toBe("a");
  });

  it("keeps a pasted enter from submitting through the real event path", async () => {
    const { stdin, stdout } = fakeTty();
    const p = askInput({ model: "M", stdin, stdout });
    stdin.emit("keypress", undefined, { sequence: `\x1b[200~one\rtwo\x1b[201~` });
    stdin.emit("data", Buffer.from("\r"));
    await expect(p).resolves.toBe("one\ntwo");
  });
});

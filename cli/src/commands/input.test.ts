import { describe, expect, it } from "vitest";

import {
  clearRows,
  drawRows,
  feedPasteKey,
  handleInput,
  initialFrame,
  initialPasteState,
  insertText,
  isModelArg,
  layoutFrame,
  modelMatches,
  paletteRows,
  PASTE_END,
  PASTE_START,
  slashMatches,
  type InputFrame,
} from "./input.js";
import { clearRows as clearSyncRows, drawRows as drawSyncRows, rowsBackToStart } from "../ui.js";

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

  it("lays out prompt, ghost, palette, and footer rows without rules", () => {
    let frame = initialFrame({
      model: "OpenCode Big Pickle",
      agent: { name: "build", label: "Build" },
      commands: CMDS,
    });
    const idle = layoutFrame(frame);
    expect(idle[0]).toContain("❯"); // prompt first — rules never redraw
    expect(idle.some((r) => r.includes("─"))).toBe(false);
    expect(idle[idle.length - 1]).toContain("enter send");
    expect(idle[idle.length - 1]).toContain("Build · OpenCode Big Pickle");
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
    expect(rows[0]).toContain("line one");
    expect(rows[1]).toContain("line two");
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

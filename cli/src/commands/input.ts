/**
 * Chat input: slash palette, ghost completion, model and agent pickers,
 * history, editing. All state transitions are pure (functions take a
 * frame, return a frame or an action); only `askInput` touches stdin.
 *
 * Behavior (OpenCode-shaped where it applies):
 * - Live palette: typing `/` filters commands inline, `›` marks selection.
 * - Tab completes the first palette entry (or `shift+tab` cycles models).
 * - Arrow keys move through the palette and input history.
 * - Ctrl+N opens the model picker (arrow keys + enter or esc).
 * - Ctrl+J inserts a newline (multiline); Enter always sends.
 * - Bracketed paste inserts as one edit — pasting never submits mid-paste.
 * - Ctrl+D exits; Esc clears input; Ctrl+U/W strip input.
 */

import { emitKeypressEvents } from "node:readline";

import { c, clearRows, drawRows, footerRow, promptGlyph, selectGlyph } from "../ui.js";

export type Suggestion = { command: string; description: string; hint?: string };

/** A `/model` command never ships a literal placeholder to the parser. */
export const MODEL_ARG_HINT = "<id>";

export const isModelArg = (value: string | undefined): boolean =>
  (value ?? "").trim().toLowerCase() === MODEL_ARG_HINT;

export type Agent = { name: string; label?: string };

export const slashMatches = (commands: Suggestion[], text: string): Suggestion[] =>
  text.startsWith("/")
    ? commands.filter((cmd) => cmd.command.toLowerCase().startsWith(text.toLowerCase()))
    : [];

export const modelMatches = (models: Suggestion[], query: string): Suggestion[] => {
  const q = query.trim().toLowerCase();
  return q
    ? models.filter(
        (m) => m.command.toLowerCase().includes(q) || m.description.toLowerCase().includes(q),
      )
    : models;
};

export function paletteRows(items: Suggestion[], selected: number, windowSize = 5): string[] {
  if (!items.length) return [];
  const start = Math.max(
    0,
    Math.min(selected - Math.floor(windowSize / 2), items.length - windowSize),
  );
  return items.slice(start, start + windowSize).map((item, i) => {
    const picked = start + i === selected;
    const head = item.command === "/model" && item.hint ? `${item.command} ${item.hint}` : item.command;
    const text = `${head}  ${item.description}`;
    return picked ? `${c("orange", selectGlyph())} ${text}` : c("dim", `  ${text}`);
  });
}

export type InputFrame = {
  buffer: string;
  cursor: number;
  agent: Agent;
  model: string;
  commands: Suggestion[];
  palette: Suggestion[];
  palSel: number;
  history: string[];
  histIndex: number;
  draft: string;
};

/** Insert arbitrary text at the cursor (single chars and paste blocks share it). */
export function insertText(frame: InputFrame, text: string): InputFrame {
  const f = { ...frame };
  f.buffer = f.buffer.slice(0, f.cursor) + text + f.buffer.slice(f.cursor);
  f.cursor += text.length;
  // The slash palette is a single-line affair; multiline buffers hide it.
  f.palette = f.buffer.includes("\n") ? [] : slashMatches(f.commands, f.buffer);
  f.palSel = 0;
  return f;
}

/** Bracketed-paste markers. Terminals that lack support never send them. */
export const PASTE_START = "[200~";
export const PASTE_END = "[201~";

export type PasteState = { active: boolean; buffer: string };

export const initialPasteState = (): PasteState => ({ active: false, buffer: "" });

/**
 * Pure bracketed-paste reducer over keypress `sequence` strings. Consumed
 * bytes must never reach handleInput (a pasted Enter must not submit).
 * Prefix bytes before a mid-event START marker are dropped and documented —
 * terminals deliver markers as discrete events in practice.
 */
export function feedPasteKey(
  state: PasteState,
  sequence: string | undefined,
): { state: PasteState; consumed: boolean; text?: string } {
  if (sequence === undefined) return { state, consumed: false };
  if (!state.active) {
    const start = sequence.indexOf(PASTE_START);
    if (start === -1) return { state, consumed: false };
    const after = sequence.slice(start + PASTE_START.length);
    const end = after.indexOf(PASTE_END);
    if (end !== -1) return { state, consumed: true, text: after.slice(0, end) };
    return { state: { active: true, buffer: after }, consumed: true };
  }
  const end = sequence.indexOf(PASTE_END);
  if (end === -1) {
    return { state: { active: true, buffer: state.buffer + sequence }, consumed: true };
  }
  return {
    state: { active: false, buffer: "" },
    consumed: true,
    text: state.buffer + sequence.slice(0, end),
  };
}

export const initialFrame = (opts: {
  agent?: Agent;
  model: string;
  commands?: Suggestion[];
  history?: string[];
}): InputFrame => ({
  buffer: "",
  cursor: 0,
  agent: opts.agent ?? { name: "build" },
  model: opts.model,
  commands: opts.commands ?? [],
  palette: [],
  palSel: 0,
  history: opts.history ?? [],
  histIndex: Math.max(0, (opts.history ?? []).length),
  draft: "",
});

/** Pure keypress step: next frame, submitted line, or an action token. */
export function handleInput(
  frame: InputFrame,
  ch: string | undefined,
  key: { name?: string; ctrl?: boolean; meta?: boolean; sequence?: string } = {},
): InputFrame | string | { type: "exit" } | { type: "pick" } {
  const name = key.name ?? "";
  const f = { ...frame };
  if (key.ctrl && name === "d") return { type: "exit" };
  if (key.ctrl && name === "n") return { type: "pick" };
  if (name === "escape") {
    f.buffer = "";
    f.cursor = 0;
    f.palette = [];
    return f;
  }
  /** Exact typed match submits; a partial one completes to the selection. */
  const paletteCommit = (submitExact: boolean): InputFrame | string => {
    f.palSel = Math.min(f.palSel, f.palette.length - 1);
    if (submitExact && f.palette[f.palSel]!.command === f.buffer) return f.buffer;
    f.buffer = `${f.palette[f.palSel]!.command} `;
    f.cursor = f.buffer.length;
    f.palette = slashMatches(f.commands, f.buffer);
    f.palSel = 0;
    return f;
  };
  if (name === "return") {
    if (f.palette.length && f.buffer.startsWith("/")) return paletteCommit(true);
    return f.buffer.trim();
  };
  // Ctrl+J arrives as LF ("enter"); CR ("return") above always sends.
  if (name === "enter") {
    return insertText(f, "\n");
  }
  if (name === "tab") {
    if (f.palette.length && f.buffer.startsWith("/")) return paletteCommit(false);
    return f;
  }
  if (name === "up") {
    if (f.palette.length && f.buffer.startsWith("/")) {
      f.palSel = Math.max(0, f.palSel - 1);
      return f;
    }
    if (f.histIndex > 0) {
      if (f.histIndex === f.history.length) f.draft = f.buffer;
      f.histIndex -= 1;
      f.buffer = f.history[f.histIndex] ?? f.buffer;
      f.cursor = f.buffer.length;
    }
    return f;
  }
  if (name === "down") {
    if (f.palette.length && f.buffer.startsWith("/")) {
      f.palSel = Math.min(f.palette.length - 1, f.palSel + 1);
      return f;
    }
    if (f.histIndex < f.history.length) {
      f.histIndex += 1;
      f.buffer = f.histIndex === f.history.length ? f.draft : (f.history[f.histIndex] ?? "");
      f.cursor = f.buffer.length;
    }
    return f;
  }
  if (name === "backspace") {
    if (f.cursor > 0) {
      f.buffer = f.buffer.slice(0, f.cursor - 1) + f.buffer.slice(f.cursor);
      f.cursor -= 1;
    }
    f.palette = slashMatches(f.commands, f.buffer);
    f.palSel = 0;
    return f;
  }
  if (key.ctrl && name === "u") {
    f.buffer = f.buffer.slice(f.cursor);
    f.cursor = 0;
    f.palette = slashMatches(f.commands, f.buffer);
    return f;
  }
  if (key.ctrl && name === "w") {
    const head = f.buffer.slice(0, f.cursor);
    const start = head.replace(/\s+$/, "").lastIndexOf(" ") + 1;
    f.buffer = head.slice(0, start) + f.buffer.slice(f.cursor);
    f.cursor = start;
    f.palette = slashMatches(f.commands, f.buffer);
    return f;
  }
  if (name === "left") {
    f.cursor = Math.max(0, f.cursor - 1);
    return f;
  }
  if (name === "right") {
    f.cursor = Math.min(f.buffer.length, f.cursor + 1);
    return f;
  }
  if (!key.ctrl && !key.meta && ch && ch.length === 1) {
    return insertText(f, ch);
  }
  return f;
}

/**
 * Screen rows for a frame: palette rows above the `❯` prompt (if any), the
 * prompt with ghost text, and the prompt footer (agent/model). No repeated
 * per-keystroke rules — render/sync fully owns the fixed input block.
 */
export function layoutFrame(frame: InputFrame): string[] {
  const rows: string[] = [];
  if (frame.palette.length) rows.push(...paletteRows(frame.palette, frame.palSel));
  const promptLines = frame.buffer.split("\n");
  const ghost =
    promptLines.length === 1 && frame.buffer.startsWith("/") && frame.palette.length
      ? frame.palette[frame.palSel]!.command.slice(frame.buffer.length)
      : "";
  rows.push(`${c("mint", promptGlyph())} ${promptLines[0]}${ghost ? c("dim", ghost) : ""}`);
  for (const continuation of promptLines.slice(1)) rows.push(`  ${continuation}`);
  rows.push(footerRow("enter send · ctrl+j newline", `${frame.agent.label ?? frame.agent.name} · ${frame.model}`));
  return rows;
}

export type AskInputOptions = {
  model: string;
  agent?: Agent;
  commands?: Suggestion[];
  history?: string[];
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
  /** Ctrl+N model picker; returns a new model id (or undefined). */
  pickModel?: () => Promise<string | undefined>;
};

/**
 * One live input round on a TTY; returns null when not interactive
 * (the REPL falls back to readline). Result is the submitted line, or
 * "exit" for Ctrl+D.
 */
export async function askInput(opts: AskInputOptions): Promise<string | "exit" | null> {
  const stdin = opts.stdin ?? process.stdin;
  const stdout = opts.stdout ?? process.stdout;
  if (!stdin.isTTY || !stdout.isTTY) return null;
  const frame = initialFrame({
    agent: opts.agent,
    model: opts.model,
    commands: opts.commands,
    history: opts.history,
  });
  let drawn = 0;
  const render = (): void => {
    const rows = layoutFrame(frame);
    const state = { drawn };
    drawRows(stdout, state, rows);
    drawn = state.drawn;
  };
  const unrender = (): void => {
    const state = { drawn };
    clearRows(stdout, state);
    drawn = state.drawn;
  };
  return new Promise((resolve) => {
    let paste = initialPasteState();
    const finish = (line: string | "exit"): void => {
      stdin.removeListener("keypress", onKeyWrap);
      stdin.setRawMode(false);
      stdin.pause();
      try {
        stdout.write("[?2004l");
      } catch {
        // Terminals without bracketed paste ignore the reset too.
      }
      unrender();
      if (line !== "exit") {
        stdout.write(`${c("mint", promptGlyph())} ${line}\n`);
        stdout.write(footerRow("enter send", `${frame.agent.label ?? frame.agent.name} · ${frame.model}`) + "\n");
      }
      resolve(line);
    };
    const onKey = async (ch: string | undefined, key: { name?: string; ctrl?: boolean; meta?: boolean; sequence?: string }): Promise<void> => {
      if (key.ctrl && key.name === "c") {
        // Mid-input Ctrl+C clears rather than killing the REPL.
        frame.buffer = "";
        frame.cursor = 0;
        frame.palette = [];
        render();
        return;
      }
      if (key.ctrl && key.name === "n" && opts.pickModel) {
        const next = await opts.pickModel();
        if (next) frame.model = next;
        render();
        return;
      }
      const next = handleInput(frame, ch, { name: key.name, ctrl: key.ctrl, meta: key.meta, sequence: key.sequence });
      if (typeof next === "string") return finish(next);
      if ("type" in next && next.type === "exit") return finish("exit");
      if ("type" in next && next.type === "pick") {
        // Model pick without a picker: no-op (palette covers commands).
        render();
        return;
      }
      Object.assign(frame, next);
      render();
    };
    const onKeyWrap = (ch: string | undefined, key: { name?: string; ctrl?: boolean; meta?: boolean; sequence?: string }): void => {
      // Bracketed paste wins over every binding: pasted bytes (including
      // Enter) accumulate until the end marker, then insert as one edit.
      const fed = feedPasteKey(paste, key.sequence);
      paste = fed.state;
      if (fed.consumed) {
        if (fed.text) Object.assign(frame, insertText(frame, fed.text));
        render();
        return;
      }
      void onKey(ch, key);
    };
    stdin.setRawMode(true);
    stdin.resume();
    emitKeypressEvents(stdin);
    stdin.on("keypress", onKeyWrap);
    try {
      stdout.write("[?2004h");
    } catch {
      // Terminals without bracketed paste ignore the mode set.
    }
    render();
  });
}

// Re-exported at the module edge so tests pin the shared sync primitive,
// while input.ts keeps a single canonical import site.
export { clearRows, drawRows, rowsBackToStart } from "../ui.js";

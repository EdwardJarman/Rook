/**
 * Chat input: slash palette, ghost completion, model and agent pickers,
 * history, editing. All state transitions are pure (functions take a
 * frame, return a frame or an action); only `askInput` touches stdin.
 *
 * Behavior (OpenCode-shaped where it applies):
 * - Live palette: typing `/` filters commands inline, `›` marks selection.
 * - Tab completes the first palette entry (or `shift+tab` cycles models).
 * - Arrow keys move through the palette, multiline lines, and history.
 * - Ctrl+N opens the model picker (arrow keys + enter or esc).
 * - Ctrl+J inserts a newline (multiline); Enter always sends.
 * - Bracketed paste inserts as one edit — pasting never submits mid-paste.
 * - Ctrl+D exits; Esc clears input; Ctrl+U/W/K strip input.
 * - Readline depth: home/end/ctrl+a/e, ctrl+b/f, ctrl+←/→ and alt+b/f word
 *   jumps, delete forward. The cursor cell renders in reverse video — the
 *   hardware cursor parks below the block, so this is the only visible one.
 */

import { emitKeypressEvents } from "node:readline";

import { asciiMode, c, footerRow, invert, promptGlyph, selectGlyph, syncRows, terminalWidth, truncate, visibleWidth, wrapAnsi } from "../ui.js";

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
export const PASTE_START = "\x1b[200~";
export const PASTE_END = "\x1b[201~";

export type PasteState = { active: boolean; buffer: string };

export const initialPasteState = (): PasteState => ({ active: false, buffer: "" });

/**
 * Pure bracketed-paste reducer over keypress `sequence` strings. Consumed
 * bytes must never reach handleInput (a pasted Enter must not submit).
 * Prefix bytes before a mid-event START marker are dropped and documented —
 * terminals deliver markers as discrete events in practice.
 *
 * Terminals paste line breaks as CR (or CRLF); a raw `\r` in the buffer
 * resets the column on every redraw, so paste text normalizes them to `\n`.
 */
const normalizePaste = (text: string): string => text.replace(/\r\n?/g, "\n");

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
    if (end !== -1) return { state, consumed: true, text: normalizePaste(after.slice(0, end)) };
    return { state: { active: true, buffer: after }, consumed: true };
  }
  const end = sequence.indexOf(PASTE_END);
  if (end === -1) {
    return { state: { active: true, buffer: state.buffer + sequence }, consumed: true };
  }
  return {
    state: { active: false, buffer: "" },
    consumed: true,
    text: normalizePaste(state.buffer + sequence.slice(0, end)),
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

/** Start of the line the cursor sits on (multiline-aware, pure). */
export const lineStart = (buffer: string, pos: number): number =>
  pos <= 0 ? 0 : buffer.lastIndexOf("\n", pos - 1) + 1;

/** End of the line the cursor sits on (index of the `\n`, or buffer end). */
export const lineEnd = (buffer: string, pos: number): number => {
  const next = buffer.indexOf("\n", pos);
  return next === -1 ? buffer.length : next;
};

const wordLeft = (buffer: string, pos: number): number => {
  let i = pos;
  while (i > 0 && /\s/.test(buffer[i - 1]!)) i -= 1;
  while (i > 0 && !/\s/.test(buffer[i - 1]!)) i -= 1;
  return i;
};

const wordRight = (buffer: string, pos: number): number => {
  let i = pos;
  while (i < buffer.length && /\s/.test(buffer[i]!)) i += 1;
  while (i < buffer.length && !/\s/.test(buffer[i]!)) i += 1;
  return i;
};

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
    // In a multiline buffer the arrow moves between lines first; history
    // takes over only from the top line (the readline/opencode order).
    const start = lineStart(f.buffer, f.cursor);
    if (start > 0) {
      const col = f.cursor - start;
      const prevStart = lineStart(f.buffer, start - 1);
      f.cursor = Math.min(prevStart + col, start - 1);
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
    const end = lineEnd(f.buffer, f.cursor);
    if (end < f.buffer.length) {
      const col = f.cursor - lineStart(f.buffer, f.cursor);
      const nextStart = end + 1;
      f.cursor = Math.min(nextStart + col, lineEnd(f.buffer, nextStart));
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
  // Kill to end of line; at a line end it joins the next line (readline).
  if (key.ctrl && name === "k") {
    const end = lineEnd(f.buffer, f.cursor);
    f.buffer =
      f.cursor === end && end < f.buffer.length
        ? f.buffer.slice(0, f.cursor) + f.buffer.slice(f.cursor + 1)
        : f.buffer.slice(0, f.cursor) + f.buffer.slice(end);
    f.palette = f.buffer.includes("\n") ? [] : slashMatches(f.commands, f.buffer);
    f.palSel = 0;
    return f;
  }
  if (name === "delete") {
    if (f.cursor < f.buffer.length) {
      f.buffer = f.buffer.slice(0, f.cursor) + f.buffer.slice(f.cursor + 1);
    }
    f.palette = f.buffer.includes("\n") ? [] : slashMatches(f.commands, f.buffer);
    f.palSel = 0;
    return f;
  }
  if (name === "home" || (key.ctrl && name === "a")) {
    f.cursor = lineStart(f.buffer, f.cursor);
    return f;
  }
  if (name === "end" || (key.ctrl && name === "e")) {
    f.cursor = lineEnd(f.buffer, f.cursor);
    return f;
  }
  // Word jumps: ctrl+arrows (Windows muscle memory) and alt+b/f (emacs).
  if ((key.ctrl && name === "left") || (key.meta && name === "b")) {
    f.cursor = wordLeft(f.buffer, f.cursor);
    return f;
  }
  if ((key.ctrl && name === "right") || (key.meta && name === "f")) {
    f.cursor = wordRight(f.buffer, f.cursor);
    return f;
  }
  if (name === "left" || (key.ctrl && name === "b")) {
    f.cursor = Math.max(0, f.cursor - 1);
    return f;
  }
  if (name === "right" || (key.ctrl && name === "f")) {
    f.cursor = Math.min(f.buffer.length, f.cursor + 1);
    return f;
  }
  if (!key.ctrl && !key.meta && ch && ch.length === 1) {
    return insertText(f, ch);
  }
  return f;
}

/**
 * Screen rows for a frame (opencode order): palette rows above the composer,
 * the composer as a rounded box (prompt lines + `agent · model` footer
 * inside), and a dim hint bar below. Every row is width-capped so wrapped
 * lines can never desync the redraw math. Pass `width` in tests for
 * deterministic rows.
 */
export function layoutFrame(frame: InputFrame, width?: number): string[] {
  // One column short of the terminal: writing into the last column wraps
  // on conhost and every later cursor move lands mid-row.
  const target = Math.max(20, (width ?? terminalWidth()) - 1);
  const e = asciiMode()
    ? { tl: "+", tr: "+", bl: "+", br: "+", h: "-", v: "|" }
    : { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│" };
  const rows: string[] = [];
  if (frame.palette.length) {
    for (const row of paletteRows(frame.palette, frame.palSel)) {
      rows.push(truncate(row, target));
    }
  }
  const promptLines = frame.buffer.split("\n");
  const ghost =
    promptLines.length === 1 && frame.buffer.startsWith("/") && frame.palette.length
      ? frame.palette[frame.palSel]!.command.slice(frame.buffer.length)
      : "";
  // The hardware cursor parks below the live block, so the composer draws
  // its own: a reverse-video cell at the logical cursor. Pure string math —
  // stripAnsi removes the marker, so every width computation stays exact.
  const cursor = Math.max(0, Math.min(frame.cursor, frame.buffer.length));
  const cLine = frame.buffer.slice(0, cursor).split("\n").length - 1;
  const cCol = cursor - lineStart(frame.buffer, cursor);
  const withCursor = (line: string, col: number): string =>
    col < line.length
      ? `${line.slice(0, col)}${invert(line[col]!)}${line.slice(col + 1)}`
      : `${line}${invert(" ")}`;
  const content: string[] = [];
  if (!frame.buffer && !frame.palette.length) {
    content.push(`${c("mint", promptGlyph())} ${invert(" ")}${c("dim", "Ask anything...")}`);
  } else {
    const first = promptLines[0] ?? "";
    let firstOut: string;
    if (cLine === 0 && cCol === first.length && ghost) {
      // Cursor sits on the first ghost character, opencode-style.
      firstOut = `${first}${invert(ghost[0]!)}${c("dim", ghost.slice(1))}`;
    } else if (cLine === 0) {
      firstOut = `${withCursor(first, cCol)}${ghost ? c("dim", ghost) : ""}`;
    } else {
      firstOut = `${first}${ghost ? c("dim", ghost) : ""}`;
    }
    content.push(`${c("mint", promptGlyph())} ${firstOut}`);
    promptLines.slice(1).forEach((continuation, i) => {
      content.push(`  ${cLine === i + 1 ? withCursor(continuation, cCol) : continuation}`);
    });
  }
  content.push(c("dim", `${frame.agent.label ?? frame.agent.name} · ${frame.model}`));
  // Full-width body: wrap each content line to the inner width, pad every
  // row to exact columns — opencode's composer shape, desync-proof.
  const inner = target - 2;
  const pad = target - 4;
  const body: string[] = [];
  for (const line of content) {
    for (const part of wrapAnsi(line, pad)) {
      body.push(` ${part}${" ".repeat(Math.max(0, pad - visibleWidth(part)))} `);
    }
  }
  rows.push(e.tl + e.h.repeat(inner) + e.tr);
  for (const line of body) rows.push(`${e.v}${line}${e.v}`);
  rows.push(e.bl + e.h.repeat(inner) + e.br);
  rows.push(truncate(c("dim", "/ commands · tab complete · ctrl+j newline · ctrl+n models · ctrl+d exit"), target));
  return rows;
}

/**
 * Scrollback echo for a submitted line: prompt rows plus the send footer,
 * each width-capped so physical rows equal logical rows. finish() syncs
 * these through syncRows — the live block is replaced, never cleared then
 * reprinted, so no stale row can survive by construction.
 */
export function finishRows(line: string, agent: string, model: string, width?: number): string[] {
  const target = Math.max(20, (width ?? terminalWidth()) - 1);
  const rows: string[] = [];
  for (const part of line.split("\n")) {
    rows.push(...wrapAnsi(`${c("mint", promptGlyph())} ${part}`, target));
  }
  rows.push(footerRow("enter send", `${agent} · ${model}`, target));
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
    syncRows(stdout, state, rows);
    drawn = state.drawn;
  };
  return new Promise((resolve) => {
    let paste = initialPasteState();
    let picking = false;
    // The composer draws its own cursor cell; the hardware cursor is hidden
    // for the round. `showCursor` also rides a process exit listener so a
    // mid-input kill can never leave the terminal cursorless.
    const showCursor = (): void => {
      try {
        stdout.write("\x1b[?25h");
      } catch {
        // A dead stream at exit time has nothing left to restore.
      }
    };
    // A resize reflows the old block unpredictably — no cursor math can
    // repair it. Abandon it (clear from the cursor down) and draw a fresh
    // block: visually blunt, but it can never desync by construction.
    const onResize = (): void => {
      drawn = 0;
      try {
        stdout.write("\r\x1b[J");
      } catch {
        // Stream gone mid-resize: the next render will fail loudly instead.
      }
      render();
    };
    const finish = (line: string | "exit"): void => {
      stdin.removeListener("keypress", onKeyWrap);
      stdout.removeListener("resize", onResize);
      process.removeListener("exit", showCursor);
      stdin.setRawMode(false);
      stdin.pause();
      try {
        stdout.write("\x1b[?2004l");
      } catch {
        // Terminals without bracketed paste ignore the reset too.
      }
      // The live block becomes the echo: same sync math, so the submit
      // path keeps no separate clear step that could orphan a row.
      const state = { drawn };
      if (line !== "exit") {
        syncRows(stdout, state, finishRows(line, frame.agent.label ?? frame.agent.name, frame.model));
      } else {
        syncRows(stdout, state, []);
      }
      drawn = state.drawn;
      showCursor();
      resolve(line);
    };
    const onKey = async (ch: string | undefined, key: { name?: string; ctrl?: boolean; meta?: boolean; sequence?: string }): Promise<void> => {
      if (key.ctrl && key.name === "c") {
        // Readline semantics: Ctrl+C clears the line; on an already-empty
        // line it exits (so ctrl+c ctrl+c always gets you out).
        if (!frame.buffer) return finish("exit");
        frame.buffer = "";
        frame.cursor = 0;
        frame.palette = [];
        render();
        return;
      }
      if (key.ctrl && key.name === "n" && opts.pickModel) {
        // The picker owns stdin while open: our listener stays attached but
        // inert (`picking`), otherwise arrows drove the picker AND history
        // at once, interleaving writes into garble.
        picking = true;
        let next: string | undefined;
        try {
          next = await opts.pickModel();
        } finally {
          picking = false;
        }
        if (next) frame.model = next;
        // The picker's finish() dropped raw mode and paused stdin — restore
        // our round or the composer comes back dead (cooked echo, no keys).
        stdin.setRawMode(true);
        stdin.resume();
        try {
          stdout.write("\x1b[?25l");
        } catch {
          // Cursor stays visible; rendering still works.
        }
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
      if (picking) return;
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
      stdout.write("\x1b[?2004h\x1b[?25l");
    } catch {
      // Terminals without bracketed paste ignore the mode set.
    }
    process.once("exit", showCursor);
    stdout.on("resize", onResize);
    render();
  });
}

// Re-exported at the module edge so tests pin the shared sync primitive,
// while input.ts keeps a single canonical import site.
export { clearRows, drawRows, rowsBackToStart } from "../ui.js";

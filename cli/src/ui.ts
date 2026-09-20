/**
 * Rook terminal design system: the visual language of OpenCode and Claude
 * Code (rounded panels, statusline, tool rows, slash palette, streaming
 * markdown) fused onto Rook's mint accent — with zero dependencies.
 *
 * Every helper is pure except the spinner (explicit start/stop on an
 * injected stream, so tests never touch a TTY). All styling degrades:
 * NO_COLOR or a pipe strips every escape code, leaving clean plain text.
 */

export type ColorName = "mint" | "dim" | "text" | "amber" | "coral" | "cyan" | "orange";

const CODES: Record<ColorName, string> = {
  mint: "\x1b[32m",
  dim: "\x1b[2m",
  text: "",
  amber: "\x1b[33m",
  coral: "\x1b[31m",
  cyan: "\x1b[36m",
  orange: "\x1b[38;5;208m",
};

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

export const colorsEnabled = (): boolean => {
  if (process.env.ROOK_COLOR === "0" || process.env.NO_COLOR !== undefined) return false;
  if (process.env.ROOK_COLOR === "1") return true;
  return Boolean(process.stdout.isTTY);
};

export const c = (color: ColorName, text: string): string =>
  colorsEnabled() && color !== "text" ? `${CODES[color]}${text}${RESET}` : text;

export const bold = (text: string): string =>
  colorsEnabled() ? `${BOLD}${text}${RESET}` : text;

/** Strip ANSI escapes (tests, width math, piped output). */
export const stripAnsi = (text: string): string =>
  // eslint-disable-next-line no-control-regex
  text.replace(/\x1b\[[0-9;]*m/g, "");

export const visibleWidth = (text: string): number => stripAnsi(text).length;

export const truncate = (text: string, width: number): string => {
  if (visibleWidth(text) <= width) return text;
  const plain = stripAnsi(text);
  return `${plain.slice(0, Math.max(0, width - 1))}…`;
};

const termWidth = (): number => {
  const columns = process.stdout.columns;
  return typeof columns === "number" && columns > 20 ? columns : 80;
};

/**
 * Rounded panel: title sits in the top border, body lines padded.
 * Long lines wrap at the panel width; everything stays ASCII-safe
 * except the border glyphs themselves.
 */
export function box(opts: {
  title?: string;
  lines: string[];
  width?: number;
  padding?: number;
}): string {
  const padding = opts.padding ?? 1;
  const maxWidth = Math.min(opts.width ?? termWidth(), termWidth()) - 2 - padding * 2;
  const wrapped: string[] = [];
  for (const line of opts.lines) {
    if (!stripAnsi(line)) {
      wrapped.push("");
      continue;
    }
    wrapped.push(...wrapAnsi(line, maxWidth));
  }
  const inner = Math.max(
    ...(opts.title ? [visibleWidth(opts.title) + 4] : [0]),
    ...wrapped.map(visibleWidth),
    1,
  );
  const contentWidth = Math.min(inner, maxWidth);
  const top =
    opts.title && opts.title
      ? `╭─ ${opts.title} ${"─".repeat(Math.max(0, contentWidth - visibleWidth(opts.title) - 1))}╮`
      : `╭${"─".repeat(contentWidth + padding * 2)}╮`;
  const bottom = `╰${"─".repeat(contentWidth + padding * 2)}╯`;
  const pad = " ".repeat(padding);
  const body = wrapped.map((line) => {
    const gap = " ".repeat(Math.max(0, contentWidth - visibleWidth(line)));
    return `│${pad}${line}${gap}${pad}│`;
  });
  return [top, ...body, bottom].join("\n");
}

/**
 * Greedy ANSI-aware wrap: escape sequences ride along with the text they
 * style, so bold/code survive line breaks and widths stay exact.
 */
export function wrapAnsi(line: string, maxWidth: number): string[] {
  if (visibleWidth(line) <= maxWidth) return [line];
  const tokens = line.split(/(\x1b\[[0-9;]*m)/g).filter((part) => part !== "");
  const rows: string[] = [];
  let row = "";
  let width = 0;
  let active = "";
  const pushRow = (): void => {
    rows.push(active ? `${row}${RESET}` : row);
    row = active;
    width = 0;
  };
  for (const token of tokens) {
    // eslint-disable-next-line no-control-regex
    if (/^\x1b\[[0-9;]*m$/.test(token)) {
      row += token;
      active = token === RESET ? "" : token;
      continue;
    }
    for (const ch of token) {
      if (width + 1 > maxWidth) pushRow();
      row += ch;
      width += 1;
    }
  }
  rows.push(row);
  return rows;
}

/** Faint divider, optional centered label. */
export const rule = (label = ""): string => {
  const width = termWidth();
  if (!label) return c("dim", "─".repeat(width));
  const text = ` ${label} `;
  const side = Math.max(0, Math.floor((width - visibleWidth(text)) / 2));
  return c("dim", `${"─".repeat(side)}${text}${"─".repeat(Math.max(0, width - side - visibleWidth(text)))}`);
};

/** Persistent session strip: model · directory · context. Claude-style. */
export const statusline = (parts: Array<string | undefined | null>): string => {
  const items = parts.filter((part): part is string => Boolean(part && part.trim()));
  if (!items.length) return "";
  return c("dim", items.join(" · "));
};

/** Tool activity row: ⏺ while running, ✓/✗ after — nested detail on ⎿. */
export function toolRow(
  title: string,
  state: "running" | "done" | "error" = "running",
  detail?: string,
): string {
  const glyph = state === "done" ? c("mint", "✓") : state === "error" ? c("coral", "✗") : c("cyan", "⏺");
  const lines = [`${glyph} ${title}`];
  if (detail) lines.push(c("dim", `  ⎿ ${detail}`));
  return lines.join("\n");
}

/** Welcome banner: wordmark + version chip + model line. */
export function banner(version: string, model?: string): string {
  const head = `${c("mint", bold("◈ Rook"))}  ${c("dim", `v${version}`)}`;
  const sub = model ? c("dim", `model ${model} · /help for commands`) : c("dim", "/help for commands");
  return `${head}\n${sub}`;
}

/** Inline `code`, **bold**, headings, lists, quotes, fences — terminal-safe. */
export function md(text: string): string {
  const out: string[] = [];
  let inFence = false;
  for (const rawLine of text.split("\n")) {
    const line = rawLine;
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      out.push(c("dim", inFence ? "┌ code" : "└"));
      continue;
    }
    if (inFence) {
      out.push(`  ${c("dim", line)}`);
      continue;
    }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line.trim());
    if (heading) {
      out.push(bold(heading[2] ?? line));
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line.trim());
    if (quote) {
      out.push(c("dim", `│ ${inline((quote[1] ?? "").trim())}`));
      continue;
    }
    const bullet = /^[-*+]\s+(.+)$/.exec(line.trim());
    if (bullet) {
      out.push(`• ${inline(bullet[1] ?? "")}`);
      continue;
    }
    const ordered = /^(\d+)[.)]\s+(.+)$/.exec(line.trim());
    if (ordered) {
      out.push(`${c("dim", `${ordered[1]}.`)} ${inline(ordered[2] ?? "")}`);
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      out.push(rule());
      continue;
    }
    out.push(line.trim() ? inline(line) : "");
  }
  if (inFence) out.push(c("dim", "└"));
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

const inline = (text: string): string =>
  text
    .replace(/\*\*([^*]+)\*\*/g, (_, inner: string) => bold(inner))
    .replace(/`([^`]+)`/g, (_, inner: string) => c("cyan", inner))
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,!?;:]|$)/g, (_, pre: string, inner: string) => `${pre}${bold(inner)}`);

/**
 * Pixel wordmark ("ROOK", 5x5 caps in the OpenCode poster style) with a
 * gray-to-white gradient across the letters. Pure text: 23 columns wide,
 * 5 rows tall, colorless under NO_COLOR / pipes.
 */
const WORDMARK_GLYPHS: Record<string, string[]> = {
  R: ["████.", "█...█", "████.", "█..█.", "█...█"],
  O: [".███.", "█...█", "█...█", "█...█", ".███."],
  K: ["█...█", "█..█.", "███..", "█..█.", "█...█"],
};

const BLANK_GLYPH = [".....", ".....", ".....", ".....", "....."];

export function wordmark(word = "ROOK"): string {
  const glyphs = word
    .toUpperCase()
    .split("")
    .map((ch) => (WORDMARK_GLYPHS[ch] ?? BLANK_GLYPH).map((row) => row.replace(/\./g, " ")));
  const rows: string[] = [];
  for (let r = 0; r < 5; r += 1) {
    const line = glyphs.map((glyph) => glyph[r]).join(" ");
    // Gradient: first two letters dim, the rest bright.
    rows.push(`${c("dim", line.slice(0, 11))}${line.slice(11)}`);
  }
  return rows.join("\n");
}

/** Center every line in `width` (default: terminal). ANSI-aware. */
export function centerBlock(text: string, width?: number): string {
  const target = Math.max(1, width ?? termWidth());
  return text
    .split("\n")
    .map((line) => {
      const gap = Math.max(0, Math.floor((target - visibleWidth(line)) / 2));
      return `${" ".repeat(gap)}${line}`;
    })
    .join("\n");
}

/** `● Tip …`: amber marker, amber label, dim body. */
export const tipLine = (tip: string): string =>
  `${c("amber", "●")} ${c("amber", "Tip")} ${c("dim", tip)}`;

/**
 * Launch screen: pixel wordmark, version chip, model line, one tip.
 * Pass `width` in tests for deterministic centering.
 */
export function launchScreen(opts: {
  version: string;
  model?: string;
  tip?: string;
  width?: number;
}): string {
  const width = Math.max(30, opts.width ?? termWidth());
  const parts = [
    "",
    centerBlock(wordmark(), width),
    centerBlock(c("dim", `v${opts.version}`), width),
  ];
  if (opts.model) parts.push(centerBlock(c("dim", opts.model), width));
  if (opts.tip) {
    parts.push("", centerBlock(tipLine(opts.tip), width));
  }
  parts.push("");
  return parts.join("\n");
}

export type CommandMenuItem = { command: string; description: string; hint?: string };

/**
 * Slash palette: orange `/command`, dim description, dim hint pinned to
 * the right edge — the OpenCode `/` listing shape. Every row is exactly
 * `width` wide so hints form a straight rail.
 */
export function commandMenu(items: CommandMenuItem[], width?: number): string {
  const target = Math.max(20, width ?? termWidth());
  const cmdWidth = Math.max(...items.map((item) => visibleWidth(item.command)), 1);
  return items
    .map((item) => {
      const head = `  ${c("orange", item.command)}${" ".repeat(cmdWidth - visibleWidth(item.command))}  ${c("dim", item.description)}`;
      const hint = item.hint ? c("dim", item.hint) : "";
      const gap = " ".repeat(Math.max(1, target - visibleWidth(head) - visibleWidth(hint)));
      return truncate(`${head}${gap}${hint}`, target);
    })
    .join("\n");
}

/**
 * One footer row: dim left label, dim right label, space between.
 * The statusline, input-box bottom row, and turn footer share it.
 */
export function footerRow(left: string, right: string, width?: number): string {
  const target = Math.max(1, width ?? termWidth());
  const leftText = c("dim", left);
  const rightText = c("dim", right);
  const room = target - visibleWidth(rightText);
  if (room <= 0) return truncate(rightText, target);
  return `${truncate(leftText, room)}${" ".repeat(Math.max(0, room - visibleWidth(truncate(leftText, room))))}${rightText}`;
}

/** Frames double as sync rows; keep the cursor math beside the renderer. */
export const rowsBackToStart = (drawn: number): number => Math.max(0, drawn);

/**
 * Shared redraw primitive: move to the start of the live input block, draw
 * every row, remember the block size for the next sync.
 */
export function drawRows(
  stdout: NodeJS.WriteStream,
  state: { drawn: number },
  rows: string[],
): void {
  if (state.drawn > 0) stdout.write(`\x1b[${rowsBackToStart(state.drawn)}A`);
  for (const row of rows) stdout.write("\r\x1b[2K" + row + "\n");
  state.drawn = rows.length;
}

/**
 * Fully erase the live input block so stale palette rows never linger when
 * the list shrinks, then reset the cursor for the next render.
 */
export function clearRows(stdout: NodeJS.WriteStream, state: { drawn: number }): void {
  if (state.drawn > 0) stdout.write(`\x1b[${rowsBackToStart(state.drawn)}A`);
  for (let i = 0; i < state.drawn; i += 1) stdout.write("\r\x1b[2K\n");
  stdout.write(`\x1b[${state.drawn}A`);
  stdout.write("\r");
  state.drawn = 0;
}

/** Bottom bar: `~/dir` left, `v0.1.0` right — the persistent TUI strip. */
export function statusBar(cwd: string, version: string, width?: number): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const short = home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
  return footerRow(short, `v${version}`, width);
}

/** Braille spinner writing to a stream (default stderr). No-op-safe. */
export function createSpinner(message: string, stream?: NodeJS.WriteStream): {
  start: () => void;
  stop: (finalMessage?: string) => void;
} {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const out = stream ?? process.stderr;
  let timer: ReturnType<typeof setInterval> | undefined;
  let frame = 0;
  const render = (): void => {
    const glyph = colorsEnabled() ? c("mint", frames[frame % frames.length]!) : frames[frame % frames.length]!;
    out.write(`\r${glyph} ${message}`);
    frame += 1;
  };
  return {
    start: () => {
      if (timer || out.isTTY === false) return;
      render();
      timer = setInterval(render, 80);
    },
    stop: (finalMessage?: string) => {
      if (timer) clearInterval(timer);
      timer = undefined;
      if (out.isTTY !== false) {
        out.write(`\r${" ".repeat(visibleWidth(`${frames[0]} ${message}`) + 2)}\r`);
      }
      if (finalMessage) out.write(`${finalMessage}\n`);
    },
  };
}

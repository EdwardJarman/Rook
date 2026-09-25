/**
 * `rook chat`: a REPL that streams. History stays client-side and rides
 * as recentContext (same caps as web). Slash commands manage the session.
 *
 * Chrome follows the OpenCode/Claude-Code shape: pixel wordmark launch,
 * live slash palette while typing, inline model picker (Ctrl+N), Tab
 * agent cycling, `enter send` footers with the model indicator, bottom
 * status bar. Ctrl+C interrupts the running turn, Esc clears, Ctrl+D
 * exits. Everything degrades under pipes.
 */

import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";

import type { CliProfile } from "../config.js";
import { loadHistory, pushHistory, saveHistory } from "../history.js";
import { eprintln, println, ROOK_CLI_VERSION } from "../output.js";
import {
  bold,
  box,
  c,
  commandMenu,
  footerRow,
  launchScreen,
  pickerHint,
  promptGlyph,
  selectGlyph,
  statusBar,
  syncRows,
  terminalWidth,
  truncate,
  type CommandMenuItem,
} from "../ui.js";
import { askTurn, buildRecentContext, type HistoryTurn } from "./ask.js";
import { saveAnswerText } from "./files.js";
import { askInput, isModelArg, MODEL_ARG_HINT, type Agent } from "./input.js";
import { listModels, modelDisplay, renderModels, defaultModelId, type CatalogModel } from "./models.js";

export type SlashCommand =
  | { cmd: "message"; text: string }
  | { cmd: "model"; arg: string }
  | { cmd: "models" }
  | { cmd: "new" }
  | { cmd: "copy" }
  | { cmd: "retry" }
  | { cmd: "save"; arg: string }
  | { cmd: "help" }
  | { cmd: "exit" }
  | { cmd: "unknown"; arg: string };

/** Pure line parser, unit-tested. */
export const parseSlash = (line: string): SlashCommand => {
  const trimmed = line.trim();
  if (!trimmed.startsWith("/")) return { cmd: "message", text: trimmed };
  const [head, ...rest] = trimmed.slice(1).split(/\s+/);
  const arg = rest.join(" ");
  switch ((head ?? "").toLowerCase()) {
    case "model":
      return { cmd: "model", arg };
    case "models":
      return { cmd: "models" };
    case "new":
      return { cmd: "new" };
    case "copy":
      return { cmd: "copy" };
    case "retry":
      return { cmd: "retry" };
    case "save":
      return { cmd: "save", arg };
    case "help":
      return { cmd: "help" };
    case "exit":
    case "quit":
      return { cmd: "exit" };
    default:
      return { cmd: "unknown", arg: head ?? "" };
  }
};

export const CHAT_COMMANDS: CommandMenuItem[] = [
  { command: "/model", hint: MODEL_ARG_HINT, description: "switch model for this session" },
  { command: "/models", description: "list every model" },
  { command: "/retry", description: "re-run the last prompt" },
  { command: "/copy", description: "copy the last answer to the clipboard" },
  { command: "/save", hint: "[file]", description: "save the last answer to a file" },
  { command: "/new", description: "forget this conversation" },
  { command: "/help", description: "show this palette" },
  { command: "/exit", description: "leave", hint: "ctrl+d" },
];

export const CHAT_HELP = CHAT_COMMANDS.map(
  (item) => `${item.command}${item.hint ? ` ${item.hint}` : ""}  ${item.description}`,
).join("\n");

export const CHAT_TIPS = [
  "pipe answers out: rook ask … > notes.md",
  "hit / to see the slash palette while typing",
  "ctrl+n opens the model picker",
  "switch models mid-chat with /model — pick with arrows",
  "copy the last answer with /copy, save it with /save",
  "/new forgets the thread — history never leaves your machine",
  "up-arrow recalls prompts from your previous sessions",
  "ctrl+j adds a newline; paste multiline text just works",
];

export const pickTip = (): string =>
  CHAT_TIPS[Math.floor(Math.random() * CHAT_TIPS.length)] ?? CHAT_TIPS[0]!;

/**
 * OSC 52 clipboard write (works over SSH in modern terminals). The caller
 * writes the escape to stdout; terminals that ignore it change nothing.
 * Pure and unit-tested.
 */
export const osc52Copy = (text: string): string =>
  `\x1b]52;c;${Buffer.from(text, "utf8").toString("base64")}\x07`;

/**
 * Interactive model picker: up/down over the live catalog, Enter picks,
 * Esc cancels. Rows are grouped-by-provider labels; current model bold.
 * Returns the picked id, or undefined.
 *
 * Rendering rides `syncRows` (the composer's primitive), so the redraw
 * math is exact by construction: the old hand-rolled `\x1b[NA` counts
 * drifted one line per keypress and `clear()` then erased the wrong rows.
 * Long catalogs window to a few rows around the selection — a 30-model
 * picker must never outgrow the screen — and every row is width-capped
 * (conhost wraps exact-width writes and desyncs everything).
 */
export type PickerItem = { id: string; label: string };

/** Pure windowed rows for the picker, centered on the selection. */
export function modelPickerRows(items: PickerItem[], selected: number, windowSize = 7): string[] {
  if (!items.length) return [];
  const sel = Math.min(Math.max(0, selected), items.length - 1);
  const start = Math.max(
    0,
    Math.min(sel - Math.floor(windowSize / 2), items.length - windowSize),
  );
  return items.slice(start, start + windowSize).map((item, i) => {
    const picked = start + i === sel;
    return picked ? `${c("orange", selectGlyph())} ${item.label}` : c("dim", `  ${item.label}`);
  });
}

export async function pickModel(
  models: CatalogModel[],
  current: string,
  io?: { stdin?: NodeJS.ReadStream; stdout?: NodeJS.WriteStream },
): Promise<string | undefined> {
  const stdin = io?.stdin ?? process.stdin;
  const stdout = io?.stdout ?? process.stdout;
  if (!stdin.isTTY || !stdout.isTTY) return undefined;
  const items = models.map((m) => ({ id: m.id, label: `${modelDisplay(m.id)} — ${m.name}` }));
  let sel = Math.max(0, items.findIndex((r) => r.id === current));
  // Measure the stream we actually draw on (not process.stdout): piped
  // or redirected output must not wrap rows meant for the real terminal.
  const columns = (stdout as { columns?: number }).columns;
  const target = Math.max(20, (typeof columns === "number" && columns > 0 ? columns : terminalWidth()) - 1);
  const rows = (): string[] => [
    c("dim", "─ model ─"),
    ...modelPickerRows(items, sel).map((row) => truncate(row, target)),
    c("dim", pickerHint()),
  ];
  return new Promise((resolve) => {
    const state = { drawn: 0 };
    const showCursor = (): void => {
      try {
        stdout.write("\x1b[?25h");
      } catch {
        // A dead stream at exit time has nothing left to restore.
      }
    };
    const finish = (id: string | undefined): void => {
      stdin.removeListener("keypress", onKey);
      process.removeListener("exit", showCursor);
      stdin.setRawMode(false);
      stdin.pause();
      syncRows(stdout, state, []);
      showCursor();
      resolve(id);
    };
    const onKey = (_ch: string | undefined, key: { name?: string }): void => {
      const name = key?.name ?? "";
      if (name === "up") sel = Math.max(0, sel - 1);
      else if (name === "down") sel = Math.min(items.length - 1, sel + 1);
      else if (name === "escape") return finish(undefined);
      else if (name === "return") return finish(items[sel]?.id);
      else return; // unbound keys never redraw
      syncRows(stdout, state, rows());
    };
    stdin.setRawMode(true);
    stdin.resume();
    emitKeypressEvents(stdin);
    stdin.on("keypress", onKey);
    try {
      stdout.write("\x1b[?25l");
    } catch {
      // Cursor stays visible; rendering still works.
    }
    process.once("exit", showCursor);
    syncRows(stdout, state, rows());
  });
}

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && error.name === "AbortError";

export const DEFAULT_AGENTS: Agent[] = [{ name: "build", label: "Build" }];

/** Documented default when the catalog cannot be reached at startup. */
export const OFFLINE_DEFAULT_MODEL = "openrouter/free";

/**
 * Chat startup model (pure): an explicit -m always wins, the catalog's
 * default comes next, and an unreachable catalog degrades to the
 * documented default instead of stranding the REPL — the session still
 * opens, and each turn fails with its own actionable error if the server
 * is truly down.
 */
export function chatStartupModel(
  requested: string | undefined,
  catalog: CatalogModel[] | undefined,
): { model: string; offline: boolean } {
  if (requested?.trim()) return { model: requested.trim(), offline: false };
  const fallback = defaultModelId(catalog ?? []);
  if (fallback) return { model: fallback, offline: false };
  return { model: OFFLINE_DEFAULT_MODEL, offline: true };
}

export async function runChat(
  profile: CliProfile,
  opts?: { model?: string; outDir?: string },
): Promise<void> {
  // One catalog fetch shared by the default-model pick and the picker —
  // the old code listed twice serially (resolveAskModel, then listModels).
  // Interactive startup gets a snappier budget: a wedged server must not
  // hang the terminal for the full 30s metadata timeout.
  let catalog: CatalogModel[] | undefined;
  try {
    catalog = await listModels(profile, { timeoutMs: 10_000 });
  } catch {
    catalog = undefined;
  }
  const start = chatStartupModel(opts?.model, catalog);
  if (start.offline) {
    eprintln(
      c(
        "amber",
        `Could not reach the model catalog — starting on ${OFFLINE_DEFAULT_MODEL}. Try \`rook doctor\` if this keeps happening.`,
      ),
    );
  }
  let model = start.model;
  const display = (): string => modelDisplay(model);
  const hasPicker = Boolean(catalog && process.stdin.isTTY && process.stdout.isTTY);
  println(launchScreen({ version: ROOK_CLI_VERSION, model: display(), tip: pickTip() }));
  eprintln(statusBar(process.cwd(), ROOK_CLI_VERSION, undefined, `model ${display()}`));
  const history: HistoryTurn[] = [];
  // Up-arrow history: submitted lines only (the old code fed bot replies
  // into the walker too), persisted across sessions readline-style.
  let inputHistory = loadHistory();
  let lastAnswer: string | undefined;
  let turn = 0;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let busy: AbortController | undefined;
  const onSigint = (): void => {
    if (busy) {
      busy.abort();
      return;
    }
    println();
    rl.close();
    process.exit(130);
  };
  process.once("SIGINT", onSigint);
  try {
    for (;;) {
      const interactive = process.stdin.isTTY && process.stdout.isTTY;
      let line: string | null = null;
      if (interactive) {
        // The live input owns its own footer; chat prints one only on the
        // readline path (finish() already flushed the live prompt + footer).
        const input = await askInput({
          model: display(),
          agent: DEFAULT_AGENTS[0],
          commands: CHAT_COMMANDS.map((i) => ({ command: i.command, hint: i.hint, description: i.description })),
          history: inputHistory,
          pickModel:
            hasPicker && catalog
              ? async (): Promise<string | undefined> => {
                  const picked = await pickModel(catalog!, model);
                  if (picked) {
                    model = picked;
                    return display();
                  }
                  return undefined;
                }
              : undefined,
        });
        if (input === "exit") break;
        if (input !== null) line = input;
      }
      if (line === null) {
        try {
          line = await rl.question(`${c("mint", bold(promptGlyph()))} `);
        } catch {
          break;
        }
        println(footerRow("enter send", display()));
      }
      if (!line.trim()) continue;
      inputHistory = pushHistory(inputHistory, line);
      saveHistory(inputHistory);
      let parsed = parseSlash(line);
      let retrying = false;
      if (parsed.cmd === "exit") break;
      if (parsed.cmd === "unknown") {
        eprintln(c("coral", `✗ Unknown command /${parsed.arg}. /help lists them.`));
        continue;
      }
      if (parsed.cmd === "help") {
        println(commandMenu(CHAT_COMMANDS));
        continue;
      }
      if (parsed.cmd === "new") {
        history.length = 0;
        lastAnswer = undefined;
        eprintln(c("dim", "Forgot this conversation. Fresh start."));
        continue;
      }
      if (parsed.cmd === "copy") {
        if (!lastAnswer) {
          eprintln(c("dim", "Nothing to copy yet — ask something first."));
          continue;
        }
        process.stdout.write(osc52Copy(lastAnswer));
        eprintln(c("dim", `Copied ${lastAnswer.length} chars (or /save to write a file).`));
        continue;
      }
      if (parsed.cmd === "save") {
        if (!lastAnswer) {
          eprintln(c("dim", "Nothing to save yet — ask something first."));
          continue;
        }
        const saved = saveAnswerText(lastAnswer, process.cwd(), parsed.arg || undefined);
        const name = saved.split(/[\\/]/).pop() ?? saved;
        println(box({ title: `File · ${name}`, lines: [c("dim", saved)] }));
        continue;
      }
      if (parsed.cmd === "retry") {
        const lastUser = [...history].reverse().find((turn) => turn.author === "user");
        if (!lastUser) {
          eprintln(c("dim", "Nothing to retry yet — ask something first."));
          continue;
        }
        // Re-run without duplicating the user turn in history.
        parsed = { cmd: "message", text: lastUser.body };
        retrying = true;
      }
      if (parsed.cmd === "models") {
        println(renderModels(catalog && catalog.length ? catalog : await listModels(profile), false));
        continue;
      }
      if (parsed.cmd === "model") {
        // A bare command or a copied palette hint never counts as a model id.
        if (!parsed.arg || isModelArg(parsed.arg)) {
          if (hasPicker && catalog) {
            const picked = await pickModel(catalog, model);
            if (picked) {
              model = picked;
              eprintln(footerRow(`model ${display()}`, `v${ROOK_CLI_VERSION}`));
            }
            continue;
          }
          eprintln(`Current model: ${display()}`);
          continue;
        }
        model = parsed.arg;
        eprintln(footerRow(`model ${display()}`, `v${ROOK_CLI_VERSION}`));
        continue;
      }
      if (!parsed.text) continue;
      if (!retrying) history.push({ author: "user", body: parsed.text });
      busy = new AbortController();
      try {
        // Stream the answer ourselves instead of via runAsk's chrome: the
        // live composer owns the bottom rows, so any mid-turn println would
        // scroll it up and eat its border. One printlns() here, then the
        // next composer render reclaims the cursor.
        println();
        const result = await askTurn(profile, {
          message: parsed.text,
          model,
          outDir: opts?.outDir,
          recentContext: history.slice(0, -1),
          onToken: (delta) => process.stdout.write(delta),
          signal: busy.signal,
        });
        println();
        turn += 1;
        eprintln(
          footerRow(
            `model ${display()}${result.savedFiles.length ? ` · ${result.savedFiles.length} file(s)` : ""}`,
            `turn ${turn} · v${ROOK_CLI_VERSION}`,
          ),
        );
        history.push({ author: "bot", body: result.text });
        lastAnswer = result.text;
      } catch (error) {
        if (isAbortError(error)) {
          eprintln(c("dim", "Interrupted — pick up where you left off, or /exit to leave."));
        } else {
          eprintln(c("coral", `✗ ${error instanceof Error ? error.message : String(error)}`));
        }
        history.pop();
      } finally {
        busy = undefined;
      }
    }
  } finally {
    process.removeListener("SIGINT", onSigint);
    rl.close();
  }
}

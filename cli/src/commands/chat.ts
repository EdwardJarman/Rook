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

import { createInterface } from "node:readline/promises";

import type { CliProfile } from "../config.js";
import { eprintln, println, ROOK_CLI_VERSION } from "../output.js";
import {
  bold,
  c,
  commandMenu,
  footerRow,
  launchScreen,
  statusBar,
  type CommandMenuItem,
} from "../ui.js";
import { buildRecentContext, resolveAskModel, runAsk, type HistoryTurn } from "./ask.js";
import { askInput, type Agent } from "./input.js";
import { listModels, modelDisplay, renderModels, type CatalogModel } from "./models.js";

export type SlashCommand =
  | { cmd: "message"; text: string }
  | { cmd: "model"; arg: string }
  | { cmd: "models" }
  | { cmd: "new" }
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
  { command: "/model <id>", description: "switch model for this session" },
  { command: "/models", description: "list every model" },
  { command: "/new", description: "forget this conversation" },
  { command: "/help", description: "show this palette" },
  { command: "/exit", description: "leave", hint: "ctrl+d" },
];

export const CHAT_HELP = CHAT_COMMANDS.map(
  (item) => `${item.command}  ${item.description}`,
).join("\n");

export const CHAT_TIPS = [
  "pipe answers out: rook ask … > notes.md",
  "hit / to see the slash palette while typing",
  "ctrl+n opens the model picker",
  "switch models mid-chat with /model <id>",
  "/new forgets the thread — history never leaves your machine",
];

export const pickTip = (): string =>
  CHAT_TIPS[Math.floor(Math.random() * CHAT_TIPS.length)] ?? CHAT_TIPS[0]!;

/**
 * Interactive model picker: up/down over the live catalog, Enter picks,
 * Esc cancels. Rows are grouped-by-provider labels; current model bold.
 * Returns the picked id, or undefined. listModels row is fully text —
 * the picker is a render over a CatalogModel[].
 */
export async function pickModel(models: CatalogModel[], current: string): Promise<string | undefined> {
  const stdin = process.stdin;
  const stdout = process.stdout;
  if (!stdin.isTTY || !stdout.isTTY) return undefined;
  const rows = models.map((m) => ({ id: m.id, label: `${modelDisplay(m.id)} — ${m.name}` }));
  let sel = Math.max(0, rows.findIndex((r) => r.id === current));
  const render = (count: number): void => {
    if (count > 0) stdout.write(`\x1b[${count}A`);
    const out: string[] = [c("dim", `─ model ─`)];
    out.push(...rows.map((r, i) => (i === sel ? `${c("orange", "›")} ${r.label}` : c("dim", `  ${r.label}`))));
    out.push(c("dim", "↑↓ move · enter pick · esc cancel"));
    for (const line of out) stdout.write("\r\x1b[2K" + line + "\n");
  };
  const clear = (count: number): void => {
    if (count > 0) stdout.write(`\x1b[${count - 1}A`);
    for (let i = 0; i < count; i += 1) stdout.write("\r\x1b[2K\n");
    stdout.write(`\x1b[${count}A`);
  };
  return new Promise((resolve) => {
    let drawn = 0;
    const finish = (id: string | undefined): void => {
      stdin.removeListener("keypress", onKey);
      stdin.setRawMode(false);
      stdin.pause();
      clear(drawn);
      resolve(id);
    };
    const onKey = (_ch: string | undefined, key: { name?: string }): void => {
      const name = key.name ?? "";
      if (name === "up") sel = Math.max(0, sel - 1);
      else if (name === "down") sel = Math.min(rows.length - 1, sel + 1);
      else if (name === "escape") return finish(undefined);
      else if (name === "return") return finish(rows[sel]?.id);
      drawn = rows.length + 2;
      render(drawn - 1);
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("keypress", onKey);
    drawn = rows.length + 2;
    render(0);
  });
}

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && error.name === "AbortError";

export const DEFAULT_AGENTS: Agent[] = [{ name: "build", label: "Build" }];

export async function runChat(
  profile: CliProfile,
  opts?: { model?: string; outDir?: string },
): Promise<void> {
  let model = await resolveAskModel(profile, opts?.model);
  const display = (): string => modelDisplay(model);
  let catalog: CatalogModel[] | undefined;
  try {
    catalog = await listModels(profile);
  } catch {
    catalog = undefined;
  }
  const hasPicker = Boolean(catalog && process.stdin.isTTY && process.stdout.isTTY);
  println(launchScreen({ version: ROOK_CLI_VERSION, model: display(), tip: pickTip() }));
  eprintln(statusBar(process.cwd(), ROOK_CLI_VERSION));
  const history: HistoryTurn[] = [];
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
        const input = await askInput({
          model: display(),
          agent: DEFAULT_AGENTS[0],
          commands: CHAT_COMMANDS.map((i) => ({ command: i.command, description: i.description })),
          history: history.map((h) => h.body),
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
        if (input !== null) {
          println(footerRow("enter send", display()));
        }
      }
      if (line === null) {
        try {
          line = await rl.question(`${c("mint", bold("❯"))} `);
        } catch {
          break;
        }
      }
      if (!line.trim()) continue;
      const parsed = parseSlash(line);
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
        eprintln(c("dim", "Forgot this conversation. Fresh start."));
        continue;
      }
      if (parsed.cmd === "models") {
        println(renderModels(catalog && catalog.length ? catalog : await listModels(profile), false));
        continue;
      }
      if (parsed.cmd === "model") {
        if (!parsed.arg) {
          eprintln(`Current model: ${display()}`);
          continue;
        }
        model = parsed.arg;
        eprintln(footerRow(`model ${display()}`, `v${ROOK_CLI_VERSION}`));
        continue;
      }
      if (!parsed.text) continue;
      history.push({ author: "user", body: parsed.text });
      busy = new AbortController();
      try {
        const result = await runAsk(profile, {
          message: parsed.text,
          model,
          outDir: opts?.outDir,
          recentContext: buildRecentContext(history.slice(0, -1)),
          onToken: (delta) => process.stdout.write(delta),
          chrome: false,
          signal: busy.signal,
        });
        println();
        eprintln(
          footerRow(
            `model ${display()}${result.savedFiles.length ? ` · ${result.savedFiles.length} file(s)` : ""}`,
            `v${ROOK_CLI_VERSION}`,
          ),
        );
        history.push({ author: "bot", body: result.text });
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

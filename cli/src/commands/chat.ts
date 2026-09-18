/**
 * `rook chat`: a REPL that streams. History stays client-side and rides
 * as recentContext (same caps as web). Slash commands manage the session.
 *
 * Chrome follows the OpenCode/Claude-Code shape: pixel wordmark launch,
 * labeled input rules, `enter send` footers with the model indicator,
 * slash palette, bottom status bar — all of it pure text that degrades
 * under pipes. Ctrl+C interrupts the running turn; a second press (or
 * Ctrl+D) leaves.
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
  rule,
  statusBar,
  type CommandMenuItem,
} from "../ui.js";
import { buildRecentContext, resolveAskModel, runAsk, type HistoryTurn } from "./ask.js";
import { listModels, modelDisplay, renderModels } from "./models.js";

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
  "switch models mid-chat with /model <id>",
  "/new forgets the thread — history never leaves your machine",
  "ROOK_TOKEN signs in headless shells and CI",
  "in a hurry? rook ask --no-stream skips the live tokens",
];

export const pickTip = (): string =>
  CHAT_TIPS[Math.floor(Math.random() * CHAT_TIPS.length)] ?? CHAT_TIPS[0]!;

const isAbort = (error: unknown): boolean =>
  error instanceof Error && error.name === "AbortError";

export async function runChat(
  profile: CliProfile,
  opts?: { model?: string; outDir?: string },
): Promise<void> {
  let model = await resolveAskModel(profile, opts?.model);
  const display = (): string => modelDisplay(model);
  println(launchScreen({ version: ROOK_CLI_VERSION, model: display(), tip: pickTip() }));
  eprintln(statusBar(process.cwd(), ROOK_CLI_VERSION));
  const history: HistoryTurn[] = [];
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let busy: AbortController | undefined;
  const onSigint = (): void => {
    // Mid-turn: cancel the stream and hand the prompt back. Idle:
    // leave like any REPL (Ctrl+D does the same).
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
      println(rule("ask"));
      let line: string | null;
      try {
        line = await rl.question(`${c("mint", bold("❯"))} `);
      } catch {
        break;
      }
      println(footerRow("enter send", display()));
      if (line === null) break;
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
        println(renderModels(await listModels(profile), false));
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
        if (isAbort(error)) {
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

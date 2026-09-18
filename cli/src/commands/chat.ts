/**
 * `rook chat`: a REPL that streams. History stays client-side and rides
 * as recentContext (same caps as web). Slash commands manage the session.
 */

import { basename } from "node:path";
import { createInterface } from "node:readline/promises";

import type { CliProfile } from "../config.js";
import { eprintln, println, ROOK_CLI_VERSION, shortModel } from "../output.js";
import { banner, bold, box, c, statusline } from "../ui.js";
import { buildRecentContext, resolveAskModel, runAsk, type HistoryTurn } from "./ask.js";
import { listModels, renderModels } from "./models.js";

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

export const CHAT_HELP = [
  "Chat commands:",
  "  /model <id>   switch model for this session",
  "  /models       list every model",
  "  /new          forget this conversation",
  "  /help         show this",
  "  /exit         leave (Ctrl+D works too)",
].join("\n");

export async function runChat(
  profile: CliProfile,
  opts?: { model?: string; outDir?: string },
): Promise<void> {
  let model = await resolveAskModel(profile, opts?.model);
  println(banner(ROOK_CLI_VERSION, model));
  eprintln(statusline([basename(process.cwd()), "type /help"]) + "\n");
  const showStatus = (): void => {
    eprintln(statusline([`model ${model}`, basename(process.cwd())]));
  };
  const history: HistoryTurn[] = [];
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const onSigint = (): void => {
    println();
    rl.close();
    process.exit(130);
  };
  process.once("SIGINT", onSigint);
  try {
    for (;;) {
      let line: string | null;
      try {
        line = await rl.question(`${c("mint", bold("❯"))} `);
      } catch {
        break;
      }
      if (line === null) break;
      const parsed = parseSlash(line);
      if (parsed.cmd === "exit") break;
      if (parsed.cmd === "unknown") {
        eprintln(c("coral", `✗ Unknown command /${parsed.arg}. /help lists them.`));
        continue;
      }
      if (parsed.cmd === "help") {
        println(box({ title: "Chat commands", lines: CHAT_HELP.split("\n") }));
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
          eprintln(`Current model: ${model}`);
          continue;
        }
        model = parsed.arg;
        showStatus();
        continue;
      }
      if (!parsed.text) continue;
      history.push({ author: "user", body: parsed.text });
      println(`${c("mint", "●")} ${c("dim", shortModel(model))}`);
      try {
        const result = await runAsk(profile, {
          message: parsed.text,
          model,
          outDir: opts?.outDir,
          recentContext: buildRecentContext(history.slice(0, -1)),
          onToken: (delta) => process.stdout.write(delta),
          chrome: false,
        });
        println();
        eprintln(statusline([`model ${model}`, result.savedFiles.length ? `${result.savedFiles.length} file(s)` : undefined]));
        history.push({ author: "bot", body: result.text });
      } catch (error) {
        eprintln(c("coral", `✗ ${error instanceof Error ? error.message : String(error)}`));
        history.pop();
      }
    }
  } finally {
    process.removeListener("SIGINT", onSigint);
    rl.close();
  }
}

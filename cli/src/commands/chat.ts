/**
 * `rook chat`: a REPL that streams. History stays client-side and rides
 * as recentContext (same caps as web). Slash commands manage the session.
 */

import { createInterface } from "node:readline/promises";

import type { CliProfile } from "../config.js";
import { eprintln, println, shortModel } from "../output.js";
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
  eprintln(`Model: ${model} — /help for commands, /exit to leave.`);
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
        line = await rl.question(`rook(${shortModel(model)})> `);
      } catch {
        break;
      }
      if (line === null) break;
      const parsed = parseSlash(line);
      if (parsed.cmd === "exit") break;
      if (parsed.cmd === "unknown") {
        eprintln(`Unknown command /${parsed.arg}. /help lists them.`);
        continue;
      }
      if (parsed.cmd === "help") {
        println(CHAT_HELP);
        continue;
      }
      if (parsed.cmd === "new") {
        history.length = 0;
        eprintln("Forgot this conversation. Fresh start.");
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
        eprintln(`Model: ${model}`);
        continue;
      }
      if (!parsed.text) continue;
      history.push({ author: "user", body: parsed.text });
      try {
        const result = await runAsk(profile, {
          message: parsed.text,
          model,
          outDir: opts?.outDir,
          recentContext: buildRecentContext(history.slice(0, -1)),
        });
        history.push({ author: "bot", body: result.text });
      } catch (error) {
        eprintln(error instanceof Error ? error.message : String(error));
        history.pop();
      }
    }
  } finally {
    process.removeListener("SIGINT", onSigint);
    rl.close();
  }
}

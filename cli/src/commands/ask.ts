/**
 * `rook ask`: one question, streamed answer on stdout (pipeable).
 * Progress and file notes go to stderr so `rook ask … > answer.md` stays clean.
 */

import { randomUUID } from "node:crypto";

import { streamAgentRound, trpc } from "../api.js";
import type { CliProfile } from "../config.js";
import { eprintln, println } from "../output.js";
import { saveTurnFiles, type TurnFile } from "./files.js";
import { defaultModelId, listModels } from "./models.js";

export type HistoryTurn = { author: "user" | "bot" | "system"; body: string };

/** Mirror of the web caps: newest 8, bodies clipped. Pure, unit-tested. */
export const buildRecentContext = (history: HistoryTurn[]): HistoryTurn[] =>
  history.slice(-8).map((turn) => ({
    author: turn.author,
    body: turn.body.slice(0, 2000),
  }));

export type AskOptions = {
  message: string;
  model?: string;
  stream?: boolean;
  outDir?: string;
  recentContext?: HistoryTurn[];
  onToken?: (delta: string) => void;
  signal?: AbortSignal;
};

export type AskResult = {
  text: string;
  model: string;
  savedFiles: string[];
};

export const CLI_BOT = {
  botId: "cli",
  botName: "CLI",
  botRole: "Terminal teammate",
  botPurpose: "Answer from the terminal.",
} as const;

export async function resolveAskModel(
  profile: CliProfile,
  requested?: string,
): Promise<string> {
  if (requested?.trim()) return requested.trim();
  const fallback = defaultModelId(await listModels(profile));
  if (!fallback) {
    throw new Error("No models available. Check the Rook server connection (`rook status`).");
  }
  return fallback;
}

export async function runAsk(profile: CliProfile, opts: AskOptions): Promise<AskResult> {
  if (!opts.message.trim()) throw new Error("Nothing to ask. Usage: rook ask \"your question\"");
  const model = await resolveAskModel(profile, opts.model);
  const emit = opts.onToken ?? ((delta: string) => process.stdout.write(delta));
  const body = {
    ...CLI_BOT,
    taskId: randomUUID(),
    model,
    message: opts.message,
    recentContext: buildRecentContext(opts.recentContext ?? []),
  };
  let text: string;
  let files: TurnFile[] | undefined;
  if (opts.stream === false) {
    const result = await trpc<{ text: string; files?: TurnFile[] }>(profile, "workroom.reply", body, {
      method: "POST",
    });
    text = result.text;
    files = result.files;
    emit(text);
    println();
  } else {
    const done = await streamAgentRound(
      profile,
      body,
      {
        onToken: emit,
        onTrace: (step) => eprintln(`› ${step.title}`),
      },
      opts.signal,
    );
    println();
    text = done.text;
    files = done.files;
  }
  const savedFiles = saveTurnFiles(files, opts.outDir ?? process.cwd());
  for (const saved of savedFiles) eprintln(`saved ${saved}`);
  return { text, model, savedFiles };
}

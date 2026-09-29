/** Out-of-band side questions. These objects never enter the main conversation store. */
export type BtwContextEntry = { author: "user" | "bot" | "system"; body: string };
export type BtwInput = {
  botId: string;
  botName: string;
  question: string;
  model?: string;
  context: BtwContextEntry[];
  activeWork?: string;
};
export type BtwAnswer = { text: string; model: string; requestId: string; latencyMs: number; firstTokenMs: number | null; partial: boolean };
export type BtwEvent = { kind: "token"; delta: string } | { kind: "done"; result: BtwAnswer } | { kind: "error"; message: string };
export const BTW_QUESTION_LIMIT = 1600;
export const BTW_CONTEXT_CHARS = 6000;

/** Slash interception is explicit at the start; ordinary mentions of /btw remain ordinary text. */
export function parseBtwCommand(text: string): string | null {
  const match = /^\s*\/btw(?:\s+([\s\S]*))?$/i.exec(text);
  return match ? (match[1] ?? "").trim() : null;
}

/** Keep newest context, preserving chronology. Bodies stay data, never system messages. */
export function boundedBtwContext(entries: BtwContextEntry[]): BtwContextEntry[] {
  const kept: BtwContextEntry[] = [];
  let remaining = BTW_CONTEXT_CHARS;
  for (const entry of entries.slice(-8).reverse()) {
    if (!remaining) break;
    const body = entry.body.slice(-Math.min(2000, remaining));
    if (!body) continue;
    kept.unshift({ author: entry.author, body });
    remaining -= body.length;
  }
  return kept;
}

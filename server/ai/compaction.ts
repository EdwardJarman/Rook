/**
 * Deterministic conversation checkpoint (research: OpenAI compaction, ADK
 * sessions — provider-neutral edition).
 *
 * When the history budget forces old turns out, Rook previously dropped
 * them silently and long tasks lost state mid-work. This module condenses
 * dropped turns into a small, honest ledger ("earlier, condensed — newest
 * messages follow verbatim") with NO extra model call: extractive lines,
 * capped size, newest-first importance. The ledger rides in the system
 * prompt's volatile suffix, so providers that honor it gain continuity and
 * providers that ignore it lose nothing (kept history is untouched).
 */

export type LedgerEntry = { author: "user" | "bot" | "system"; body: string };

const MAX_LEDGER_LINES = 12;
const MAX_LEDGER_CHARS = 1200;
const MAX_LINE_CHARS = 160;

const oneLine = (value: string): string =>
  value.replace(/\s+/g, " ").trim().slice(0, MAX_LINE_CHARS);

/** Builds the ledger block, or "" when nothing was dropped. */
export function buildCheckpointLedger(dropped: LedgerEntry[]): string {
  if (!dropped.length) return "";
  const header =
    "Earlier in this conversation (condensed so this turn fits — the newest messages follow verbatim, use them first):";
  const lines: string[] = [];
  // Newest first: the most recent dropped turns matter most. The header is
  // reserved — a cap must trim old lines, never the honesty marker.
  const candidates = dropped.slice(-MAX_LEDGER_LINES);
  let used = header.length + 1;
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const line = `- (${candidates[index].author}) ${oneLine(candidates[index].body)}`;
    if (line.replace(/^- \(\w+\)\s*$/, "").length === 0) continue;
    if (used + line.length + 1 > MAX_LEDGER_CHARS) break;
    used += line.length + 1;
    lines.unshift(line);
  }
  if (!lines.length) return "";
  return `${header}\n${lines.join("\n")}`;
}

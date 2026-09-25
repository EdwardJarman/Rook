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

/**
 * Grok compaction-visibility port (adapted, still $0 — no model call).
 *
 * - `shouldEngageCompaction`: auto-compact threshold check (grok's
 *   `[session] auto_compact_threshold_percent`, default 85). Pure.
 * - `buildContextBudgetBlock`: `/context`-style window breakdown
 *   (system / messages / free) for the CLI status bar and chat footer. Pure.
 * - `applyFocusNote`: `/compact keep X` steering — dropped entries matching
 *   the focus terms sort first (newest-first preserved within each group)
 *   so the ledger keeps what the user asked to keep. Pure.
 */

export const AUTO_COMPACT_THRESHOLD_PERCENT = 85;

/** True when used tokens hit the auto-compact threshold. */
export function shouldEngageCompaction(
  usedTokens: number,
  totalTokens: number,
  thresholdPercent = AUTO_COMPACT_THRESHOLD_PERCENT,
): boolean {
  if (!Number.isFinite(usedTokens) || !Number.isFinite(totalTokens) || totalTokens <= 0)
    return false;
  return (usedTokens / totalTokens) * 100 >= thresholdPercent;
}

export type ContextBudget = {
  systemTokens: number;
  messageTokens: number;
  totalTokens: number;
};

/** One-line budget notice emitted when the ledger engages. "" when nothing dropped. */
export function buildCompactionNotice(droppedCount: number): string {
  if (!droppedCount) return "";
  return `Earlier turns were condensed to fit this turn (${droppedCount} condensed — newest messages follow verbatim).`;
}

/** `/context`-style breakdown. Percentages are whole numbers; unknown windows render honestly. */
export function buildContextBudgetBlock(budget: ContextBudget): string {
  const { systemTokens, messageTokens, totalTokens } = budget;
  if (!Number.isFinite(totalTokens) || totalTokens <= 0) return "Context: unknown window";
  // Pinned locale: budget lines must render byte-identically on every machine.
  const fmt = (value: number): string => Math.max(0, Math.round(value)).toLocaleString("en-US");
  const clamp = (value: number): number =>
    Math.max(0, Math.min(100, Math.round((Math.max(0, value) / totalTokens) * 100)));
  const freeTokens = Math.max(0, totalTokens - systemTokens - messageTokens);
  return [
    `Context: ${clamp(systemTokens + messageTokens)}% used of ${fmt(totalTokens)} tokens`,
    `- system ${fmt(systemTokens)} (${clamp(systemTokens)}%)`,
    `- messages ${fmt(messageTokens)} (${clamp(messageTokens)}%)`,
    `- free ${fmt(freeTokens)} (${clamp(freeTokens)}%)`,
  ].join("\n");
}

/** Filler words that must never steer the ledger (incl. the `/compact keep` verb itself). */
const FOCUS_STOPWORDS = new Set(
  "keep,keeps,the,and,for,are,but,not,you,all,with,our,from,that,this,these,those,into,over,under,more,most,such,than,then,there,their,what,when,where,which,while".split(
    ",",
  ),
);

const focusTerms = (focusNote: string): string[] =>
  focusNote
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 3 && !FOCUS_STOPWORDS.has(term));

/**
 * Reorder dropped entries so focus-matching entries come first (stable
 * newest-first within each group). Empty focus returns the input untouched.
 */
export function applyFocusNote(dropped: LedgerEntry[], focusNote: string): LedgerEntry[] {
  const terms = focusTerms(focusNote);
  if (!terms.length) return [...dropped];
  const matches = (entry: LedgerEntry): boolean => {
    const body = entry.body.toLowerCase();
    return terms.some((term) => body.includes(term));
  };
  return [...dropped.filter(matches), ...dropped.filter((entry) => !matches(entry))];
}

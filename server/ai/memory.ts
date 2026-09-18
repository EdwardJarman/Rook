/**
 * Per-Bot durable memory (v2 loop-mode).
 *
 * Grok-Bot parity rule: "Bots keep memory" — a Bot should remember how the
 * user likes work done across turns. Rook already stores a free-text
 * `memory` field per Bot on the client (synced via the workroom snapshot),
 * but nothing ever read it or wrote it. This module closes the loop:
 *
 * - `buildMemoryBlock(botMemory)` formats the stored memory for the system
 *   prompt (injected by the agent turn).
 * - `extractMemoryCandidates(userMessage)` deterministically spots durable
 *   user facts/preferences in a turn ("remember that…", "my X is…",
 *   "I prefer…", "always/never…"). No extra model call — regex-only, so it
 *   costs nothing on the shared free allowance and is fully testable.
 * - `mergeMemories(existing, candidates)` dedupes and caps the field so it
 *   can never bloat the prompt (max 20 lines / 2000 chars).
 *
 * The server returns candidates as `suggestedMemories`; the client appends
 * them via the workroom store (which persists through the existing snapshot
 * sync — no schema change, works offline).
 */

export type MemoryCandidate = { key: string; value: string };

export const MEMORY_LINE_LIMIT = 20;
export const MEMORY_CHAR_LIMIT = 2000;

const PATTERNS: Array<{ key: string; pattern: RegExp; format: (match: RegExpExecArray) => string }> = [
  {
    key: "note",
    pattern: /\bremember\s+(?:that\s+)?([^.!?\n]{4,140})/i,
    format: (match) => match[1] ?? "",
  },
  {
    key: "preference",
    pattern: /\bi\s+prefer\s+([^.!?\n]{4,140})/i,
    format: (match) => match[1] ?? "",
  },
  {
    key: "preference",
    pattern: /\bmy\s+(?:favorite|favourite|preferred)\s+([^.!?\n]{2,120})/i,
    format: (match) => `favorite ${match[1] ?? ""}`.trim(),
  },
  {
    key: "fact",
    pattern: /\bmy\s+([a-z][a-z \-]{1,28}?)\s+is\s+([^.!?\n]{2,120})/i,
    format: (match) => `${match[1] ?? ""} is ${match[2] ?? ""}`.trim(),
  },
  {
    key: "rule",
    pattern: /\balways\s+([^.!?\n]{4,140})/i,
    format: (match) => `always ${match[1] ?? ""}`.trim(),
  },
  {
    key: "rule",
    pattern: /\bnever\s+([^.!?\n]{4,140})/i,
    format: (match) => `never ${match[1] ?? ""}`.trim(),
  },
  {
    key: "work",
    pattern: /\bi\s+work\s+(?:as|at|with|on)\s+([^.!?\n]{3,120})/i,
    format: (match) => `works ${match[1] ?? ""}`.trim(),
  },
];

const SECRETY = /password|passcode|2fa|otp|token|secret|api[- ]?key|private[- ]?key|ssn|account number|card number|cvv/i;

const clean = (value: string): string =>
  value.replace(/\s+/g, " ").replace(/^["“”']+|["“”'.]+$/g, "").trim();

/** Pulls at most 2 durable candidates out of one user message. */
export function extractMemoryCandidates(message: string): MemoryCandidate[] {
  if (!message || message.length > 2000 || SECRETY.test(message)) return [];
  const found: MemoryCandidate[] = [];
  const consumed: Array<{ start: number; end: number }> = [];
  for (const { key, pattern, format } of PATTERNS) {
    if (found.length >= 2) break;
    // Fresh regex state per message (patterns are module-level globals by
    // reference; none use /g, but reset defensively against future edits).
    pattern.lastIndex = 0;
    const match = pattern.exec(message);
    if (!match || match.index === undefined) continue;
    const start = match.index;
    const end = start + match[0].length;
    // One sentence yields one candidate: skip spans already consumed by an
    // earlier (higher-priority) pattern.
    if (consumed.some((span) => start < span.end && end > span.start)) continue;
    const value = clean(format(match));
    if (value.length < 3 || value.length > 160) continue;
    if (found.some((entry) => entry.value.toLowerCase() === value.toLowerCase())) continue;
    consumed.push({ start, end });
    found.push({ key, value });
  }
  return found;
}

const parseLines = (memory: string): string[] =>
  memory
    .split("\n")
    .map((line) => line.trim().replace(/^[-•\d.)\s]+/, "").trim())
    .filter(Boolean);

/** Merges candidates into the stored field. Pure + capped. Returns null when unchanged. */
export function mergeMemories(
  existing: string | undefined,
  candidates: MemoryCandidate[],
): string | null {
  if (!candidates.length) return null;
  const base = (existing ?? "").trim();
  if (/^no preferences saved yet\.?$/i.test(base)) {
    return formatLines(candidates.map((entry) => `${entry.key}: ${entry.value}`));
  }
  const lines = parseLines(base);
  let changed = false;
  for (const candidate of candidates) {
    const line = `${candidate.key}: ${candidate.value}`;
    const duplicate = lines.some(
      (existingLine) =>
        existingLine.toLowerCase() === line.toLowerCase() ||
        existingLine.toLowerCase().endsWith(candidate.value.toLowerCase()),
    );
    if (duplicate) continue;
    lines.push(line);
    changed = true;
  }
  if (!changed) return null;
  return formatLines(lines);
}

const formatLines = (lines: string[]): string => {
  const trimmed = lines.slice(-MEMORY_LINE_LIMIT);
  let text = trimmed.join("\n");
  if (text.length > MEMORY_CHAR_LIMIT) {
    text = text.slice(-MEMORY_CHAR_LIMIT);
    const newline = text.indexOf("\n");
    text = newline >= 0 ? text.slice(newline + 1) : text;
  }
  return text.trim();
};

/** System-prompt block. Empty string when there is nothing worth injecting. */
export function buildMemoryBlock(botMemory: string | undefined): string {
  const memory = (botMemory ?? "").trim();
  if (!memory || /^no preferences saved yet\.?$/i.test(memory)) return "";
  const lines = parseLines(memory).slice(-12);
  if (!lines.length) return "";
  return `What you remember about this user (from earlier chats with this Bot — apply it without being asked, and never claim you remember things that are not listed here):\n${lines.map((line) => `- ${line}`).join("\n")}`;
}

/**
 * Persistent input history for `rook chat`: the up-arrow remembers across
 * sessions, readline-style. One JSON array of submitted lines at
 * <configDir>/history.json — same dir as the profile, Windows-safe paths.
 *
 * Everything degrades: a missing, corrupt, or read-only file never breaks
 * the REPL (history just starts fresh or stays in-memory). `pushHistory`
 * is pure; only load/save touch the filesystem.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { configDir } from "./config.js";

export const HISTORY_LIMIT = 200;

export const historyPath = (): string => join(configDir(), "history.json");

/** Pure append: skip blanks and consecutive duplicates, cap at `limit`. */
export function pushHistory(history: string[], line: string, limit = HISTORY_LIMIT): string[] {
  const trimmed = line.trim();
  if (!trimmed) return history;
  if (history[history.length - 1] === trimmed) return history;
  return [...history, trimmed].slice(-limit);
}

export function loadHistory(file = historyPath()): string[] {
  try {
    const data: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!Array.isArray(data)) return [];
    return data
      .filter((item): item is string => typeof item === "string" && item.trim() !== "")
      .slice(-HISTORY_LIMIT);
  } catch {
    // First run, corrupt file, or unreadable dir: start fresh, never crash.
    return [];
  }
}

export function saveHistory(history: string[], file = historyPath()): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(history.slice(-HISTORY_LIMIT), null, 2)}\n`);
  } catch {
    // Best effort: a read-only config dir must not break the session.
  }
}

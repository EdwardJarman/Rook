/**
 * Friendly CLI errors: did-you-mean suggestions, actionable hints per error
 * class, and distinct exit codes (usage 2, runtime 1). Pure except the
 * `fatal` routing, which lives in output.ts.
 */

/** Usage mistakes (bad flags, unknown commands). Exits 2 via run(). */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

/** Edit distance for did-you-mean. Pure, tiny inputs only. */
export function levenshtein(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x === y) return 0;
  if (!x.length) return y.length;
  if (!y.length) return x.length;
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= y.length; j += 1) {
      next[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (next[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + (x[i - 1] === y[j - 1] ? 0 : 1),
      );
    }
    prev = next as number[];
  }
  return prev[y.length] ?? Math.max(x.length, y.length);
}

/** Nearest candidate within a small distance, or undefined. Pure. */
export function suggestFrom(input: string, candidates: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestScore = 3;
  for (const candidate of candidates) {
    const score = levenshtein(input, candidate);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

/**
 * Actionable next step per error class. Pure — the router appends the hint
 * to fatal messages so every failure says what to do, not just what broke.
 */
export function hintForError(message: string): string | undefined {
  const text = message.toLowerCase();
  if (/not signed in|unauthorized|401|forbidden|sign-in expired|session/.test(text)) {
    return "Run `rook login` to sign in again.";
  }
  if (/unreachable|fetch failed|econnrefused|enotfound|timed out|timeout|network|status check failed/.test(text)) {
    return "Run `rook doctor` to diagnose, or `rook status` for providers.";
  }
  if (/no models|model.*not|unknown model/.test(text)) {
    return "Run `rook models` to list what this server offers.";
  }
  return undefined;
}

/** Append the hint when one matches; otherwise the message untouched. */
export function withHint(message: string): string {
  const hint = hintForError(message);
  return hint ? `${message} ${hint}` : message;
}

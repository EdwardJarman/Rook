/**
 * Shared reliability helpers for the Rook agent backend (v2).
 *
 * Extracted from scattered inline logic in `excel-agent.ts` / `chatgpt.ts`
 * so the behavior is tested in one place:
 * - web-search triggering (broad enough for real questions, narrow enough
 *   to keep "what time is it" instant)
 * - stripping model-emitted safety scaffolding without eating real content
 * - token budgeting / truncation for context + tool results
 * - tool-call dedup so the loop cannot spin on the same failing call
 * - friendly error mapping (raw provider errors -> user-readable lines)
 */

export const ROOK_AGENT_MAX_ROUNDS = 6;
/** Per-tool-result cap fed back to the model (v1 used 24k -> context blowup). */
export const ROOK_TOOL_RESULT_CHAR_LIMIT = 12_000;
/** Hard cap on total tool payload per turn to protect the context window. */
export const ROOK_TURN_TOOL_BUDGET_CHARS = 36_000;
/** Rough chars-per-token heuristic for budgeting (no tokenizer on server). */
export const ROOK_CHARS_PER_TOKEN = 4;

export function estimateTokens(chars: number): number {
  return Math.ceil(Math.max(0, chars) / ROOK_CHARS_PER_TOKEN);
}

/**
 * Grok-Bot-style grounding trigger: search when the user needs fresh,
 * external, or version-specific facts — never for clock questions, small
 * talk, or secrets.
 */
export function shouldSearchPublicWeb(message: string): boolean {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > 280) return false;
  if (
    /\b(password|passcode|2fa|one-time code|otp|token|secret|api key|private key|account number|ssn)\b/i.test(
      normalized,
    )
  ) {
    return false;
  }
  // Pure clock questions are answered from the live clock context.
  if (
    /^(what(?:'s| is) (the )?(time|date|day|today'?s date)|what day is (it|today)|current time|time now)\b[^?.!]*[?.!]?$/i.test(
      normalized,
    )
  ) {
    return false;
  }
  return new RegExp(
    [
      String.raw`\bsearch(?: the)? web\b`,
      String.raw`\blook(?: it)? up\b`,
      String.raw`\bresearch\b`,
      String.raw`\blatest\b`,
      String.raw`\bcurrent\b`,
      String.raw`\b(price of|stock price|weather|score|election|version|changelog|release notes|docs?|documentation|cve\b)`,
      String.raw`\bwho (won|is|was)\b`,
      String.raw`\bwhen (did|was|is)\b`,
      String.raw`\brelease(?:d|s)?\b`,
      String.raw`\bannounc(?:ed|ement)\b`,
      String.raw`\bnews\b`,
      String.raw`\bhappened\b`,
      String.raw`\bgithub (issue|repo|release)\b`,
    ].join("|"),
    "i",
  ).test(normalized);
}

/**
 * Some free models emit internal classifier scaffolding as text
 * ("User Safety: safe", "Response Safety: safe", "Policy: ...").
 * Never show that to the user — but never silently eat real content either.
 */
const SCAFFOLD_LINE =
  /^\s*(?:user safety|response safety|safety(?: level| status)?|moderation|classification|policy(?: check)?|harm(?:fulness)?|toxicity|jailbreak)\s*[:：\-–—].*$/i;

export function stripScaffolding(text: string): { clean: string; stripped: number } {
  const lines = text.split("\n");
  const kept = lines.filter((line) => !SCAFFOLD_LINE.test(line));
  const stripped = lines.length - kept.length;
  const clean = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { clean, stripped };
}

/** Truncate a tool result for model feedback, keeping valid JSON shape hints. */
export function toolResultText(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized.length <= ROOK_TOOL_RESULT_CHAR_LIMIT) return serialized;
  return `${serialized.slice(0, ROOK_TOOL_RESULT_CHAR_LIMIT)}… (result truncated to ${ROOK_TOOL_RESULT_CHAR_LIMIT.toLocaleString()} chars; ask for a smaller range, one file, or one page at a time)`;
}

/** Fingerprint for loop-dedup: same tool + same normalized args twice = spin. */
export function toolCallFingerprint(name: string, rawArgs: string): string {
  try {
    const parsed = JSON.parse(rawArgs || "{}") as unknown;
    return `${name}:${JSON.stringify(sortKeys(parsed))}`;
  } catch {
    return `${name}:${(rawArgs || "").slice(0, 500)}`;
  }
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, sortKeys(entry)]),
    );
  }
  return value;
}

/** Trim oldest context entries first until the turn fits a token budget. */
export function fitRecentContext<T extends { body: string }>(
  entries: T[],
  maxTokens: number,
): T[] {
  return partitionRecentContext(entries, maxTokens).kept;
}

/**
 * Words too common to signal topical relatedness. Kept small on purpose:
 * the relevance gate errs toward dropping (a wrongly-kept old topic
 * pollutes every answer; a wrongly-dropped one costs one clarification),
 * and the last exchange is always preserved for continuity regardless.
 */
const HISTORY_STOPWORDS = new Set(
  "about,after,again,also,and,are,because,been,before,between,both,can,could,did,does,doing,done,down,during,each,every,from,further,had,has,have,having,hello,help,here,how,into,itself,just,like,many,more,most,much,need,only,other,over,please,really,same,should,some,such,than,thanks,that,then,there,these,they,this,those,through,under,very,want,what,when,where,which,while,will,with,would,your".split(
    ",",
  ),
);

const significantTerms = (text: string): Set<string> => {
  const terms = new Set<string>();
  for (const token of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (token.length >= 4 && !HISTORY_STOPWORDS.has(token)) terms.add(token);
  }
  return terms;
};

/**
 * A message that cannot stand alone: short or pointing at prior turns
 * (pronouns, "continue", "what about"). Only such messages keep history
 * they do not topically match — everything else must earn its place.
 */
const REFERENTIAL_MESSAGE =
  /\b(it|its|this|that|these|those|them|they|he|she|him|her|his|hers|continue|more|again|also|above|same|other|another|else|previous|earlier|last|there|here|why|how come|what about|how about)\b/i;

const looksReferential = (message: string): boolean =>
  message.trim().length < 40 || REFERENTIAL_MESSAGE.test(message);

const sharedTermCount = (messageTerms: Set<string>, body: string): number => {
  const entryTerms = significantTerms(body);
  let shared = 0;
  for (const term of messageTerms) {
    if (entryTerms.has(term)) shared += 1;
  }
  return shared;
};

/**
 * Freshness gate for conversation history. Every recent message used to
 * ride every turn, so models (especially small free ones) kept re-raising
 * dead topics and tasks unprompted — even answering new questions as
 * continuations of old work.
 *
 * Rule, deliberately simple: a message that can stand alone (substantive,
 * no references) keeps only entries sharing its topic (≥1 significant
 * term) — a stale tail included, so fresh questions start truly fresh. A
 * referential message ("continue", "it", short follow-ups) keeps the last
 * exchange unconditionally for continuity, and older entries only on ≥2
 * shared terms. Gated-out past never reaches the model — not even via the
 * checkpoint ledger, which only condenses relevant overflow.
 */
export function filterRelevantContext<T extends { body: string }>(
  entries: T[],
  message: string,
): { relevant: T[]; gated: T[] } {
  if (!entries.length) return { relevant: [], gated: [] };
  const referential = looksReferential(message);
  const messageTerms = significantTerms(message);
  if (entries.length <= 2) {
    if (referential) return { relevant: entries, gated: [] };
    const relevant = entries.filter(
      (entry) => sharedTermCount(messageTerms, entry.body) >= 1,
    );
    return {
      relevant,
      gated: entries.filter((entry) => !relevant.includes(entry)),
    };
  }
  const tail = entries.slice(-2);
  const head = entries.slice(0, -2);
  const threshold = referential ? 2 : 1;
  const keptHead = head.filter(
    (entry) => sharedTermCount(messageTerms, entry.body) >= threshold,
  );
  const relevantTail = referential
    ? tail
    : tail.filter((entry) => sharedTermCount(messageTerms, entry.body) >= 1);
  const relevant = [...keptHead, ...relevantTail];
  return {
    relevant,
    gated: entries.filter((entry) => !relevant.includes(entry)),
  };
}

/**
 * Same as `fitRecentContext` but also returns what was dropped, so the
 * caller can condense it into a checkpoint ledger instead of losing it
 * silently (the pre-research behavior).
 */
export function partitionRecentContext<T extends { body: string }>(
  entries: T[],
  maxTokens: number,
): { kept: T[]; dropped: T[] } {
  let used = 0;
  const kept: T[] = [];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const cost = estimateTokens(entries[index].body.length + 64);
    if (used + cost > maxTokens && kept.length > 0) break;
    used += cost;
    kept.unshift(entries[index]);
  }
  return { kept, dropped: entries.slice(0, entries.length - kept.length) };
}

export function isCodeLikeRequest(message: string): boolean {
  if (
    /```|function |class |import |export |const |let |=>|def |fn |struct |package |SELECT |<[^>]+>|error|stack ?trace| traceback|npm |pnpm |cargo |pip |dockerfile|api|endpoint|regex|typescript|python|rust|sql/i.test(
      message,
    )
  ) {
    return true;
  }
  // Creation intent ("create a flappy bird game", "build me a website"):
  // needs code-sized output budgets even with no code words present.
  return /\b(create|build|make|write|implement|generate|code|develop)\b.{0,40}\b(game|app|website|web ?site|web app|component|script|program|bot|code|function|class|api|endpoint|module|page|tool)\b/i.test(
    message,
  );
}

/** Dynamic output budget: complete answers first — code work gets real room. */
export function maxTokensFor(message: string): number {
  if (message.length > 1500 || isCodeLikeRequest(message)) return 6000;
  if (message.length > 400) return 3500;
  return 2000;
}

/** How many times one turn may auto-continue a length-truncated answer. */
export const MAX_OUTPUT_CONTINUATIONS = 3;

/** Short tail marker, used ONLY after auto-continuations are exhausted. */
export const OUTPUT_LIMIT_TAIL =
  "\n\n…cut off at maximum length — say “continue” and I'll go on.";

/**
 * True for wobbles worth retrying or failing over to another provider
 * (rate limits, 5xx, timeouts, network blips). False for auth/config/model
 * errors where retrying only burns latency or surprises billing.
 */
export function isTransientAgentError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /429|rate.?limit|capacity.*full|temporarily|503|502|504|timed out|timeout|abort|network|fetch failed|did not return a response|empty response|empty reply/i.test(
    message,
  );
}

/** True when the provider rejected max_tokens itself — retry smaller, once. */
export function isMaxTokensError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /max_tokens.*(too large|too high|exceeds|maximum)|maximum.*tokens|output.*truncat/i.test(
    message,
  );
}

export function friendlyAgentError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/rate.?limit|429|capacity.*full|temporarily full/i.test(message))
    return "Free AI capacity is temporarily full — I kept your message. Please try again in a few seconds.";
  if (/401|needs attention|not configured|setup is required/i.test(message))
    return "Rook's AI connection needs attention (missing or invalid key). The team has been notified — please try again shortly.";
  if (/timed out|timeout|aborted|network|fetch failed|503|502|504/i.test(message))
    return "The AI request timed out before finishing. Please try again — shorter messages succeed fastest.";
  if (/context|too large|too long|token/i.test(message))
    return "That conversation got too long for one request. Start a fresh follow-up with the key details and I'll pick it up.";
  return "I couldn't produce a usable answer just now. Please try again — and if it repeats, try a shorter message or a different model.";
}

/** Sleep with equal-jitter exponential backoff (cap 8s, floor keeps loops honest). */
export async function backoffSleep(attempt: number, retryAfterMs?: number): Promise<void> {
  const cap = Math.min(500 * 2 ** attempt, 8000);
  const jittered = cap / 2 + Math.random() * (cap / 2);
  const delay = Math.min(Math.max(jittered, retryAfterMs ?? 0), 8000);
  await new Promise((resolve) => setTimeout(resolve, delay));
}

export function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

export type ReasoningEffort = "low" | "medium" | "high";

/**
 * Maps a requested reasoning depth to provider params. "medium" (the
 * default) maps to nothing — today's behavior, byte-identical requests —
 * so merely plumbing this through can never regress models that reject
 * reasoning params. "low"/"high" are sent explicitly where supported.
 */
export function reasoningFor(
  effort: ReasoningEffort | undefined,
): { effort: "low" | "high" } | undefined {
  if (effort === "high") return { effort: "high" };
  if (effort === "low") return { effort: "low" };
  return undefined;
}

/** True when a provider rejected the reasoning/thinking params themselves. */
export function isReasoningRejectedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    /reasoning|thinking/i.test(message) &&
    /unsupported|unknown|invalid|not supported|not allowed|unrecognized/i.test(message)
  );
}

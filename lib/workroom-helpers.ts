export type RiskTier = "Low" | "Medium" | "High";

/**
 * Auto-Review: a lightweight risk classifier that labels a request
 * Low/Medium/High. Only High pauses sending for an explicit decision —
 * Medium/High still surface as the task's risk label, and every genuinely
 * consequential *action* (Excel writes, computer tasks, node commands) is
 * gated server-side regardless of tier, so chat itself never executes.
 *
 * Design rules (learned from false-positive reports):
 * - Questions that merely ask about a sensitive topic are informational,
 *   not actions — they never block.
 * - Everyday dev/chat vocabulary (checkout a branch, pay attention, commit
 *   messages, remove a bug, share thoughts) must not trip financial /
 *   destructive patterns. Each risky pattern carries explicit anti-patterns.
 */
const ACTION_VERBS =
  /\b(delete|remove|discard|send|publish|post|email|share|buy|purchase|pay|checkout|charge|refund|deploy|implement|create|make|build|run|execute|transfer|revoke|rotate)\b/i;

const isInformationalQuestion = (text: string): boolean => {
  const trimmed = text.trim();
  if (!/\?\s*$/.test(trimmed)) return false;
  // Definitional frames explain rather than act — safe even when they name
  // a sensitive verb ("what does revoke do?").
  if (/^(what\s+(is|are|does|do)\b|explain\b|define\b|tell me (what|about)\b)/i.test(trimmed)) {
    return true;
  }
  if (ACTION_VERBS.test(trimmed)) return false;
  return /^(what|how|why|when|where|which|who|whose|can|could|would|should|is|are|do|does|did|tell me\b)/i.test(
    trimmed,
  );
};

export function assessRisk(input: string): { tier: RiskTier; reason: string } {
  const text = input.toLowerCase();

  if (isInformationalQuestion(input)) {
    return { tier: "Low", reason: "This is routine, reversible work." };
  }

  // High: irreversible, financial, or account/production-destructive.
  if (
    /\b(delete (all|everything|my account|the account|the workspace)|wire transfer|transfer \$?\d|permanently|irreversibl\w*)\b/.test(
      text,
    )
  ) {
    return {
      tier: "High",
      reason:
        "This action looks irreversible or account-wide. Rook will not proceed without your explicit confirmation.",
    };
  }
  if (
    /\b(purchase|refund)\b/.test(text) ||
    (/\bbuy\b/.test(text) && !/\bbuy[-\s]?in\b/.test(text)) ||
    (/\bpay\b/.test(text) && !/\bpay\s+(attention|heed|mind)\b/.test(text)) ||
    (/\bcharge\b/.test(text) &&
      !/\b(take|takes|taking)\s+charge\b/.test(text) &&
      !/\bin\s+charge\b/.test(text)) ||
    (/\bcheckout\b/.test(text) &&
      !/(branch|repo|repository|code|commit|\bpr\b|pull request|file|project|folder|theirs|ours)/.test(
        text,
      ))
  ) {
    return {
      tier: "High",
      reason: "This action could create a financial commitment.",
    };
  }
  if (/\b(deploy|production|prod\b|revoke|rotate.*key|change.*permission)\b/.test(text)) {
    return {
      tier: "High",
      reason: "This action could change access or a live system.",
    };
  }

  // Medium: reaches outside the workroom, or removes something, but is
  // reversible or scoped to a single item. Medium labels the task's risk
  // but never blocks sending — real consequences are gated server-side.
  // "Message" and "remove" have common code senses (commit messages, bug
  // removal) that are not outbound/destructive at all.
  const codeWordNear = (keyword: string): boolean =>
    new RegExp(
      `\\b(commit|error|console|system|toast|chat|bug|warning|lint|dead code|duplicate|unused)\\b.{0,16}\\b${keyword}\\b|\\b${keyword}\\b.{0,16}\\b(commit|error|console|system|toast|chat|bug|warning|lint|dead code|duplicate|unused)\\b`,
    ).test(text);
  const hasOutboundVerb = /\b(send|publish|post|email|message|share|invite)\b/.test(text);
  const hasNonMessageOutboundVerb =
    /\b(send|publish|post|email|share|invite)\b/.test(text);
  const messageIsCodeSense =
    text.includes("message") && codeWordNear("message");
  if (hasOutboundVerb && !(messageIsCodeSense && !hasNonMessageOutboundVerb)) {
    return {
      tier: "Medium",
      reason: "This action could communicate outside the workroom.",
    };
  }
  const hasDestructiveVerb = /\b(delete|remove|discard|archive)\b/.test(text);
  const destructiveIsCodeSense =
    (text.includes("remove") && codeWordNear("remove")) ||
    (text.includes("discard") && codeWordNear("discard"));
  if (hasDestructiveVerb && !destructiveIsCodeSense) {
    return {
      tier: "Medium",
      reason: "This action could remove information or an artifact.",
    };
  }

  // Low: drafting, summarizing, researching, reading — the default for
  // everyday requests. No approval friction.
  return {
    tier: "Low",
    reason: "This is routine, reversible work.",
  };
}

/** Back-compat wrapper: only High-risk requests pause for an explicit decision. */
export function requiresApproval(input: string): boolean {
  return assessRisk(input).tier === "High";
}

/** Back-compat wrapper returning the human-facing reason for the assessed tier. */
export function approvalReason(input: string): string {
  return assessRisk(input).reason;
}

export function fileSizeLabel(bytes?: number): string {
  if (!bytes || bytes < 1) return "Local file";
  if (bytes < 1024) return `${bytes} B`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Deliverable-first results: a completed reply that reads like a finished
 * document (multiple paragraphs, a heading, or a list) gets rendered as a
 * saveable result card instead of a plain chat bubble — closer to how
 * Manus/Grok Bot hand back finished artifacts rather than just text.
 */
export function isDeliverableWorthy(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 240) return false;
  const paragraphs = trimmed.split(/\n{2,}/).filter(Boolean);
  if (paragraphs.length >= 2) return true;
  return /(^|\n)#{1,3}\s|\n[-*]\s|\n\d+\.\s/.test(trimmed);
}

/** A short title guessed from a markdown heading or the first sentence. */
export function guessDeliverableTitle(text: string): string {
  const trimmed = text.trim();
  const heading = trimmed.match(/(^|\n)#{1,3}\s+(.+)/);
  if (heading?.[2]) return heading[2].trim().slice(0, 72);
  const firstLine = trimmed.split("\n")[0]?.trim() ?? "";
  const firstSentence = firstLine.split(/(?<=[.!?])\s/)[0] ?? firstLine;
  const candidate = (firstSentence || trimmed).slice(0, 72).trim();
  return candidate.length < (firstSentence || trimmed).length
    ? `${candidate}…`
    : candidate || "Result";
}

export function wordCount(text: string): number {
  const matches = text.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

/**
 * True for transport-level failures (cold start, wifi blip, server
 * restart) where one automatic retry is safe. Never true for auth,
 * validation, rate-limit, or provider errors — those must surface.
 */
export function isNetworkSendError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/unauthorized|forbidden|401|403|404|429|too_big|validation|400/i.test(message)) {
    return false;
  }
  return /fetch failed|failed to fetch|network|timed?\s?out|aborted|econn|socket|not reachable|connection refused/i.test(
    message,
  );
}

/**
 * Server reply-input caps. MIRROR of `workroom.reply` /
 * `/api/agent/stream` zod schemas (server/routers.ts,
 * server/agent-stream-route.ts) — keep in sync; a sync test pins the
 * numbers on both sides. Everything longer must be clamped client-side:
 * an overflow fails validation and the raw error JSON would otherwise
 * render as the bot's reply.
 */
export const REPLY_LIMITS = {
  botName: 80,
  botRole: 120,
  botPurpose: 500,
  message: 4000,
  botMemory: 4000,
  contextBody: 2000,
  contextDepth: 8,
} as const;

export const clampReplyField = (value: string, max: number): string =>
  value.length <= max ? value : value.slice(0, max);

export type RecentContextEntry = {
  author: "user" | "bot" | "system";
  body: string;
};

/** Newest-first history trimmed to what the server accepts. */
export function toRecentContextEntries<T extends RecentContextEntry>(
  messages: T[],
  depth = 6,
): RecentContextEntry[] {
  return messages
    .slice(-depth)
    .map((message) => ({
      author: message.author,
      body: clampReplyField(message.body, REPLY_LIMITS.contextBody),
    }));
}

/**
 * True for request-shape rejections (tRPC/zod validation payloads). These
 * must never render raw — they read as `[{ "code": "too_big", … }]`.
 */
export function isValidationSendError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const trimmed = message.trim();
  if (trimmed.startsWith("[") && trimmed.includes('"code"')) {
    return /too_big|too_small|invalid_type|invalid_string|invalid_literal|custom/i.test(
      trimmed.slice(0, 2000),
    );
  }
  return /Too big: expected string|too_small|expected .* to have <=/i.test(message);
}

export const VALIDATION_SEND_FALLBACK =
  "That couldn't be sent — part of the request was too long. Try a shorter message or a fresh chat.";

export type ReconcilableApproval = {
  externalActionId?: string;
  createdAtMs?: number;
};

/**
 * Drops locally-pending server-backed approvals the server no longer lists
 * (executed / expired / declined elsewhere) — but only after a successful
 * server load, and never within the grace window where the server list may
 * simply not include a just-created action yet. Local-only approvals
 * (no externalActionId) always survive.
 */
export function reconcileApprovals<T extends ReconcilableApproval>(
  local: T[],
  serverIds: Set<string> | null,
  nowMs: number,
  graceMs = 120_000,
): T[] {
  if (!serverIds) return local;
  return local.filter((approval) => {
    if (!approval.externalActionId) return true;
    if (serverIds.has(approval.externalActionId)) return true;
    const age = nowMs - (approval.createdAtMs ?? 0);
    return age < graceMs;
  });
}

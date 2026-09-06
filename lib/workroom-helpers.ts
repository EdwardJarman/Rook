export type RiskTier = "Low" | "Medium" | "High";

/**
 * Auto-Review: a lightweight risk classifier that decides whether a request
 * can proceed immediately (Low) or must pause for an explicit decision
 * (Medium/High). This replaces a single approve-or-not boolean so most
 * everyday requests — drafting, summarizing, research, reading — never
 * create approval friction, while genuinely consequential actions still
 * stop for a visible decision.
 */
export function assessRisk(input: string): { tier: RiskTier; reason: string } {
  const text = input.toLowerCase();

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
  if (/\b(purchase|buy|pay|checkout|charge|refund)\b/.test(text)) {
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
  // reversible or scoped to a single item.
  if (/\b(send|publish|post|email|message|share|invite)\b/.test(text)) {
    return {
      tier: "Medium",
      reason: "This action could communicate outside the workroom.",
    };
  }
  if (/\b(delete|remove|discard|archive)\b/.test(text)) {
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

/** Back-compat wrapper: only Medium/High risk requires an explicit decision. */
export function requiresApproval(input: string): boolean {
  return assessRisk(input).tier !== "Low";
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

/**
 * Pure mapping from `workroom.reply` results to desktop store writes.
 *
 * DOM- and network-free on purpose: the send-bridge stays a thin
 * transport, and every mapping decision here is unit-tested
 * (`reply-artifacts.test.ts`). Mirrors the mobile pipeline in
 * `app/(tabs)/index.tsx` so both surfaces produce the same artifacts.
 */
import type { Approval, Task, TraceStep } from "./workroom";
export type ReplyApproval = {
  actionId: string;
  title: string;
  detail: string;
  risk: "Medium";
};

export type ReplyProposal = {
  proposalId: string;
  title: string;
  url?: string;
  detail?: string;
};

export type ReplyMemory = { key: string; value: string };

export type ReplyResult = {
  text?: unknown;
  approvals?: ReplyApproval[];
  computerProposals?: ReplyProposal[];
  suggestedMemories?: ReplyMemory[];
  trace?: unknown;
};

/** Runtime-guarded trace mapping — provider payloads are never trusted blindly. */
export function traceFromReply(result: ReplyResult | undefined | null): TraceStep[] | undefined {
  if (!result || !Array.isArray(result.trace)) return undefined;
  const steps: TraceStep[] = [];
  for (const raw of result.trace) {
    if (!raw || typeof raw !== "object") continue;
    const step = raw as { kind?: unknown; title?: unknown; detail?: unknown; url?: unknown };
    if (typeof step.title !== "string" || !step.title) continue;
    steps.push({
      kind: typeof step.kind === "string" ? step.kind : "tool",
      title: step.title,
      ...(typeof step.detail === "string" ? { detail: step.detail } : {}),
      ...(typeof step.url === "string" ? { url: step.url } : {}),
    });
  }
  return steps.length ? steps : undefined;
}

const EXPIRY_MS = 24 * 60 * 60 * 1000;

export function nowIso(): string {
  return new Date().toISOString();
}

/** The reply body, or a visible placeholder — never blank, never a crash. */
export function replyTextOf(result: ReplyResult | undefined | null): string {
  const text = typeof result?.text === "string" ? result.text.trim() : "";
  return text || "…";
}

/** userVisible is true when the turn produced anything needing a decision. */
export function turnNeedsDecision(result: ReplyResult | undefined | null): boolean {
  return Boolean(
    result && ((result.approvals?.length ?? 0) > 0 || (result.computerProposals?.length ?? 0) > 0),
  );
}

export function messageKindFor(
  result: ReplyResult | undefined | null,
): "approval" | "message" {
  return turnNeedsDecision(result) ? "approval" : "message";
}

/**
 * Agent-turn approvals mapped onto the desktop Approval shape. Proposal
 * fields (proposalId/url) are preserved so a second device — or a future
 * Computer-panel runner — can act on them instead of reading a dead note.
 */
export function approvalsFromReply(
  result: ReplyResult | undefined | null,
  input: { botId: string; taskId: string; now?: string },
): Approval[] {
  if (!result) return [];
  const now = input.now ?? nowIso();
  const expiresAt = new Date(Date.now() + EXPIRY_MS).toISOString();
  const excel = (result.approvals ?? []).map((approval) => ({
    id: `apr-${approval.actionId}`,
    botId: input.botId,
    taskId: input.taskId,
    summary: approval.title,
    reason: approval.detail,
    capability: "excel",
    state: "pending" as const,
    createdAt: now,
    expiresAt,
    externalActionId: approval.actionId,
    agentKind: "excel" as const,
  }));
  const proposals = (result.computerProposals ?? []).map((proposal) => ({
    id: `apr-${proposal.proposalId}`,
    botId: input.botId,
    taskId: input.taskId,
    summary: proposal.title,
    reason:
      proposal.detail ??
      (proposal.url
        ? `Starting page: ${proposal.url}. Run it from the Computer panel once a Rook Node is online.`
        : "Review the plan above, then run it from the Computer panel once a Rook Node is online."),
    capability: "computer",
    state: "pending" as const,
    createdAt: now,
    expiresAt,
    agentKind: "computer" as const,
    ...(proposal.url ? { proposalUrl: proposal.url } : {}),
  }));
  return [...excel, ...proposals];
}

/** A Planning task for an outbound turn (status refined on completion). */
export function taskForSend(input: { botId: string; body: string }): Task {
  const title = input.body.length > 52 ? `${input.body.slice(0, 52)}…` : input.body;
  return {
    id: `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    botId: input.botId,
    title: title || "New task",
    status: "Planning",
    summary: "Preparing a focused response from your instructions.",
    startedAt: nowIso(),
    nextAction: "Review the result and decide what happens next.",
    risk: "Low",
    steps: [
      { id: "scope", label: "Understand the result you want", state: "active" },
      { id: "work", label: "Do the safe work", state: "pending" },
      { id: "return", label: "Return the result", state: "pending" },
    ],
  };
}

/**
 * Recent context scoped to the bots in this chat (mirrors mobile's
 * chatBotIds + activeChatId filter; the desktop live transcript is already
 * the active conversation, so bot membership is the filter that matters).
 * Bodies are clamped to the server's per-entry cap so a long earlier reply
 * can never fail validation and surface as a raw error payload.
 */
export function filterChatContext(
  messages: Array<{ botId: string | null; author: "user" | "bot" | "system"; body: string }>,
  chatBotIds: string[],
): Array<{ author: "user" | "bot" | "system"; body: string }> {
  return messages
    .filter((m) => m.botId === null || chatBotIds.includes(m.botId))
    .slice(-6)
    .map((m) => ({ author: m.author, body: m.body.slice(0, 2000) }));
}

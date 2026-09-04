/**
 * Approval protocol. Approvals are bound to the exact action, real origin,
 * page revision, and expire. An approval never authorizes page content or
 * model output on its own — the node re-validates it against the live command.
 */
import type { ApprovalProof, ApprovalRecord, Capability, CommandRejectCode, TypedAction } from "../types.js";
import type { RookDatabase } from "../state/database.js";
import { capabilityForAction, SENSITIVE_CAPABILITIES } from "../types.js";

export type ApprovalDecision =
  | { state: "approved" }
  | { state: "declined" }
  | { state: "expired" };

export class ApprovalManager {
  constructor(private readonly db: RookDatabase) {}

  /** Creates a pending approval record for a sensitive action. */
  request(input: {
    botId: string;
    pageId: string;
    action: TypedAction;
    capability: Capability;
    origin: string;
    recipient?: string;
    summary: string;
    fileHashes?: string[];
    pageRevision: number;
    ttlMs?: number;
  }): ApprovalRecord {
    const now = Date.now();
    const record: ApprovalRecord = {
      id: `approval-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      botId: input.botId,
      pageId: input.pageId,
      capability: input.capability,
      action: input.action,
      origin: input.origin,
      recipient: input.recipient,
      summary: input.summary,
      fileHashes: input.fileHashes ?? [],
      pageRevision: input.pageRevision,
      state: "pending",
      expiresAt: new Date(now + (input.ttlMs ?? 10 * 60_000)).toISOString(),
      createdAt: new Date(now).toISOString(),
    };
    this.db.insertApproval(record);
    return record;
  }

  async resolve(id: string, decision: ApprovalDecision): Promise<ApprovalRecord | undefined> {
    const record = this.db.getApproval(id);
    if (!record) return undefined;
    if (record.state !== "pending") return record;
    if (decision.state === "expired" || new Date(record.expiresAt).getTime() <= Date.now()) {
      this.db.resolveApproval(id, "expired");
      return this.db.getApproval(id);
    }
    this.db.resolveApproval(id, decision.state);
    return this.db.getApproval(id);
  }

  /** Expires any pending approvals older than their deadline. */
  expireOverdue(): void {
    const now = Date.now();
    for (const record of this.db.listApprovals("pending")) {
      if (new Date(record.expiresAt).getTime() <= now) this.db.resolveApproval(record.id, "expired");
    }
  }

  /**
   * Ingests a cloud-issued approval grant as an approved local record bound to
   * the exact action. The command still carries the proof and passes through
   * the same validateProof/consumeNonce gauntlet — the cloud is only ever the
   * approver of record; the node remains the enforcement point.
   */
  ingestCloudApproval(input: {
    botId: string;
    pageId: string;
    action: TypedAction;
    capability: Capability;
    origin: string;
    summary: string;
    grant: { approvalId: string; nonce: string; expiresAt: number; pageRevision: number };
  }): void {
    const record: ApprovalRecord = {
      id: input.grant.approvalId,
      botId: input.botId,
      pageId: input.pageId,
      capability: input.capability,
      action: input.action,
      origin: input.origin,
      recipient: undefined,
      summary: input.summary,
      fileHashes: [],
      pageRevision: input.grant.pageRevision,
      state: "approved",
      expiresAt: new Date(input.grant.expiresAt).toISOString(),
      createdAt: new Date().toISOString(),
    };
    this.db.insertApproval(record);
  }

  /**
   * Validates an ApprovalProof carried by a command. Returns a rejection code
   * or undefined when the approval is valid and unexpired.
   */
  validateProof(proof: ApprovalProof, action: TypedAction, capability: Capability): CommandRejectCode | undefined {
    if (!proof || !SENSITIVE_CAPABILITIES.has(capability)) return "APPROVAL_INVALID";
    // The proof must match the exact action it was granted for.
    if (JSON.stringify({ type: proof.actionSummary }) !== JSON.stringify({ type: action.type })) {
      return "APPROVAL_INVALID";
    }
    if (proof.pageRevision < 0) return "APPROVAL_INVALID";
    const record = this.db.getApproval(proof.approvalId);
    if (!record || record.state !== "approved") return "APPROVAL_INVALID";
    if (record.capability !== capability) return "APPROVAL_INVALID";
    if (JSON.stringify(record.action) !== JSON.stringify(action)) return "APPROVAL_INVALID";
    if (new Date(record.expiresAt).getTime() <= Date.now()) return "APPROVAL_EXPIRED";
    if (proof.expiresAt <= Date.now()) return "APPROVAL_EXPIRED";
    // One-time nonce replay protection.
    if (this.db.hasSeenApprovalNonce(proof.nonce)) return "APPROVAL_REPLAYED";
    return undefined;
  }

  /** Marks an approval proof nonce as consumed (called after successful execution). */
  consumeNonce(proof: ApprovalProof): void {
    this.db.markApprovalNonce(proof.nonce);
  }

  list(botId?: string, state?: string): ApprovalRecord[] {
    const all = this.db.listApprovals(state);
    return botId ? all.filter((record) => record.botId === botId) : all;
  }
}
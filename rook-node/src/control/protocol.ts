/**
 * Command protocol validation.
 *
 * The node — not the model and not the frontend — is the execution authority.
 * Every command is checked for:
 *   - version and shape
 *   - freshness (issuedAt within skew, deadline not expired)
 *   - replay protection (per-device sequence + one-time nonce)
 *   - cross-user / cross-bot / cross-page consistency with the device binding
 *   - page revision matching the tab's current revision
 *   - requested capability against the action vocabulary
 *   - approval presence and expiry for sensitive capabilities
 */
import type {
  ApprovalProof,
  Capability,
  CommandEnvelope,
  CommandRejectCode,
  CommandResult,
  TypedAction,
} from "../types.js";
import { SENSITIVE_CAPABILITIES } from "../types.js";
import { allowsCapability, capabilityForAction, COMMAND_SKEW_MS } from "../types.js";
import type { RookDatabase } from "../state/database.js";

export interface DeviceBinding {
  deviceId: string;
  userId: string;
  /** Bots this device may drive. Empty array denies everything. */
  allowedBotIds: string[];
}

export type ValidationDeps = {
  db: RookDatabase;
  now?: () => number;
  /** Look up the device binding for a deviceId. */
  bindingForDevice: (deviceId: string) => DeviceBinding | undefined;
  /** Resolve current tab revision for a pageId (undefined if unknown page). */
  tabRevision: (pageId: string) => number | undefined;
  /** Validate approval proof. Return rejection code or undefined when valid. */
  validateApproval?: (approval: ApprovalProof, action: TypedAction, capability: Capability) => CommandRejectCode | undefined;
};

const ACTION_KEYS = new Set([
  "type", "goto", "click", "clickAt", "press", "select", "scrollTo", "scrollBy",
  "drag", "hover", "readUrl", "readTitle", "readText", "readAttribute", "screenshot",
  "newTab", "switchTab", "closeTab", "back", "forward", "reload",
]);

export class CommandValidator {
  constructor(private readonly deps: ValidationDeps) {}

  /** Validates a raw envelope. On success, executes the callback with the valid command. */
  validate(envelope: unknown): { ok: true; command: CommandEnvelope } | { ok: false; code: CommandRejectCode; message: string } {
    const now = this.deps.now?.() ?? Date.now();
    if (!isEnvelope(envelope)) return { ok: false, code: "INVALID", message: "Malformed command" };
    const command = envelope;

    if (command.version !== 1) return { ok: false, code: "INVALID", message: "Unsupported protocol version" };

    // Freshness
    if (command.issuedAt > now + COMMAND_SKEW_MS) return { ok: false, code: "STALE", message: "Command issued in the future" };
    if (command.issuedAt < now - 5 * 60_000) return { ok: false, code: "STALE", message: "Command is too old" };
    if (command.deadline <= now) return { ok: false, code: "EXPIRED", message: "Command expired" };
    if (command.deadline < command.issuedAt) return { ok: false, code: "INVALID", message: "Deadline precedes issue time" };

    // Device binding
    const binding = this.deps.bindingForDevice(command.deviceId);
    if (!binding) return { ok: false, code: "CROSS_USER", message: "Unknown device" };
    if (binding.userId !== command.userId) return { ok: false, code: "CROSS_USER", message: "Command user does not match device user" };
    if (!binding.allowedBotIds.includes(command.botId)) return { ok: false, code: "CROSS_BOT", message: "Device cannot drive this Bot" };

    // Page revision
    // newTab is allowed to carry a placeholder page: the tab cannot exist
    // before the command that creates it.
    if (command.action.type !== "newTab") {
      const revision = this.deps.tabRevision(command.pageId);
      if (revision === undefined) return { ok: false, code: "REVISION", message: "Unknown page" };
      if (command.pageRevision !== revision) return { ok: false, code: "REVISION", message: "Page changed since command was prepared" };
    }

    // Capability must be claimable for the action.
    if (!allowsCapability(command.action, command.capability)) {
      return { ok: false, code: "UNAUTHORIZED_CAPABILITY", message: `Capability ${command.capability} is not claimable for this action` };
    }

    // Sensitive actions need a valid, unexpired approval.
    if (SENSITIVE_CAPABILITIES.has(command.capability)) {
      if (!command.approval) return { ok: false, code: "APPROVAL_MISSING", message: "This action requires explicit approval" };
      const rejection = this.deps.validateApproval?.(command.approval, command.action, command.capability);
      if (rejection) return { ok: false, code: rejection, message: "Approval is not valid for this action" };
    }

    // Replay protection must be the last gate so a replay attempt that fails any
    // earlier check cannot advance the sequence.
    const seen = this.deps.db.recordCommandSeen(command.deviceId, command.botId, command.pageId, command.seq, command.nonce);
    if (!seen) return { ok: false, code: "REPLAYED", message: "Replayed or out-of-order command" };

    return { ok: true, command };
  }
}

function isEnvelope(value: unknown): value is CommandEnvelope {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.version === "number" &&
    typeof v.deviceId === "string" &&
    typeof v.userId === "string" &&
    typeof v.botId === "string" &&
    typeof v.pageId === "string" &&
    typeof v.seq === "number" &&
    Number.isInteger(v.seq) &&
    v.seq >= 0 &&
    typeof v.nonce === "string" &&
    v.nonce.length >= 8 &&
    v.nonce.length <= 96 &&
    typeof v.issuedAt === "number" &&
    typeof v.deadline === "number" &&
    typeof v.pageRevision === "number" &&
    typeof v.capability === "string" &&
    isAction(v.action) &&
    (v.approval === undefined || isApproval(v.approval))
  );
}

export function isAction(value: unknown): value is TypedAction {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.type !== "string" || !ACTION_KEYS.has(v.type)) return false;
  return true;
}

function isApproval(value: unknown): value is ApprovalProof {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.approvalId === "string" &&
    typeof v.origin === "string" &&
    typeof v.actionSummary === "string" &&
    Array.isArray(v.fileHashes) &&
    v.fileHashes.every((h) => typeof h === "string") &&
    typeof v.pageRevision === "number" &&
    typeof v.expiresAt === "number" &&
    typeof v.nonce === "string"
  );
}

export function reject(code: CommandRejectCode, message: string): CommandResult {
  return { ok: false, code, message };
}
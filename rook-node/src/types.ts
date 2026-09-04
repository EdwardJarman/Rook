/**
 * Shared type definitions for Rook Node.
 *
 * These types define the wire protocol between the Rook app and the local
 * node, the control lease state machine, the typed browser action vocabulary,
 * and the durable records stored in local SQLite.
 */

export const PROTOCOL_VERSION = 1;

/** Control lease owner. Only one actor may mutate a page at a time. */
export type LeaseState = "BOT" | "HUMAN" | "PAUSED" | "NONE";

/** Connection status surfaced by the Computer panel. */
export type ConnectionStatus =
  | "On this device"
  | "Local network"
  | "Direct remote"
  | "Your relay"
  | "Restoring"
  | "Offline";

/** Controller status surfaced by the Computer panel. */
export type ControllerStatus =
  | "Bot controlling"
  | "You controlling"
  | "Waiting for approval"
  | "Paused"
  | "View only";

/** Capability requested by a command. Reading/scroll may be policy-allowed;
 * anything consequential requires the capability to be present. */
export type Capability =
  | "navigate"
  | "read"
  | "scroll"
  | "form"
  | "upload"
  | "message"
  | "account"
  | "purchase"
  | "delete"
  | "security"
  | "irreversible";

/** Sensitive actions that require an explicit approval bound to the action. */
export const SENSITIVE_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
  "form",
  "upload",
  "message",
  "account",
  "purchase",
  "delete",
  "security",
  "irreversible",
]);

/** Typed browser actions understood by the executor. No arbitrary eval. */
export type TypedAction =
  | { type: "goto"; url: string }
  | { type: "click"; selector: string }
  | { type: "clickAt"; x: number; y: number }
  | { type: "type"; selector: string; text: string }
  | { type: "press"; key: string }
  | { type: "select"; selector: string; value: string }
  | { type: "scrollTo"; x: number; y: number }
  | { type: "scrollBy"; deltaX: number; deltaY: number }
  | { type: "drag"; fromX: number; fromY: number; toX: number; toY: number }
  | { type: "hover"; selector: string }
  | { type: "readUrl" }
  | { type: "readTitle" }
  | { type: "readText"; selector?: string }
  | { type: "readAttribute"; selector: string; attribute: string }
  | { type: "screenshot"; format?: "jpeg" | "png" }
  | { type: "newTab"; url: string }
  | { type: "switchTab"; pageId: string }
  | { type: "closeTab"; pageId?: string }
  | { type: "back" }
  | { type: "forward" }
  | { type: "reload" };

/** Default capability a planner should claim for an action. */
export function capabilityForAction(action: TypedAction): Capability {
  switch (action.type) {
    case "goto":
    case "newTab":
    case "back":
    case "forward":
    case "reload":
      return "navigate";
    case "readUrl":
    case "readTitle":
    case "readText":
    case "readAttribute":
    case "screenshot":
    case "switchTab":
    case "closeTab":
      return "read";
    case "scrollTo":
    case "scrollBy":
      return "scroll";
    case "click":
    case "clickAt":
    case "hover":
    case "drag":
      return "read";
    case "type":
    case "press":
    case "select":
      return "form";
  }
}

/** Whether a command may claim the given capability for an action. */
export function allowsCapability(action: TypedAction, capability: Capability): boolean {
  const claimed = capabilityForAction(action);
  if (claimed === capability) return true;
  // Interaction actions can be the vehicle for consequential outcomes, so a
  // planner may claim a stronger consequence capability for them.
  switch (action.type) {
    case "click":
    case "clickAt":
    case "type":
    case "press":
    case "select":
    case "drag":
      return SENSITIVE_CAPABILITIES.has(capability);
    default:
      return false;
  }
}

/** Command envelope sent by the Rook app to the node. */
export type CommandEnvelope = {
  version: number;
  /** Ed25519 public key id of the paired device. */
  deviceId: string;
  userId: string;
  botId: string;
  pageId: string;
  /** Monotonic sequence number per (device, bot, page). */
  seq: number;
  /** One-time random nonce for replay protection. */
  nonce: string;
  /** Issued at (epoch ms). */
  issuedAt: number;
  /** Hard deadline (epoch ms). */
  deadline: number;
  /** Expected page revision; rejects commands racing a navigation. */
  pageRevision: number;
  /** Requested capability. */
  capability: Capability;
  action: TypedAction;
  /** Present only when the capability requires approval. */
  approval?: ApprovalProof;
};

/** A signed approval bound to the exact action. */
export type ApprovalProof = {
  approvalId: string;
  /** Bot, real origin, action, recipient/destination, non-secret values. */
  origin: string;
  recipient?: string;
  actionSummary: string;
  /** SHA-256 hashes of any files involved. */
  fileHashes: string[];
  /** Page revision the approval was granted against. */
  pageRevision: number;
  expiresAt: number;
  /** One-time nonce. */
  nonce: string;
  signature?: string;
};

export type CommandResult =
  | { ok: true; value: unknown }
  | { ok: false; code: CommandRejectCode; message: string };

export type CommandRejectCode =
  | "STALE"
  | "REPLAYED"
  | "CROSS_USER"
  | "CROSS_BOT"
  | "EXPIRED"
  | "REVISION"
  | "LEASE"
  | "UNAUTHORIZED_CAPABILITY"
  | "APPROVAL_MISSING"
  | "APPROVAL_REPLAYED"
  | "APPROVAL_EXPIRED"
  | "APPROVAL_INVALID"
  | "UNKNOWN_ACTION"
  | "INVALID";

/** Durable records. */

export type BotRecord = {
  id: string;
  name: string;
  role: string;
  /** "shared" (default Rook browser) or "private" (isolated profile). */
  identity: "shared" | "private";
  /** Profile subdirectory when identity === "private". */
  profileDir?: string;
  createdAt: string;
};

export type TabRecord = {
  id: string;
  botId: string;
  /** Stable user-facing tab index within the Bot's group. */
  groupIndex: number;
  url: string;
  title: string;
  /** Monotonic revision, incremented on every navigation. */
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type FileRecord = {
  /** Opaque content-addressed id. */
  id: string;
  /** SHA-256 of content. */
  hash: string;
  name: string;
  scope: "shared" | "bot" | "download" | "quarantine" | "upload";
  botId?: string;
  sizeBytes: number;
  /** Relative path inside the workspace (never an absolute host path). */
  relPath: string;
  /** Immutable version number. */
  version: number;
  createdAt: string;
};

export type ApprovalRecord = {
  id: string;
  botId: string;
  pageId: string;
  capability: Capability;
  action: TypedAction;
  origin: string;
  recipient?: string;
  summary: string;
  fileHashes: string[];
  pageRevision: number;
  state: "pending" | "approved" | "declined" | "expired";
  expiresAt: string;
  createdAt: string;
  resolvedAt?: string;
};

export type JobRecord = {
  id: string;
  botId: string;
  description: string;
  status: "queued" | "working" | "waiting" | "completed" | "failed" | "cancelled";
  progress?: string;
  createdAt: string;
  updatedAt: string;
};

export type EventRecord = {
  id: string;
  botId: string;
  kind: string;
  payload: string;
  createdAt: string;
};

export type LeaseRecord = {
  botId: string;
  state: LeaseState;
  /** Fencing number; incremented on every takeover. */
  fencing: number;
  /** Device id currently holding the lease ("" when NONE). */
  holderDeviceId: string;
  updatedAt: string;
};

export type NodeIdentity = {
  nodeId: string;
  deviceKeyId: string;
  createdAt: string;
};

/** Health snapshot reported to the app. */
export type NodeHealth = {
  running: boolean;
  browserPid: number | null;
  profileReady: boolean;
  bots: number;
  tabs: number;
  pendingApprovals: number;
  leases: Record<string, LeaseRecord>;
  version: string;
  startedAt: string | null;
};

export const WORKSPACE_LAYOUT = {
  shared: "shared",
  bots: "bots",
  quarantine: "quarantine",
  state: "state",
} as const;

export const MAX_FILE_BYTES = 200 * 1024 * 1024;
export const MAX_COMMAND_BYTES = 256 * 1024;
export const COMMAND_SKEW_MS = 5_000;
export const DEFAULT_COMMAND_DEADLINE_MS = 60_000;
export const MAX_OPEN_TABS_PER_BOT = 12;

import type { WorkroomCloudSnapshot } from "./workroom-snapshot";

export type UserRole = "user" | "admin";

export type User = {
  id: string;
  openId: string;
  name: string | null;
  email: string | null;
  loginMethod: string | null;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
  lastSignedIn: Date;
};

export type InsertUser = {
  openId: string;
  name?: string | null;
  email?: string | null;
  loginMethod?: string | null;
  role?: UserRole;
  createdAt?: Date;
  updatedAt?: Date;
  lastSignedIn?: Date;
};

export type PushDevice = {
  id: string;
  userId: string;
  installationId: string;
  expoPushToken: string;
  approvalEnabled: boolean;
  completionEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type InsertPushDevice = {
  installationId: string;
  expoPushToken: string;
  approvalEnabled: boolean;
  completionEnabled: boolean;
};

export type MicrosoftConnection = {
  id: string;
  accountId: string;
  userId: string;
  microsoftUserId: string;
  displayName: string | null;
  email: string | null;
  encryptedAccessToken: string;
  encryptedRefreshToken: string;
  expiresAt: Date;
  scopes: string;
  status: "connected" | "reauthorize";
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type InsertMicrosoftConnection = Omit<
  MicrosoftConnection,
  "id" | "createdAt" | "updatedAt" | "isPrimary"
> & {
  displayName?: string | null;
  email?: string | null;
  status?: "connected" | "reauthorize";
  isPrimary?: boolean;
};

export type GithubConnection = {
  id: string;
  userId: string;
  githubUserId: string;
  login: string;
  displayName: string | null;
  avatarUrl: string | null;
  encryptedAccessToken: string;
  encryptedRefreshToken: string | null;
  expiresAt: Date;
  scopes: string;
  status: "connected" | "reauthorize";
  createdAt: Date;
  updatedAt: Date;
};

export type InsertGithubConnection = Omit<
  GithubConnection,
  "id" | "createdAt" | "updatedAt"
> & {
  displayName?: string | null;
  avatarUrl?: string | null;
  encryptedRefreshToken?: string | null;
  status?: "connected" | "reauthorize";
};

export type GithubSelectedRepo = {
  id: string;
  userId: string;
  fullName: string;
  repoId: number;
  privateRepo: boolean;
  defaultBranch: string | null;
  description: string | null;
  addedAt: Date;
};

export type InsertGithubSelectedRepo = Omit<
  GithubSelectedRepo,
  "id" | "addedAt" | "userId"
> & { addedAt?: Date };

export type ExcelActionState =
  "pending" | "executing" | "executed" | "failed" | "declined" | "expired";

export type ExcelPendingAction = {
  id: string;
  userId: string;
  botClientId: string;
  taskClientId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  summary: string;
  state: ExcelActionState;
  result?: unknown;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type InsertExcelPendingAction = Omit<
  ExcelPendingAction,
  "createdAt" | "updatedAt" | "state" | "result"
> & {
  state?: ExcelActionState;
  result?: unknown;
};

export type WorkroomSnapshotRecord = {
  id: string;
  userId: string;
  syncVersion: string;
  snapshot: WorkroomCloudSnapshot;
  createdAt: Date;
  updatedAt: Date;
};

export type RookNodeRecord = {
  id: string;
  nodeId: string;
  userId: string;
  name: string;
  status: "online" | "offline" | "revoked";
  version: string;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

/** Cloud-side command queued for a Rook Node. `envelope` is the node protocol CommandEnvelope. */
export type NodeCommandRecord = {
  id: string;
  commandId: string;
  userId: string;
  nodeId: string;
  state:
    | "awaiting_approval"
    | "pending"
    | "delivered"
    | "completed"
    | "declined"
    | "expired";
  summary: string;
  capability: string;
  envelope: Record<string, unknown>;
  approval?: Record<string, unknown>;
  result?: unknown;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

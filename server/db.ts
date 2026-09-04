import { id, init } from "@instantdb/admin";
import { randomBytes } from "node:crypto";

import {
  APPROVAL_GRANT_TTL_MS,
  COMMAND_TTL_MS,
  DESKTOP_PAIRING_MAX_ATTEMPTS,
  DESKTOP_PAIRING_REQUEST_TTL_MS,
  PAIRING_TOKEN_TTL_MS,
  desktopPairingCodeDigest,
  generateApprovalId,
  generateDesktopPairingCode,
  generateDesktopPairingRequestId,
  generatePairingToken,
  hashToken,
  secretsMatch,
} from "../shared/node-relay";
import schema from "../instant.schema";
import type {
  ExcelPendingAction,
  InsertExcelPendingAction,
  InsertMicrosoftConnection,
  InsertPushDevice,
  InsertUser,
  MicrosoftConnection,
  NodeCommandRecord,
  PushDevice,
  RookNodeRecord,
  User,
  WorkroomSnapshotRecord,
} from "../shared/database";
import type { WorkroomCloudSnapshot } from "../shared/workroom-snapshot";
import { ENV } from "./_core/env";

const ROOK_INSTANT_APP_ID = "ed69763d-c8a4-4a28-8bed-c13806f2493d";

function createInstantDb() {
  return init({
    appId: ENV.instantAppId || ROOK_INSTANT_APP_ID,
    adminToken: ENV.instantAppAdminToken,
    schema,
    useDateObjects: true,
  });
}

type InstantDb = ReturnType<typeof createInstantDb>;
type ArrayElement<T> = T extends ReadonlyArray<infer Item> ? Item : T;
type InstantTx = ArrayElement<Parameters<InstantDb["transact"]>[0]>;
const INSTANT_TX_BATCH_SIZE = 75;

let _db: InstantDb | null = null;
let warnedMissingCredentials = false;

/**
 * Lazily initialize the server-only InstantDB Admin client. The admin token is
 * never available to the Expo bundle and must be supplied by the deployment.
 */
export async function getDb(): Promise<InstantDb | null> {
  if (_db) return _db;
  if (!ENV.instantAppAdminToken) {
    if (!warnedMissingCredentials) {
      console.warn(
        "[InstantDB] INSTANT_APP_ADMIN_TOKEN is not configured; persistence is unavailable",
      );
      warnedMissingCredentials = true;
    }
    return null;
  }

  _db = createInstantDb();
  return _db;
}

async function requireDb(): Promise<InstantDb> {
  const database = await getDb();
  if (!database) throw new Error("Database is unavailable");
  return database;
}

async function transactInBatches(database: InstantDb, chunks: InstantTx[]) {
  for (let index = 0; index < chunks.length; index += INSTANT_TX_BATCH_SIZE) {
    await database.transact(chunks.slice(index, index + INSTANT_TX_BATCH_SIZE));
  }
}

const nullable = <T>(value: T | null | undefined): T | null => value ?? null;
const asDate = (value: Date | string | number): Date =>
  value instanceof Date ? value : new Date(value);
/** asDate for loosely-typed InstantDB rows. */
const asDateValue = (value: unknown): Date =>
  value instanceof Date ? value : typeof value === "string" || typeof value === "number" ? new Date(value) : new Date(0);

/* ---- Explicit row contracts ----
 * InstantDB's inferred query row types can collapse to bare `{ id }` under
 * different TypeScript/bundler environments (observed on Vercel builds), so
 * every query result below is cast through these types instead of relying on
 * inference. This keeps the deployed build deterministic. */
type WithId = { id: string };
type UserRow = User & WithId;
type PushDeviceRow = PushDevice & WithId;
type NotificationPreferencesRow = {
  id: string;
  userId: string;
  approvalEnabled: boolean;
  completionEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};
type WorkroomSnapshotRow = WorkroomSnapshotRecord;
type WorkroomItemRow = { id: string; createdAt: Date; updatedAt: Date } & Record<string, unknown>;
type MicrosoftOAuthStateRow = {
  id: string;
  state: string;
  userId: string;
  codeVerifier: string;
  returnTo: string;
  expiresAt: Date;
  createdAt: Date;
};
type MicrosoftConnectionRow = MicrosoftConnection & WithId;
type ExcelActionClaimRow = { id: string; actionId: string; userId: string; createdAt: Date };
type ExcelPendingActionRow = ExcelPendingAction & {
  actionId: string;
  botClientId: string;
  taskClientId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  summary: string;
  state: string;
};
type PairingTokenRow = {
  id: string;
  tokenHash: string;
  userId: string;
  usedByNodeId?: string;
  expiresAt: Date;
  createdAt: Date;
};
type DesktopPairingRequestRow = {
  id: string;
  requestId: string;
  codeHash?: string;
  userId?: string;
  name: string;
  version: string;
  attempts: number;
  state: string;
  usedByNodeId?: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
};
export type DesktopPairingRequest = {
  requestId: string;
  name: string;
  version: string;
  state: "pending" | "code-issued" | "consumed" | "expired" | "locked";
  expiresAt: Date;
};
const withTimestamps = <T extends { createdAt: Date; updatedAt: Date }>(
  entity: T,
): T => ({
  ...entity,
  createdAt: asDate(entity.createdAt),
  updatedAt: asDate(entity.updatedAt),
});

function asUser(entity: UserRow): User {
  return {
    id: entity.id,
    openId: entity.openId,
    name: nullable(entity.name),
    email: nullable(entity.email),
    loginMethod: nullable(entity.loginMethod),
    role: entity.role === "admin" ? "admin" : "user",
    createdAt: asDate(entity.createdAt),
    updatedAt: asDate(entity.updatedAt),
    lastSignedIn: asDate(entity.lastSignedIn),
  };
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");

  const database = await getDb();
  if (!database) {
    console.warn("[InstantDB] Cannot upsert user: database not available");
    return;
  }

  try {
    const existing = await getUserByOpenId(user.openId);
    const now = new Date();
    const role =
      user.role ??
      existing?.role ??
      (user.openId === ENV.ownerOpenId ? "admin" : "user");

    await database.transact(
      database.tx.users.lookup("openId", user.openId).update({
        role,
        createdAt: user.createdAt ?? existing?.createdAt ?? now,
        updatedAt: user.updatedAt ?? now,
        lastSignedIn: user.lastSignedIn ?? existing?.lastSignedIn ?? now,
        ...(user.name !== undefined ? { name: user.name ?? undefined } : {}),
        ...(user.email !== undefined ? { email: user.email ?? undefined } : {}),
        ...(user.loginMethod !== undefined
          ? { loginMethod: user.loginMethod ?? undefined }
          : {}),
      }),
    );
  } catch (error) {
    console.error("[InstantDB] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string): Promise<User | undefined> {
  const database = await getDb();
  if (!database) return undefined;
  const { users } = (await database.query({
    users: { $: { where: { openId }, limit: 1 } },
  })) as { users: UserRow[] };
  return users[0] ? asUser(users[0]) : undefined;
}

export async function upsertPushDevice(
  userId: string,
  device: InsertPushDevice,
) {
  const database = await getDb();
  if (!database) return false;
  const existing = await getPushDevice(device.installationId);
  const now = new Date();
  await database.transact(
    database.tx.pushDevices
      .lookup("installationId", device.installationId)
      .update({
        userId,
        expoPushToken: device.expoPushToken,
        approvalEnabled: device.approvalEnabled,
        completionEnabled: device.completionEnabled,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }),
  );
  return true;
}

export async function getPushDevice(installationId: string) {
  const database = await getDb();
  if (!database) return undefined;
  const { pushDevices } = (await database.query({
    pushDevices: { $: { where: { installationId }, limit: 1 } },
  })) as { pushDevices: PushDeviceRow[] };
  return pushDevices[0] ? withTimestamps(pushDevices[0]) : undefined;
}

export async function getPushDevicesForUser(userId: string): Promise<PushDevice[]> {
  const database = await getDb();
  if (!database) return [];
  const { pushDevices } = (await database.query({
    pushDevices: { $: { where: { userId } } },
  })) as { pushDevices: PushDeviceRow[] };
  return pushDevices.map(withTimestamps);
}

export async function getNotificationPreferences(userId: string) {
  const database = await getDb();
  if (!database) return undefined;
  const { userNotificationPreferences } = (await database.query({
    userNotificationPreferences: {
      $: { where: { userId }, limit: 1 },
    },
  })) as { userNotificationPreferences: NotificationPreferencesRow[] };
  return userNotificationPreferences[0]
    ? withTimestamps(userNotificationPreferences[0])
    : undefined;
}

export async function upsertNotificationPreferences(
  userId: string,
  preferences: { approvalEnabled: boolean; completionEnabled: boolean },
) {
  const database = await getDb();
  if (!database) return false;
  const existing = await getNotificationPreferences(userId);
  const now = new Date();
  await database.transact(
    database.tx.userNotificationPreferences.lookup("userId", userId).update({
      ...preferences,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }),
  );
  return true;
}

export async function getWorkroomSnapshot(userId: string) {
  const database = await getDb();
  if (!database) return undefined;
  const { workroomSnapshots } = (await database.query({
    workroomSnapshots: { $: { where: { userId }, limit: 1 } },
  })) as { workroomSnapshots: WorkroomSnapshotRow[] };
  return workroomSnapshots[0]
    ? withTimestamps(workroomSnapshots[0])
    : undefined;
}

export async function upsertWorkroomSnapshot(
  userId: string,
  snapshot: WorkroomCloudSnapshot,
) {
  const database = await getDb();
  if (!database) return false;
  const existing = await getWorkroomSnapshot(userId);
  const now = new Date();
  await database.transact(
    database.tx.workroomSnapshots.lookup("userId", userId).update({
      syncVersion: existing?.syncVersion ?? id(),
      snapshot,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }),
  );
  return true;
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};
const textValue = (
  source: Record<string, unknown>,
  key: string,
  fallback = "",
) => (typeof source[key] === "string" ? source[key] : fallback);
const recordKey = (userId: string, syncVersion: string, clientId: string) =>
  `${userId}:${syncVersion}:${clientId}`;

export async function saveWorkroomState(
  userId: string,
  snapshot: WorkroomCloudSnapshot,
) {
  const database = await requireDb();
  const existingSnapshot = await getWorkroomSnapshot(userId);
  const bots = snapshot.bots
    .map(record)
    .filter((item) => textValue(item, "id") && textValue(item, "name"));
  const tasks = snapshot.tasks
    .map(record)
    .filter((item) => textValue(item, "id") && textValue(item, "title"));
  const files = snapshot.files
    .map(record)
    .filter((item) => textValue(item, "id") && textValue(item, "name"));
  const now = new Date();
  const syncVersion = id();
  const recordTransactions: InstantTx[] = [
    ...bots.map((bot) => {
      const clientId = textValue(bot, "id");
      return database.tx.workroomBots[id()].create({
        recordKey: recordKey(userId, syncVersion, clientId),
        userId,
        syncVersion,
        clientId,
        name: textValue(bot, "name"),
        role: textValue(bot, "role"),
        status: textValue(bot, "status", "Ready"),
        color: textValue(bot, "color", "#7563F5"),
        icon: textValue(bot, "icon", "auto-awesome"),
        payload: bot,
        createdAt: now,
        updatedAt: now,
      });
    }),
    ...tasks.map((task) => {
      const clientId = textValue(task, "id");
      return database.tx.workroomTasks[id()].create({
        recordKey: recordKey(userId, syncVersion, clientId),
        userId,
        syncVersion,
        clientId,
        botClientId: textValue(task, "botId"),
        title: textValue(task, "title"),
        status: textValue(task, "status", "Draft"),
        risk: textValue(task, "risk", "Low"),
        payload: task,
        createdAt: now,
        updatedAt: now,
      });
    }),
    ...files.map((file) => {
      const clientId = textValue(file, "id");
      return database.tx.workroomFiles[id()].create({
        recordKey: recordKey(userId, syncVersion, clientId),
        userId,
        syncVersion,
        clientId,
        name: textValue(file, "name"),
        owner: textValue(file, "owner"),
        scope: textValue(file, "scope", "Bot-private"),
        payload: file,
        createdAt: now,
        updatedAt: now,
      });
    }),
  ];
  await transactInBatches(database, recordTransactions);
  await database.transact(
    database.tx.workroomSnapshots.lookup("userId", userId).update({
      syncVersion,
      snapshot,
      createdAt: existingSnapshot?.createdAt ?? now,
      updatedAt: now,
    }),
  );

  const previousVersion = existingSnapshot?.syncVersion;
  if (previousVersion && previousVersion !== syncVersion) {
    const stale = (await database.query({
      workroomBots: { $: { where: { userId, syncVersion: previousVersion } } },
      workroomTasks: { $: { where: { userId, syncVersion: previousVersion } } },
      workroomFiles: { $: { where: { userId, syncVersion: previousVersion } } },
    })) as {
      workroomBots: WorkroomItemRow[];
      workroomTasks: WorkroomItemRow[];
      workroomFiles: WorkroomItemRow[];
    };
    const staleTransactions: InstantTx[] = [
      ...stale.workroomBots.map((item) =>
        database.tx.workroomBots[item.id].delete(),
      ),
      ...stale.workroomTasks.map((item) =>
        database.tx.workroomTasks[item.id].delete(),
      ),
      ...stale.workroomFiles.map((item) =>
        database.tx.workroomFiles[item.id].delete(),
      ),
    ];
    await transactInBatches(database, staleTransactions);
  }
  return true;
}

export async function syncNormalizedWorkroomRecords(
  userId: string,
  snapshot: WorkroomCloudSnapshot,
) {
  return saveWorkroomState(userId, snapshot);
}

export async function listNormalizedWorkroomRecords(userId: string) {
  const database = await getDb();
  if (!database) return { bots: [], tasks: [], files: [] };
  const snapshot = await getWorkroomSnapshot(userId);
  if (!snapshot?.syncVersion) return { bots: [], tasks: [], files: [] };
  const syncVersion = snapshot.syncVersion;
  const { workroomBots, workroomTasks, workroomFiles } = (await database.query({
    workroomBots: { $: { where: { userId, syncVersion } } },
    workroomTasks: { $: { where: { userId, syncVersion } } },
    workroomFiles: { $: { where: { userId, syncVersion } } },
  })) as {
    workroomBots: WorkroomItemRow[];
    workroomTasks: WorkroomItemRow[];
    workroomFiles: WorkroomItemRow[];
  };
  return {
    bots: workroomBots.map(withTimestamps),
    tasks: workroomTasks.map(withTimestamps),
    files: workroomFiles.map(withTimestamps),
  };
}

export async function createMicrosoftOAuthState(input: {
  state: string;
  userId: string;
  codeVerifier: string;
  returnTo: string;
  expiresAt: Date;
}) {
  const database = await requireDb();
  await database.transact(
    database.tx.microsoftOAuthStates.lookup("state", input.state).update({
      userId: input.userId,
      codeVerifier: input.codeVerifier,
      returnTo: input.returnTo,
      expiresAt: input.expiresAt,
      createdAt: new Date(),
    }),
  );
}

export async function consumeMicrosoftOAuthState(state: string) {
  const database = await requireDb();
  const { microsoftOAuthStates } = (await database.query({
    microsoftOAuthStates: { $: { where: { state }, limit: 1 } },
  })) as { microsoftOAuthStates: MicrosoftOAuthStateRow[] };
  const oauthState = microsoftOAuthStates[0];
  if (!oauthState) return undefined;
  await database.transact(
    database.tx.microsoftOAuthStates[oauthState.id].delete(),
  );
  const normalized = {
    ...oauthState,
    expiresAt: asDate(oauthState.expiresAt),
    createdAt: asDate(oauthState.createdAt),
  };
  if (normalized.expiresAt.getTime() <= Date.now()) return undefined;
  return normalized;
}

function asMicrosoftConnection(entity: MicrosoftConnectionRow): MicrosoftConnection {
  return {
    ...entity,
    displayName: nullable(entity.displayName),
    email: nullable(entity.email),
    status: entity.status === "reauthorize" ? "reauthorize" : "connected",
    isPrimary: Boolean(entity.isPrimary),
    expiresAt: asDate(entity.expiresAt),
    createdAt: asDate(entity.createdAt),
    updatedAt: asDate(entity.updatedAt),
  };
}

/**
 * Multi-account connectors: a user may connect several Microsoft accounts to
 * the same connector (e.g. a work and a personal OneDrive), mirroring the
 * multi-account-per-connector pattern in Grok Bot. Each connection is keyed
 * by its own `accountId` rather than being unique per user, and one
 * connection is marked `isPrimary` as the default for tool calls that don't
 * specify an account.
 */
export async function listMicrosoftConnections(
  userId: string,
): Promise<MicrosoftConnection[]> {
  const database = await getDb();
  if (!database) return [];
  const { microsoftConnections } = (await database.query({
    microsoftConnections: { $: { where: { userId } } },
  })) as { microsoftConnections: MicrosoftConnectionRow[] };
  return microsoftConnections
    .map(asMicrosoftConnection)
    .sort((left, right) => {
      if (left.isPrimary !== right.isPrimary) return left.isPrimary ? -1 : 1;
      return left.createdAt.getTime() - right.createdAt.getTime();
    });
}

/** The primary connection, or the earliest-connected one if none is marked primary. */
export async function getPrimaryMicrosoftConnection(
  userId: string,
): Promise<MicrosoftConnection | undefined> {
  const connections = await listMicrosoftConnections(userId);
  return connections[0];
}

export async function getMicrosoftConnectionByAccountId(
  userId: string,
  accountId: string,
): Promise<MicrosoftConnection | undefined> {
  const database = await getDb();
  if (!database) return undefined;
  const { microsoftConnections } = (await database.query({
    microsoftConnections: { $: { where: { accountId }, limit: 1 } },
  })) as { microsoftConnections: MicrosoftConnectionRow[] };
  const connection = microsoftConnections[0];
  if (!connection || connection.userId !== userId) return undefined;
  return asMicrosoftConnection(connection);
}

/** @deprecated Use getPrimaryMicrosoftConnection or getMicrosoftConnectionByAccountId. */
export async function getMicrosoftConnection(
  userId: string,
): Promise<MicrosoftConnection | undefined> {
  return getPrimaryMicrosoftConnection(userId);
}

export async function upsertMicrosoftConnection(
  input: InsertMicrosoftConnection,
) {
  const database = await requireDb();
  const existing = await getMicrosoftConnectionByAccountId(
    input.userId,
    input.accountId,
  );
  const existingConnections = await listMicrosoftConnections(input.userId);
  const now = new Date();
  await database.transact(
    database.tx.microsoftConnections.lookup("accountId", input.accountId).update({
      userId: input.userId,
      microsoftUserId: input.microsoftUserId,
      encryptedAccessToken: input.encryptedAccessToken,
      encryptedRefreshToken: input.encryptedRefreshToken,
      expiresAt: input.expiresAt,
      scopes: input.scopes,
      status: input.status ?? "connected",
      // The very first connection for a user is primary by default; later
      // ones are additional accounts unless the caller explicitly asks.
      isPrimary:
        input.isPrimary ?? existing?.isPrimary ?? existingConnections.length === 0,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      ...(input.displayName !== undefined
        ? { displayName: input.displayName ?? undefined }
        : {}),
      ...(input.email !== undefined ? { email: input.email ?? undefined } : {}),
    }),
  );
}

export async function setPrimaryMicrosoftConnection(
  userId: string,
  accountId: string,
) {
  const database = await requireDb();
  const connections = await listMicrosoftConnections(userId);
  const target = connections.find((c) => c.accountId === accountId);
  if (!target) throw new Error("Microsoft account not found");
  await transactInBatches(
    database,
    connections.map((connection) =>
      database.tx.microsoftConnections[connection.id].update(
        { isPrimary: connection.accountId === accountId, updatedAt: new Date() },
        { upsert: false },
      ),
    ),
  );
}

export async function updateMicrosoftTokens(
  userId: string,
  accountId: string,
  input: {
    encryptedAccessToken: string;
    encryptedRefreshToken: string;
    expiresAt: Date;
    scopes: string;
  },
) {
  const database = await requireDb();
  const connection = await getMicrosoftConnectionByAccountId(userId, accountId);
  if (!connection) throw new Error("Microsoft Excel is not connected");
  await database.transact(
    database.tx.microsoftConnections[connection.id].update(
      {
        ...input,
        status: "connected",
        updatedAt: new Date(),
      },
      { upsert: false },
    ),
  );
}

export async function markMicrosoftReauthorizationRequired(
  userId: string,
  accountId: string,
) {
  const database = await getDb();
  if (!database) return;
  const connection = await getMicrosoftConnectionByAccountId(userId, accountId);
  if (!connection) return;
  await database.transact(
    database.tx.microsoftConnections[connection.id].update(
      { status: "reauthorize", updatedAt: new Date() },
      { upsert: false },
    ),
  );
}

export async function deleteMicrosoftConnectionByAccountId(
  userId: string,
  accountId: string,
) {
  const database = await getDb();
  if (!database) return false;
  const connection = await getMicrosoftConnectionByAccountId(userId, accountId);
  if (!connection) return false;
  const wasPrimary = connection.isPrimary;
  await database.transact(database.tx.microsoftConnections[connection.id].delete());
  // Promote the next-oldest remaining connection to primary so tool calls
  // that don't specify an account keep working.
  if (wasPrimary) {
    const remaining = await listMicrosoftConnections(userId);
    if (remaining.length) await setPrimaryMicrosoftConnection(userId, remaining[0].accountId);
  }
  return true;
}

function deletionTransactions(
  database: InstantDb,
  input: {
    microsoftConnections?: Array<{ id: string }>;
    microsoftOAuthStates?: Array<{ id: string }>;
    excelPendingActions?: Array<{ id: string }>;
    excelActionClaims?: Array<{ id: string }>;
    workroomSnapshots?: Array<{ id: string }>;
    workroomBots?: Array<{ id: string }>;
    workroomTasks?: Array<{ id: string }>;
    workroomFiles?: Array<{ id: string }>;
    userNotificationPreferences?: Array<{ id: string }>;
    pushDevices?: Array<{ id: string }>;
  },
): InstantTx[] {
  return [
    ...(input.microsoftConnections ?? []).map((item) =>
      database.tx.microsoftConnections[item.id].delete(),
    ),
    ...(input.microsoftOAuthStates ?? []).map((item) =>
      database.tx.microsoftOAuthStates[item.id].delete(),
    ),
    ...(input.excelPendingActions ?? []).map((item) =>
      database.tx.excelPendingActions[item.id].delete(),
    ),
    ...(input.excelActionClaims ?? []).map((item) =>
      database.tx.excelActionClaims[item.id].delete(),
    ),
    ...(input.workroomSnapshots ?? []).map((item) =>
      database.tx.workroomSnapshots[item.id].delete(),
    ),
    ...(input.workroomBots ?? []).map((item) =>
      database.tx.workroomBots[item.id].delete(),
    ),
    ...(input.workroomTasks ?? []).map((item) =>
      database.tx.workroomTasks[item.id].delete(),
    ),
    ...(input.workroomFiles ?? []).map((item) =>
      database.tx.workroomFiles[item.id].delete(),
    ),
    ...(input.userNotificationPreferences ?? []).map((item) =>
      database.tx.userNotificationPreferences[item.id].delete(),
    ),
    ...(input.pushDevices ?? []).map((item) =>
      database.tx.pushDevices[item.id].delete(),
    ),
  ];
}

export async function deleteMicrosoftConnection(userId: string) {
  const database = await getDb();
  if (!database) return false;
  const result = (await database.query({
    microsoftConnections: { $: { where: { userId } } },
    microsoftOAuthStates: { $: { where: { userId } } },
    excelPendingActions: { $: { where: { userId } } },
    excelActionClaims: { $: { where: { userId } } },
  })) as {
    microsoftConnections: WithId[];
    microsoftOAuthStates: WithId[];
    excelPendingActions: WithId[];
    excelActionClaims: WithId[];
  };
  const transactions = deletionTransactions(database, result);
  if (transactions.length) await database.transact(transactions);
  return true;
}

export async function createExcelPendingAction(
  input: InsertExcelPendingAction,
) {
  const database = await requireDb();
  const now = new Date();
  await database.transact(
    database.tx.excelPendingActions.lookup("actionId", input.id).update({
      userId: input.userId,
      botClientId: input.botClientId,
      taskClientId: input.taskClientId,
      toolName: input.toolName,
      arguments: input.arguments,
      summary: input.summary,
      state: input.state ?? "pending",
      expiresAt: input.expiresAt,
      createdAt: now,
      updatedAt: now,
      ...(input.result !== undefined ? { result: input.result } : {}),
    }),
  );
}

function asExcelPendingAction(entity: {
  id: string;
  actionId: string;
  userId: string;
  botClientId: string;
  taskClientId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  summary: string;
  state: string;
  result?: unknown;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}): ExcelPendingAction {
  const state = ["executing", "executed", "failed", "declined", "expired"].includes(entity.state)
    ? (entity.state as ExcelPendingAction["state"])
    : "pending";
  return {
    id: entity.actionId,
    userId: entity.userId,
    botClientId: entity.botClientId,
    taskClientId: entity.taskClientId,
    toolName: entity.toolName,
    arguments: entity.arguments,
    summary: entity.summary,
    state,
    result: entity.result,
    expiresAt: asDate(entity.expiresAt),
    createdAt: asDate(entity.createdAt),
    updatedAt: asDate(entity.updatedAt),
  };
}

export async function getExcelPendingAction(userId: string, actionId: string) {
  const database = await getDb();
  if (!database) return undefined;
  const { excelPendingActions } = (await database.query({
    excelPendingActions: {
      $: { where: { actionId }, limit: 1 },
    },
  })) as { excelPendingActions: ExcelPendingActionRow[] };
  const action = excelPendingActions[0];
  if (!action || action.userId !== userId) return undefined;
  return asExcelPendingAction(action);
}

export async function listPendingExcelActions(userId: string) {
  const database = await getDb();
  if (!database) return [];
  const { excelPendingActions } = (await database.query({
    excelPendingActions: { $: { where: { userId, state: "pending" } } },
  })) as { excelPendingActions: ExcelPendingActionRow[] };
  return excelPendingActions.map(asExcelPendingAction);
}

export async function claimExcelPendingAction(
  userId: string,
  actionId: string,
) {
  const database = await requireDb();
  const action = await getExcelPendingAction(userId, actionId);
  if (!action || action.state !== "pending") return undefined;
  const { excelPendingActions } = (await database.query({
    excelPendingActions: { $: { where: { actionId }, limit: 1 } },
  })) as { excelPendingActions: ExcelPendingActionRow[] };
  const stored = excelPendingActions[0];
  if (!stored || stored.userId !== userId || stored.state !== "pending")
    return undefined;
  try {
    await database.transact([
      database.tx.excelActionClaims[id()].create({
        actionId,
        userId,
        createdAt: new Date(),
      }),
      database.tx.excelPendingActions[stored.id].update(
        { state: "executing", updatedAt: new Date() },
        { upsert: false },
      ),
    ]);
  } catch {
    return undefined;
  }
  return { ...action, state: "executing" as const };
}

export async function finishExcelPendingAction(
  userId: string,
  actionId: string,
  input: {
    state: "executed" | "failed" | "declined" | "expired";
    result?: unknown;
  },
) {
  const database = await requireDb();
  const { excelPendingActions } = (await database.query({
    excelPendingActions: { $: { where: { actionId }, limit: 1 } },
  })) as { excelPendingActions: ExcelPendingActionRow[] };
  const action = excelPendingActions[0];
  if (!action || action.userId !== userId || action.state !== "executing")
    return false;
  await database.transact(
    database.tx.excelPendingActions[action.id].update(
      {
        state: input.state,
        updatedAt: new Date(),
        ...(input.result !== undefined ? { result: input.result } : {}),
      },
      { upsert: false },
    ),
  );
  return true;
}

export async function resolveExcelPendingAction(
  userId: string,
  actionId: string,
  input: {
    state: "executed" | "declined" | "expired";
    result?: unknown;
  },
) {
  const claimed = await claimExcelPendingAction(userId, actionId);
  if (!claimed) return;
  await finishExcelPendingAction(userId, actionId, input);
}

export async function exportAccountWorkroomData(userId: string) {
  const [snapshot, records, preferences, microsoftConnections] = await Promise.all([
    getWorkroomSnapshot(userId),
    listNormalizedWorkroomRecords(userId),
    getNotificationPreferences(userId),
    listMicrosoftConnections(userId),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    snapshot: snapshot?.snapshot ?? null,
    records,
    notificationPreferences: preferences
      ? {
          approval: preferences.approvalEnabled,
          completion: preferences.completionEnabled,
        }
      : { approval: true, completion: true },
    integrations: {
      microsoftExcel: microsoftConnections.map((connection) => ({
        accountId: connection.accountId,
        displayName: connection.displayName,
        email: connection.email,
        status: connection.status,
        scopes: connection.scopes,
        isPrimary: connection.isPrimary,
        connectedAt: connection.createdAt,
      })),
    },
  };
}

export async function deleteAccountWorkroomData(userId: string) {
  const database = await getDb();
  if (!database) return false;
  const result = (await database.query({
    workroomSnapshots: { $: { where: { userId } } },
    workroomBots: { $: { where: { userId } } },
    workroomTasks: { $: { where: { userId } } },
    workroomFiles: { $: { where: { userId } } },
    userNotificationPreferences: { $: { where: { userId } } },
    pushDevices: { $: { where: { userId } } },
    microsoftConnections: { $: { where: { userId } } },
    microsoftOAuthStates: { $: { where: { userId } } },
    excelPendingActions: { $: { where: { userId } } },
    excelActionClaims: { $: { where: { userId } } },
  })) as Record<string, WithId[]>;
  const transactions = deletionTransactions(database, result);
  await transactInBatches(database, transactions);
  return true;
}

/* ---- Rook Node relay ---- */

const asRookNode = (entity: Record<string, unknown> & { id: string }): RookNodeRecord => ({
  id: entity.id,
  nodeId: textValue(entity, "nodeId"),
  userId: textValue(entity, "userId"),
  name: textValue(entity, "name", "Computer"),
  status: (textValue(entity, "status", "offline") as RookNodeRecord["status"]),
  version: textValue(entity, "version"),
  lastSeenAt: asDateValue(entity.lastSeenAt),
  createdAt: asDateValue(entity.createdAt),
  updatedAt: asDateValue(entity.updatedAt),
});

export async function createPairingToken(userId: string): Promise<{ token: string; expiresAt: Date } | undefined> {
  const database = await getDb();
  if (!database) return undefined;
  const token = generatePairingToken();
  const expiresAt = new Date(Date.now() + PAIRING_TOKEN_TTL_MS);
  try {
    await database.transact(
      database.tx.pairingTokens[id()].update({
        tokenHash: hashToken(token),
        userId,
        expiresAt,
        createdAt: new Date(),
      }),
    );
  } catch (error) {
    // Unknown-entity failures mean the deployed InstantDB app has not had the
    // computers schema pushed yet; surface an actionable message, not a bare 500.
    if (/invalid|unknown|entity|attribute|not found/i.test(String((error as Error)?.message ?? error))) {
      throw new Error(
        "The computers backend is not initialized yet. Run `pnpm db:push` once from the repo (needs INSTANT_APP_ADMIN_TOKEN), then retry.",
      );
    }
    throw error;
  }
  return { token, expiresAt };
}

/** Marks a pairing token used and returns its owner's user id. Single use. */
export async function consumePairingToken(token: string): Promise<string | undefined> {
  const database = await getDb();
  if (!database) return undefined;
  const { pairingTokens } = (await database.query({
    pairingTokens: { $: { where: { tokenHash: hashToken(token) }, limit: 1 } },
  })) as { pairingTokens: PairingTokenRow[] };
  const record = pairingTokens[0];
  if (!record) return undefined;
  if (record.usedByNodeId) return undefined;
  if (asDate(record.expiresAt).getTime() <= Date.now()) return undefined;
  return record.userId;
}

export async function markPairingTokenUsed(token: string, nodeId: string): Promise<void> {
  const database = await getDb();
  if (!database) return;
  await database.transact(
    database.tx.pairingTokens.lookup("tokenHash", hashToken(token)).update({
      usedByNodeId: nodeId,
    }),
  );
}

export async function createDesktopPairingRequest(input: { name: string; version: string }): Promise<DesktopPairingRequest | undefined> {
  const database = await getDb();
  if (!database) return undefined;
  const now = new Date();
  const requestId = generateDesktopPairingRequestId();
  const expiresAt = new Date(now.getTime() + DESKTOP_PAIRING_REQUEST_TTL_MS);
  await database.transact(
    database.tx.desktopPairingRequests[id()].update({
      requestId,
      name: input.name,
      version: input.version,
      attempts: 0,
      state: "pending",
      expiresAt,
      createdAt: now,
      updatedAt: now,
    }),
  );
  return { requestId, name: input.name, version: input.version, state: "pending", expiresAt };
}

async function findDesktopPairingRequest(requestId: string): Promise<DesktopPairingRequestRow | undefined> {
  const database = await getDb();
  if (!database) return undefined;
  const { desktopPairingRequests } = (await database.query({
    desktopPairingRequests: { $: { where: { requestId }, limit: 1 } },
  })) as { desktopPairingRequests: DesktopPairingRequestRow[] };
  return desktopPairingRequests[0];
}

function desktopRequestActive(record: DesktopPairingRequestRow): boolean {
  return asDate(record.expiresAt).getTime() > Date.now() && !["consumed", "locked", "expired"].includes(record.state);
}

/** Called by the authenticated Rook web session; raw codes are never persisted. */
export async function issueDesktopPairingCode(userId: string, requestId: string): Promise<{ code: string; expiresAt: Date; name: string } | undefined> {
  const database = await getDb();
  const record = await findDesktopPairingRequest(requestId);
  if (!database || !record) return undefined;
  if (!desktopRequestActive(record)) {
    if (record.state !== "expired") {
      await database.transact(database.tx.desktopPairingRequests.lookup("requestId", requestId).update({ state: "expired", updatedAt: new Date() }));
    }
    return undefined;
  }
  if (record.userId && record.userId !== userId) return undefined;
  const code = generateDesktopPairingCode();
  const codeHash = desktopPairingCodeDigest(code);
  if (!codeHash) return undefined;
  await database.transact(
    database.tx.desktopPairingRequests.lookup("requestId", requestId).update({
      userId,
      codeHash,
      attempts: 0,
      state: "code-issued",
      updatedAt: new Date(),
    }),
  );
  return { code, expiresAt: asDate(record.expiresAt), name: record.name };
}

/**
 * Atomically reserves one request id with a uniqueness-backed claim. The
 * winning caller may create the durable Node; concurrent and replayed callers
 * receive no owner identity and therefore cannot issue another credential.
 */
export async function consumeDesktopPairingCode(input: { requestId: string; code: string; nodeId: string; secretHash: string }): Promise<{ userId: string; name: string; version: string } | undefined> {
  const database = await getDb();
  const record = await findDesktopPairingRequest(input.requestId);
  if (!database || !record || !desktopRequestActive(record) || record.state !== "code-issued" || !record.userId || !record.codeHash) return undefined;
  const digest = desktopPairingCodeDigest(input.code);
  if (!digest || !secretsMatch(digest, record.codeHash)) {
    const attempts = Math.min((Number(record.attempts) || 0) + 1, DESKTOP_PAIRING_MAX_ATTEMPTS);
    await database.transact(
      database.tx.desktopPairingRequests.lookup("requestId", input.requestId).update({
        attempts,
        state: attempts >= DESKTOP_PAIRING_MAX_ATTEMPTS ? "locked" : "code-issued",
        updatedAt: new Date(),
      }),
    );
    return undefined;
  }
  try {
    const now = new Date();
    await database.transact([
      database.tx.desktopPairingClaims[id()].update({
        requestId: input.requestId,
        nodeId: input.nodeId,
        userId: record.userId,
        createdAt: now,
      }),
      database.tx.desktopPairingRequests.lookup("requestId", input.requestId).update({
        state: "consumed",
        usedByNodeId: input.nodeId,
        updatedAt: now,
      }),
      database.tx.rookNodes[id()].update({
        nodeId: input.nodeId,
        userId: record.userId,
        name: record.name,
        secretHash: input.secretHash,
        status: "online",
        version: record.version,
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
      }),
    ]);
  } catch {
    return undefined;
  }
  return { userId: record.userId, name: record.name, version: record.version };
}

export async function createRookNode(input: {
  nodeId: string;
  userId: string;
  name: string;
  secretHash: string;
  version: string;
}): Promise<RookNodeRecord | undefined> {
  const database = await getDb();
  if (!database) return undefined;
  const now = new Date();
  await database.transact(
    database.tx.rookNodes[id()].update({
      ...input,
      status: "online",
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    }),
  );
  const created = await getRookNode(input.nodeId);
  return created;
}

export async function getRookNode(nodeId: string): Promise<RookNodeRecord | undefined> {
  const database = await getDb();
  if (!database) return undefined;
  const { rookNodes } = await database.query({
    rookNodes: { $: { where: { nodeId }, limit: 1 } },
  });
  const raw = rookNodes[0] as unknown as (Record<string, unknown> & { id: string }) | undefined;
  return raw ? asRookNode(raw) : undefined;
}

/** Auth lookup for the sync route. The secret hash never leaves the server process. */
export async function getRookNodeAuth(nodeId: string): Promise<{ secretHash: string; status: string } | undefined> {
  const database = await getDb();
  if (!database) return undefined;
  const { rookNodes } = await database.query({
    rookNodes: { $: { where: { nodeId }, limit: 1 } },
  });
  const raw = rookNodes[0] as unknown as (Record<string, unknown> & { id: string }) | undefined;
  if (!raw) return undefined;
  return { secretHash: textValue(raw, "secretHash"), status: textValue(raw, "status", "offline") };
}

export async function listRookNodesForUser(userId: string): Promise<RookNodeRecord[]> {
  const database = await getDb();
  if (!database) return [];
  const { rookNodes } = await database.query({
    rookNodes: { $: { where: { userId } } },
  });
  return (rookNodes as unknown as Array<Record<string, unknown> & { id: string }>)
    .map(asRookNode)
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
}

export async function revokeRookNode(userId: string, nodeId: string): Promise<boolean> {
  const existing = await getRookNode(nodeId);
  if (!existing || existing.userId !== userId) return false;
  const database = await requireDb();
  await database.transact(
    database.tx.rookNodes.lookup("nodeId", nodeId).update({ status: "revoked", updatedAt: new Date() }),
  );
  return true;
}

export async function renameRookNode(userId: string, nodeId: string, name: string): Promise<boolean> {
  const existing = await getRookNode(nodeId);
  if (!existing || existing.userId !== userId) return false;
  const database = await requireDb();
  await database.transact(
    database.tx.rookNodes.lookup("nodeId", nodeId).update({ name, updatedAt: new Date() }),
  );
  return true;
}

export async function touchRookNode(nodeId: string, version: string): Promise<void> {
  const database = await getDb();
  if (!database) return;
  await database.transact(
    database.tx.rookNodes.lookup("nodeId", nodeId).update({
      status: "online",
      version,
      lastSeenAt: new Date(),
      updatedAt: new Date(),
    }),
  );
}

export async function markRookNodeOffline(nodeId: string): Promise<void> {
  const database = await getDb();
  if (!database) return;
  await database.transact(
    database.tx.rookNodes.lookup("nodeId", nodeId).update({ status: "offline", updatedAt: new Date() }),
  );
}

export async function enqueueNodeCommand(input: {
  commandId: string;
  userId: string;
  nodeId: string;
  summary: string;
  capability: string;
  envelope: Record<string, unknown>;
  requiresApproval: boolean;
}): Promise<NodeCommandRecord | undefined> {
  const node = await getRookNode(input.nodeId);
  if (!node || node.userId !== input.userId || node.status === "revoked") return undefined;
  const database = await requireDb();
  const now = new Date();
  await database.transact(
    database.tx.nodeCommands[id()].update({
      commandId: input.commandId,
      userId: input.userId,
      nodeId: input.nodeId,
      state: input.requiresApproval ? "awaiting_approval" : "pending",
      summary: input.summary.slice(0, 300),
      capability: input.capability.slice(0, 40),
      envelope: input.envelope,
      expiresAt: new Date(now.getTime() + COMMAND_TTL_MS),
      createdAt: now,
      updatedAt: now,
    }),
  );
  return {
    id: input.commandId,
    commandId: input.commandId,
    userId: input.userId,
    nodeId: input.nodeId,
    state: input.requiresApproval ? "awaiting_approval" : "pending",
    summary: input.summary.slice(0, 300),
    capability: input.capability.slice(0, 40),
    envelope: input.envelope,
    expiresAt: new Date(now.getTime() + COMMAND_TTL_MS),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Applies the owner's decision to an awaiting command. Approval embeds a
 * short-lived grant bound to the page revision; decline marks it declined.
 */
export async function decideNodeCommand(
  userId: string,
  commandId: string,
  decision: "approved" | "declined",
): Promise<NodeCommandRecord | undefined> {
  const database = await getDb();
  if (!database) return undefined;
  const { nodeCommands } = await database.query({
    nodeCommands: { $: { where: { commandId }, limit: 1 } },
  });
  const raw = nodeCommands[0] as unknown as (Record<string, unknown> & { id: string }) | undefined;
  if (!raw || textValue(raw, "userId") !== userId) return undefined;
  if (textValue(raw, "state") !== "awaiting_approval") return existingNodeCommand(raw);

  if (decision === "declined") {
    await database.transact(
      database.tx.nodeCommands[raw.id].update({ state: "declined", updatedAt: new Date() }),
    );
    return existingNodeCommand({ ...raw, state: "declined" });
  }

  const grant = {
    approvalId: generateApprovalId(),
    nonce: randomBytes(24).toString("hex"),
    expiresAt: Date.now() + APPROVAL_GRANT_TTL_MS,
    pageRevision:
      typeof record(raw.envelope).pageRevision === "number"
        ? (record(raw.envelope).pageRevision as number)
        : 0,
  };
  await database.transact(
    database.tx.nodeCommands[raw.id].update({
      state: "pending",
      approval: grant,
      updatedAt: new Date(),
    }),
  );
  return existingNodeCommand({ ...raw, state: "pending", approval: grant });
}

function existingNodeCommand(raw: Record<string, unknown> & { id: string }): NodeCommandRecord {
  return {
    id: raw.id,
    commandId: textValue(raw, "commandId"),
    userId: textValue(raw, "userId"),
    nodeId: textValue(raw, "nodeId"),
    state: textValue(raw, "state") as NodeCommandRecord["state"],
    summary: textValue(raw, "summary"),
    capability: textValue(raw, "capability"),
    envelope: record(raw.envelope),
    approval: isRecordValue(raw.approval) ? raw.approval : undefined,
    result: raw.result,
    expiresAt: asDateValue(raw.expiresAt),
    createdAt: asDateValue(raw.createdAt),
    updatedAt: asDateValue(raw.updatedAt),
  };
}

const isRecordValue = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Atomically claims pending commands for delivery and returns them. */
export async function takePendingNodeCommands(nodeId: string): Promise<Array<Record<string, unknown>>> {
  const database = await getDb();
  if (!database) return [];
  const { nodeCommands } = await database.query({
    nodeCommands: { $: { where: { nodeId, state: "pending" } } },
  });
  const deliverable = (nodeCommands as unknown as Array<Record<string, unknown> & { id: string }>)
    .filter((row) => asDateValue(row.expiresAt).getTime() > Date.now())
    .slice(0, 16);
  for (const row of deliverable) {
    await database.transact(
      database.tx.nodeCommands[row.id].update({ state: "delivered", updatedAt: new Date() }),
    );
  }
  return deliverable.map((row) => ({
    commandId: textValue(row, "commandId"),
    envelope: record(row.envelope),
    approval: isRecordValue(row.approval) ? row.approval : undefined,
  }));
}

export async function completeNodeCommand(commandId: string, report: { ok: boolean; result?: unknown; code?: string; message?: string }): Promise<void> {
  const database = await getDb();
  if (!database) return;
  await database.transact(
    database.tx.nodeCommands.lookup("commandId", commandId).update({
      state: "completed",
      result: { ok: report.ok, result: report.result ?? null, code: report.code ?? null, message: report.message ?? null },
      updatedAt: new Date(),
    }),
  );
}

export async function listRecentNodeCommands(userId: string, limit = 30): Promise<NodeCommandRecord[]> {
  const database = await getDb();
  if (!database) return [];
  const { nodeCommands } = await database.query({
    nodeCommands: { $: { where: { userId } } },
  });
  return (nodeCommands as unknown as Array<Record<string, unknown> & { id: string }>)
    .map(existingNodeCommand)
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    .slice(0, Math.max(1, Math.min(limit, 100)));
}

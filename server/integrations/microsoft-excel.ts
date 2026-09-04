import { createHash, randomBytes, randomUUID } from "node:crypto";

import ExcelJS from "exceljs";

import * as db from "../db";
import { decryptSecret, encryptSecret } from "./crypto";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const MICROSOFT_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "User.Read",
  "Files.ReadWrite",
].join(" ");

export type ExcelWorkbook = {
  id: string;
  driveId: string;
  name: string;
  webUrl: string | null;
  size: number | null;
  lastModifiedDateTime: string | null;
};

export type ExcelWorksheet = {
  id: string;
  name: string;
  position: number;
  visibility: string;
};
export type ExcelTable = {
  id: string;
  name: string;
  worksheetName: string | null;
};

function microsoftConfig() {
  const clientId = process.env.MICROSOFT_CLIENT_ID?.trim();
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET?.trim();
  const appOrigin =
    process.env.APP_ORIGIN?.trim().replace(/\/$/, "") ||
    "https://www.rook.lighting";
  const redirectUri =
    process.env.MICROSOFT_REDIRECT_URI?.trim() ||
    `${appOrigin}/api/oauth/microsoft/callback`;
  const tenant = process.env.MICROSOFT_TENANT_ID?.trim() || "common";
  return { clientId, clientSecret, appOrigin, redirectUri, tenant };
}

export function isMicrosoftExcelConfigured() {
  const config = microsoftConfig();
  return Boolean(
    config.clientId &&
    config.clientSecret &&
    process.env.INTEGRATION_ENCRYPTION_KEY,
  );
}

function requireMicrosoftConfig() {
  const config = microsoftConfig();
  if (!config.clientId || !config.clientSecret) {
    throw new Error(
      "Microsoft Excel is not configured for this Rook deployment",
    );
  }
  return {
    ...config,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
  };
}

const base64Url = (value: Buffer) => value.toString("base64url");

export async function createMicrosoftAuthorizationUrl(
  userId: string,
  returnTo?: string,
) {
  const config = requireMicrosoftConfig();
  const state = base64Url(randomBytes(32));
  const codeVerifier = base64Url(randomBytes(64));
  const codeChallenge = base64Url(
    createHash("sha256").update(codeVerifier).digest(),
  );
  const mobileScheme = process.env.ROOK_MOBILE_SCHEME?.trim() || "manusrook";
  let safeReturnTo = `${config.appOrigin}/account`;
  if (returnTo) {
    try {
      const candidate = new URL(returnTo);
      const allowedWebOrigins = new Set([
        config.appOrigin,
        "https://rook.lighting",
        "https://www.rook.lighting",
        "http://localhost:8081",
        "http://localhost:8082",
      ]);
      if (
        allowedWebOrigins.has(candidate.origin) ||
        candidate.protocol === `${mobileScheme}:`
      ) {
        safeReturnTo = candidate.toString();
      }
    } catch {
      // Keep the production account fallback for malformed or untrusted returns.
    }
  }

  await db.createMicrosoftOAuthState({
    state,
    userId,
    codeVerifier,
    returnTo: safeReturnTo,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });

  // `prompt: select_account` is required (not just default) so a user who
  // already has an active Microsoft session in this browser can still pick a
  // different account — this is what makes "add another account" work.
  const query = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: config.redirectUri,
    response_mode: "query",
    scope: MICROSOFT_SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return `https://login.microsoftonline.com/${encodeURIComponent(config.tenant)}/oauth2/v2.0/authorize?${query.toString()}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type: string;
  error?: string;
  error_description?: string;
};

async function tokenRequest(
  values: Record<string, string>,
): Promise<TokenResponse> {
  const config = requireMicrosoftConfig();
  const response = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(config.tenant)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        ...values,
      }),
    },
  );
  const body = (await response.json()) as TokenResponse;
  if (!response.ok || !body.access_token) {
    throw new Error(
      body.error_description || body.error || "Microsoft token exchange failed",
    );
  }
  return body;
}

async function rawGraph<T>(
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${GRAPH_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    let message = `Microsoft Graph request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {
      // Preserve the status-only message when Graph does not return JSON.
    }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function makeMicrosoftAccountId() {
  return `msft-${randomUUID()}`;
}

export async function finishMicrosoftAuthorization(
  code: string,
  state: string,
) {
  const config = requireMicrosoftConfig();
  const oauthState = await db.consumeMicrosoftOAuthState(state);
  if (!oauthState)
    throw new Error(
      "The Microsoft connection request expired or was already used",
    );

  const tokens = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
    code_verifier: oauthState.codeVerifier,
    scope: MICROSOFT_SCOPES,
  });
  if (!tokens.refresh_token)
    throw new Error("Microsoft did not return an offline refresh token");

  const profile = await rawGraph<{
    id: string;
    displayName?: string;
    mail?: string;
    userPrincipalName?: string;
  }>(tokens.access_token, "/me?$select=id,displayName,mail,userPrincipalName");

  // Re-connecting the same Microsoft account refreshes its existing
  // connection instead of creating a duplicate; a genuinely different
  // Microsoft account becomes an additional connection.
  const existing = (await db.listMicrosoftConnections(oauthState.userId)).find(
    (connection) => connection.microsoftUserId === profile.id,
  );
  const accountId = existing?.accountId ?? makeMicrosoftAccountId();

  await db.upsertMicrosoftConnection({
    accountId,
    userId: oauthState.userId,
    microsoftUserId: profile.id,
    displayName: profile.displayName ?? null,
    email: profile.mail ?? profile.userPrincipalName ?? null,
    encryptedAccessToken: encryptSecret(tokens.access_token),
    encryptedRefreshToken: encryptSecret(tokens.refresh_token),
    expiresAt: new Date(
      Date.now() + Math.max(tokens.expires_in - 60, 60) * 1000,
    ),
    scopes: tokens.scope || MICROSOFT_SCOPES,
    status: "connected",
  });

  return {
    returnTo: oauthState.returnTo,
    email: profile.mail ?? profile.userPrincipalName ?? null,
  };
}

/** Resolves which connection a request should use: an explicit account, or the primary. */
async function resolveConnection(userId: string, accountId?: string) {
  const connection = accountId
    ? await db.getMicrosoftConnectionByAccountId(userId, accountId)
    : await db.getPrimaryMicrosoftConnection(userId);
  if (!connection) throw new Error("Microsoft Excel is not connected");
  return connection;
}

async function accessTokenForAccount(userId: string, accountId?: string) {
  const connection = await resolveConnection(userId, accountId);
  if (connection.status === "reauthorize")
    throw new Error("Microsoft Excel needs to be reconnected");
  if (connection.expiresAt.getTime() > Date.now() + 90_000) {
    return decryptSecret(connection.encryptedAccessToken);
  }

  try {
    const currentRefreshToken = decryptSecret(connection.encryptedRefreshToken);
    const tokens = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: currentRefreshToken,
      scope: MICROSOFT_SCOPES,
    });
    const nextRefreshToken = tokens.refresh_token || currentRefreshToken;
    await db.updateMicrosoftTokens(userId, connection.accountId, {
      encryptedAccessToken: encryptSecret(tokens.access_token),
      encryptedRefreshToken: encryptSecret(nextRefreshToken),
      expiresAt: new Date(
        Date.now() + Math.max(tokens.expires_in - 60, 60) * 1000,
      ),
      scopes: tokens.scope || connection.scopes,
    });
    return tokens.access_token;
  } catch (error) {
    await db.markMicrosoftReauthorizationRequired(userId, connection.accountId);
    throw error;
  }
}

async function graph<T>(
  userId: string,
  path: string,
  init?: RequestInit,
  accountId?: string,
) {
  return rawGraph<T>(await accessTokenForAccount(userId, accountId), path, init);
}

function workbookPath(driveId: string, itemId: string) {
  if (!driveId || !itemId)
    throw new Error("Workbook drive and item identifiers are required");
  return `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/workbook`;
}

function safeRange(address: string) {
  const normalized = address.trim().toUpperCase();
  if (
    !/^(?:'[^']+'!)?\$?[A-Z]{1,3}\$?\d{1,7}(?::\$?[A-Z]{1,3}\$?\d{1,7})?$/.test(
      normalized,
    )
  ) {
    throw new Error("Use a valid Excel range such as A1:F20");
  }
  const localAddress = normalized.includes("!")
    ? normalized.slice(normalized.lastIndexOf("!") + 1)
    : normalized;
  const [start, end = start] = localAddress.replace(/\$/g, "").split(":");
  const parseCell = (cell: string) => {
    const match = /^([A-Z]{1,3})(\d+)$/.exec(cell);
    if (!match) throw new Error("Use a valid Excel range such as A1:F20");
    const column = [...match[1]].reduce(
      (total, character) => total * 26 + character.charCodeAt(0) - 64,
      0,
    );
    return { column, row: Number(match[2]) };
  };
  const from = parseCell(start);
  const to = parseCell(end);
  const cells =
    (Math.abs(to.column - from.column) + 1) * (Math.abs(to.row - from.row) + 1);
  if (cells > 2_500)
    throw new Error("Read a smaller range of 2,500 cells or fewer");
  return normalized;
}

function worksheetSegment(name: string) {
  const clean = name.trim();
  if (!clean || clean.length > 31 || /[\\/*?:\[\]]/.test(clean))
    throw new Error("Worksheet name is invalid");
  return encodeURIComponent(clean);
}

export async function microsoftConnectionStatus(userId: string) {
  const connections = await db.listMicrosoftConnections(userId);
  const primary = connections[0];
  return {
    configured: isMicrosoftExcelConfigured(),
    connected: Boolean(primary && primary.status === "connected"),
    needsReauthorization: primary?.status === "reauthorize",
    displayName: primary?.displayName ?? null,
    email: primary?.email ?? null,
    scopes: primary?.scopes.split(/\s+/).filter(Boolean) ?? [],
    connectedAt: primary?.createdAt.toISOString() ?? null,
    accounts: connections.map((connection) => ({
      accountId: connection.accountId,
      displayName: connection.displayName,
      email: connection.email,
      status: connection.status,
      isPrimary: connection.isPrimary,
      connectedAt: connection.createdAt.toISOString(),
    })),
  };
}

export async function setPrimaryMicrosoftAccount(userId: string, accountId: string) {
  await db.setPrimaryMicrosoftConnection(userId, accountId);
}

export async function disconnectMicrosoftAccount(userId: string, accountId: string) {
  return db.deleteMicrosoftConnectionByAccountId(userId, accountId);
}

export async function listExcelWorkbooks(
  userId: string,
  accountId?: string,
): Promise<ExcelWorkbook[]> {
  type DriveItem = {
    id: string;
    name: string;
    webUrl?: string;
    size?: number;
    lastModifiedDateTime?: string;
    parentReference?: { driveId?: string };
    file?: { mimeType?: string };
    remoteItem?: {
      id?: string;
      name?: string;
      webUrl?: string;
      size?: number;
      lastModifiedDateTime?: string;
      parentReference?: { driveId?: string };
      file?: { mimeType?: string };
    };
  };
  const own = await graph<{
    value?: Array<{
      id: string;
      name: string;
      webUrl?: string;
      size?: number;
      lastModifiedDateTime?: string;
      parentReference?: { driveId?: string };
      file?: { mimeType?: string };
    }>;
  }>(
    userId,
    "/me/drive/root/search(q='.xlsx')?$select=id,name,webUrl,size,lastModifiedDateTime,parentReference,file&$top=100",
    undefined,
    accountId,
  );
  const shared = await graph<{ value?: DriveItem[] }>(
    userId,
    "/me/drive/sharedWithMe?$select=id,name,webUrl,size,lastModifiedDateTime,parentReference,file,remoteItem&$top=100",
    undefined,
    accountId,
  ).catch(() => ({ value: [] }));

  const normalized = [
    ...(own.value ?? []),
    ...(shared.value ?? []).map((item) => ({
      ...item,
      id: item.remoteItem?.id ?? item.id,
      name: item.remoteItem?.name ?? item.name,
      webUrl: item.remoteItem?.webUrl ?? item.webUrl,
      size: item.remoteItem?.size ?? item.size,
      lastModifiedDateTime:
        item.remoteItem?.lastModifiedDateTime ?? item.lastModifiedDateTime,
      parentReference:
        item.remoteItem?.parentReference ?? item.parentReference,
      file: item.remoteItem?.file ?? item.file,
    })),
  ] as DriveItem[];
  const unique = new Map<string, ExcelWorkbook>();
  normalized
    .filter((item) => item.name.toLowerCase().endsWith(".xlsx") && item.parentReference?.driveId)
    .forEach((item) => {
      const driveId = item.parentReference!.driveId!;
      unique.set(`${driveId}:${item.id}`, {
        id: item.id,
        driveId,
        name: item.name,
        webUrl: item.webUrl ?? null,
        size: item.size ?? null,
        lastModifiedDateTime: item.lastModifiedDateTime ?? null,
      });
    });

  return [...unique.values()]
    .sort((a, b) =>
      (b.lastModifiedDateTime ?? "").localeCompare(
        a.lastModifiedDateTime ?? "",
      ),
    );
}

export async function listExcelWorksheets(
  userId: string,
  driveId: string,
  itemId: string,
  accountId?: string,
): Promise<ExcelWorksheet[]> {
  const result = await graph<{ value?: ExcelWorksheet[] }>(
    userId,
    `${workbookPath(driveId, itemId)}/worksheets?$select=id,name,position,visibility`,
    undefined,
    accountId,
  );
  return (result.value ?? []).sort((a, b) => a.position - b.position);
}

export async function listExcelTables(
  userId: string,
  driveId: string,
  itemId: string,
  accountId?: string,
): Promise<ExcelTable[]> {
  const result = await graph<{
    value?: Array<{ id: string; name: string; worksheet?: { name?: string } }>;
  }>(
    userId,
    `${workbookPath(driveId, itemId)}/tables?$select=id,name,worksheet`,
    undefined,
    accountId,
  );
  return (result.value ?? []).map((table) => ({
    id: table.id,
    name: table.name,
    worksheetName: table.worksheet?.name ?? null,
  }));
}

export async function readExcelRange(
  userId: string,
  input: {
    driveId: string;
    itemId: string;
    worksheet: string;
    address: string;
    accountId?: string;
  },
) {
  const address = safeRange(input.address);
  return graph<{
    address: string;
    rowCount: number;
    columnCount: number;
    text: string[][];
    values: unknown[][];
    formulas: unknown[][];
  }>(
    userId,
    `${workbookPath(input.driveId, input.itemId)}/worksheets/${worksheetSegment(input.worksheet)}/range(address='${address}')?$select=address,rowCount,columnCount,text,values,formulas`,
    undefined,
    input.accountId,
  );
}

export async function updateExcelRange(
  userId: string,
  input: {
    driveId: string;
    itemId: string;
    worksheet: string;
    address: string;
    values?: unknown[][];
    formulas?: unknown[][];
    accountId?: string;
  },
) {
  const address = safeRange(input.address);
  if (
    (!input.values || !input.values.length) &&
    (!input.formulas || !input.formulas.length)
  ) {
    throw new Error("Values or formulas are required");
  }
  return graph<{
    address: string;
    text: string[][];
    values: unknown[][];
  }>(
    userId,
    `${workbookPath(input.driveId, input.itemId)}/worksheets/${worksheetSegment(input.worksheet)}/range(address='${address}')`,
    {
      method: "PATCH",
      body: JSON.stringify({
        ...(input.values ? { values: input.values } : {}),
        ...(input.formulas ? { formulas: input.formulas } : {}),
      }),
    },
    input.accountId,
  );
}

export async function appendExcelTableRows(
  userId: string,
  input: {
    driveId: string;
    itemId: string;
    tableName: string;
    values: unknown[][];
    accountId?: string;
  },
) {
  return graph(
    userId,
    `${workbookPath(input.driveId, input.itemId)}/tables/${encodeURIComponent(input.tableName.trim())}/rows/add`,
    {
      method: "POST",
      body: JSON.stringify({ index: null, values: input.values }),
    },
    input.accountId,
  );
}

export async function addExcelWorksheet(
  userId: string,
  input: {
    driveId: string;
    itemId: string;
    name: string;
    accountId?: string;
  },
) {
  const name = input.name.trim();
  worksheetSegment(name);
  return graph<ExcelWorksheet>(
    userId,
    `${workbookPath(input.driveId, input.itemId)}/worksheets/add`,
    {
      method: "POST",
      body: JSON.stringify({ name }),
    },
    input.accountId,
  );
}

export async function createExcelWorkbook(
  userId: string,
  input: { name: string; worksheet?: string; accountId?: string },
) {
  const filename = `${input.name.trim().replace(/\.xlsx$/i, "") || "Rook workbook"}.xlsx`;
  if (filename.length > 120 || /["*:<>?\/\\|]/.test(filename))
    throw new Error("Workbook name contains unsupported characters");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Rook";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(input.worksheet?.trim() || "Sheet1");
  sheet.getCell("A1").value = "Created with Rook";
  sheet.getCell("A1").font = { bold: true };
  const bytes = await workbook.xlsx.writeBuffer();
  const accessToken = await accessTokenForAccount(userId, input.accountId);
  const response = await fetch(
    `${GRAPH_BASE}/me/drive/root:/${encodeURIComponent(filename)}:/content`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
      body: Buffer.from(bytes),
    },
  );
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Workbook creation failed (${response.status})`);
  }
  const item = (await response.json()) as {
    id: string;
    name: string;
    webUrl?: string;
    parentReference?: { driveId?: string };
  };
  return {
    id: item.id,
    driveId: item.parentReference?.driveId ?? "",
    name: item.name,
    webUrl: item.webUrl ?? null,
  };
}

export type ExcelWriteToolName =
  | "excel_update_range"
  | "excel_append_table_rows"
  | "excel_add_worksheet"
  | "excel_create_workbook";

export async function executeExcelWrite(
  userId: string,
  toolName: ExcelWriteToolName,
  args: Record<string, unknown>,
) {
  switch (toolName) {
    case "excel_update_range":
      return updateExcelRange(
        userId,
        args as Parameters<typeof updateExcelRange>[1],
      );
    case "excel_append_table_rows":
      return appendExcelTableRows(
        userId,
        args as Parameters<typeof appendExcelTableRows>[1],
      );
    case "excel_add_worksheet":
      return addExcelWorksheet(
        userId,
        args as Parameters<typeof addExcelWorksheet>[1],
      );
    case "excel_create_workbook":
      return createExcelWorkbook(
        userId,
        args as Parameters<typeof createExcelWorkbook>[1],
      );
    default:
      throw new Error(
        `Unsupported Excel write tool: ${toolName satisfies never}`,
      );
  }
}

export function makeExcelActionId() {
  return `excel-${randomUUID()}`;
}

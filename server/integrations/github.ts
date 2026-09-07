import { randomBytes } from "node:crypto";

import * as db from "../db";
import { decryptSecret, encryptSecret } from "./crypto";

const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";

// `repo` covers private and public repositories the account can access;
// `read:user` gives the profile card; `offline_access` returns a rotating
// refresh token so the stored access token can be renewed without the user.
const GITHUB_SCOPES = ["repo", "read:user", "offline_access"].join(" ");

export type GithubRepoSummary = {
  id: number;
  fullName: string;
  description: string | null;
  privateRepo: boolean;
  defaultBranch: string | null;
  language: string | null;
  updatedAt: string | null;
  htmlUrl: string;
};

export type GithubSelectedRepoSummary = {
  fullName: string;
  description: string | null;
  privateRepo: boolean;
  defaultBranch: string | null;
  addedAt: string;
};

function githubConfig() {
  const clientId = process.env.GITHUB_CLIENT_ID?.trim();
  const clientSecret = process.env.GITHUB_CLIENT_SECRET?.trim();
  const appOrigin =
    process.env.APP_ORIGIN?.trim().replace(/\/$/, "") ||
    "https://www.rook.lighting";
  const redirectUri =
    process.env.GITHUB_REDIRECT_URI?.trim() ||
    `${appOrigin}/api/oauth/github/callback`;
  return { clientId, clientSecret, appOrigin, redirectUri };
}

export function isGithubConfigured() {
  return githubMissingEnvVars().length === 0;
}

/** Names the exact env vars this deployment is missing, so "Setup needed" is diagnosable from the UI alone. */
export function githubMissingEnvVars(): string[] {
  const config = githubConfig();
  const missing: string[] = [];
  if (!config.clientId) missing.push("GITHUB_CLIENT_ID");
  if (!config.clientSecret) missing.push("GITHUB_CLIENT_SECRET");
  if (!process.env.INTEGRATION_ENCRYPTION_KEY)
    missing.push("INTEGRATION_ENCRYPTION_KEY");
  return missing;
}

function requireGithubConfig() {
  const config = githubConfig();
  const missing = githubMissingEnvVars();
  if (missing.length > 0) {
    throw new Error(
      `GitHub is not configured for this Rook deployment (missing ${missing.join(", ")}). Environment variables added in Vercel only apply to a NEW deployment — redeploy after saving them.`,
    );
  }
  return {
    ...config,
    clientId: config.clientId!,
    clientSecret: config.clientSecret!,
  };
}

/** A repo the user has explicitly opted into, e.g. `owner/name`. */
export function isValidRepoFullName(fullName: string): boolean {
  return (
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName) &&
    fullName.length <= 140
  );
}

export function selectedRepoRecordKey(userId: string, fullName: string) {
  return `${userId}:${fullName.toLowerCase()}`;
}

// GitHub OAuth apps do not implement PKCE; the app is a confidential client
// and the code exchange happens server-side with the client secret, so the
// signed random `state` is the CSRF defense.
export async function createGithubAuthorizationUrl(
  userId: string,
  returnTo?: string,
) {
  const config = requireGithubConfig();
  const state = randomBytes(32).toString("base64url");

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

  await db.createGithubOAuthState({
    state,
    userId,
    returnTo: safeReturnTo,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });

  const query = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: GITHUB_SCOPES,
    state,
  });
  return `${GITHUB_AUTHORIZE_URL}?${query.toString()}`;
}

type GithubTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
  error_uri?: string;
};

async function tokenRequest(
  values: Record<string, string>,
): Promise<GithubTokenResponse> {
  const config = requireGithubConfig();
  const response = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      ...values,
    }),
  });
  const body = (await response.json()) as GithubTokenResponse;
  if (!response.ok || !body.access_token) {
    throw new Error(
      body.error_description || body.error || "GitHub token exchange failed",
    );
  }
  return body;
}

async function rawGithub<T>(
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${GITHUB_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    let message = `GitHub request failed (${response.status})`;
    try {
      const body = (await response.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // Preserve the status-only message when GitHub does not return JSON.
    }
    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

type GithubUser = {
  id: number;
  login: string;
  name?: string | null;
  avatar_url?: string | null;
};

export async function finishGithubAuthorization(code: string, state: string) {
  const config = requireGithubConfig();
  const oauthState = await db.consumeGithubOAuthState(state);
  if (!oauthState)
    throw new Error(
      "The GitHub connection request expired or was already used",
    );

  const tokens = await tokenRequest({
    code,
    redirect_uri: config.redirectUri,
    state,
  });

  const profile = await rawGithub<GithubUser>(tokens.access_token!, "/user");
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + (tokens.expires_in ?? 8 * 60 * 60) * 1000,
  );

  await db.upsertGithubConnection({
    userId: oauthState.userId,
    githubUserId: String(profile.id),
    login: profile.login,
    displayName: profile.name ?? profile.login,
    avatarUrl: profile.avatar_url ?? null,
    encryptedAccessToken: encryptSecret(tokens.access_token!),
    encryptedRefreshToken: tokens.refresh_token
      ? encryptSecret(tokens.refresh_token)
      : null,
    expiresAt,
    scopes: tokens.scope ?? GITHUB_SCOPES,
    status: "connected",
  });

  return { returnTo: oauthState.returnTo, login: profile.login };
}

export async function getGithubConnectionForUser(userId: string) {
  return db.getGithubConnection(userId);
}

export async function deleteGithubConnectionForUser(userId: string) {
  return db.deleteGithubConnection(userId);
}

/**
 * Returns a live access token, refreshing it (and rotating the stored refresh
 * token) when it has expired. Marks the connection `reauthorize` when the
 * refresh grant is rejected so the UI can ask the user to reconnect.
 */
export async function getGithubAccessToken(userId: string): Promise<string> {
  const connection = await db.getGithubConnection(userId);
  if (!connection) throw new Error("GitHub is not connected");

  if (connection.expiresAt.getTime() > Date.now() + 60_000) {
    return decryptSecret(connection.encryptedAccessToken);
  }
  if (!connection.encryptedRefreshToken) {
    await db.markGithubReauthorizationRequired(userId);
    throw new Error("GitHub needs to be reconnected");
  }

  try {
    const tokens = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: decryptSecret(connection.encryptedRefreshToken),
    });
    const now = new Date();
    await db.updateGithubTokens(userId, {
      encryptedAccessToken: encryptSecret(tokens.access_token!),
      encryptedRefreshToken: tokens.refresh_token
        ? encryptSecret(tokens.refresh_token)
        : connection.encryptedRefreshToken,
      expiresAt: new Date(
        now.getTime() + (tokens.expires_in ?? 8 * 60 * 60) * 1000,
      ),
      scopes: tokens.scope ?? connection.scopes,
    });
    return tokens.access_token!;
  } catch {
    await db.markGithubReauthorizationRequired(userId);
    throw new Error("GitHub needs to be reconnected");
  }
}

export async function githubConnectionStatus(userId: string) {
  const missingEnv = githubMissingEnvVars();
  if (missingEnv.length > 0) {
    return {
      configured: false,
      missingEnv,
      connected: false,
      needsReauthorization: false,
      login: null as string | null,
      displayName: null as string | null,
      avatarUrl: null as string | null,
      scopes: "",
      connectedAt: null as string | null,
      selectedRepos: [] as GithubSelectedRepoSummary[],
    };
  }
  const connection = await db.getGithubConnection(userId);
  const selected = await db.listGithubSelectedRepos(userId);
  const connected = Boolean(connection && connection.status === "connected");
  return {
    configured: true,
    missingEnv: [] as string[],
    connected,
    needsReauthorization: connection?.status === "reauthorize",
    login: connection?.login ?? null,
    displayName: connection?.displayName ?? null,
    avatarUrl: connection?.avatarUrl ?? null,
    scopes: connection?.scopes ?? "",
    connectedAt: connection?.createdAt?.toISOString() ?? null,
    selectedRepos: selected.map(asSelectedRepoSummary),
  };
}

function asSelectedRepoSummary(repo: {
  fullName: string;
  description: string | null;
  privateRepo: boolean;
  defaultBranch: string | null;
  addedAt: Date;
}): GithubSelectedRepoSummary {
  return {
    fullName: repo.fullName,
    description: repo.description,
    privateRepo: repo.privateRepo,
    defaultBranch: repo.defaultBranch,
    addedAt: repo.addedAt.toISOString(),
  };
}

type GithubRepo = {
  id: number;
  full_name: string;
  description: string | null;
  private: boolean;
  default_branch: string | null;
  language: string | null;
  updated_at: string | null;
  html_url: string;
  permissions?: { push?: boolean };
};

async function fetchRepoPage(accessToken: string, page: number) {
  const query = new URLSearchParams({
    visibility: "all",
    affiliation: "owner,collaborator,organization_member",
    sort: "pushed",
    direction: "desc",
    per_page: "100",
    page: String(page),
  });
  return rawGithub<GithubRepo[]>(
    accessToken,
    `/user/repos?${query.toString()}`,
  );
}

/**
 * Repositories the signed-in GitHub account can act on, newest-push-first.
 * Three pages (300 repos) keeps the connector snappy for heavy accounts
 * without an unbounded crawl of every page.
 */
export async function listGithubRepos(
  userId: string,
  search?: string,
): Promise<GithubRepoSummary[]> {
  const accessToken = await getGithubAccessToken(userId);
  const pages = await Promise.all(
    [1, 2, 3].map((page) =>
      fetchRepoPage(accessToken, page).catch(() => [] as GithubRepo[]),
    ),
  );
  const term = search?.trim().toLowerCase() ?? "";
  const seen = new Set<string>();
  const repos: GithubRepoSummary[] = [];
  for (const page of pages) {
    for (const repo of page) {
      if (seen.has(repo.full_name)) continue;
      seen.add(repo.full_name);
      if (term && !repo.full_name.toLowerCase().includes(term)) continue;
      repos.push({
        id: repo.id,
        fullName: repo.full_name,
        description: repo.description,
        privateRepo: repo.private,
        defaultBranch: repo.default_branch,
        language: repo.language,
        updatedAt: repo.updated_at,
        htmlUrl: repo.html_url,
      });
    }
  }
  return repos.slice(0, 200);
}

/** Adds a repo to the user's AI working set after re-verifying access. */
export async function selectGithubRepo(userId: string, fullName: string) {
  if (!isValidRepoFullName(fullName))
    throw new Error(
      "That does not look like a GitHub repository (expected owner/name)",
    );
  const accessToken = await getGithubAccessToken(userId);
  const repo = await rawGithub<GithubRepo>(
    accessToken,
    `/repos/${fullName}`,
  ).catch(() => {
    throw new Error(
      "Rook could not verify access to that repository with your GitHub account",
    );
  });
  const existing = await db.listGithubSelectedRepos(userId);
  if (existing.length >= 25)
    throw new Error(
      "You can keep at most 25 repositories in the AI working set",
    );
  await db.addGithubSelectedRepo(userId, {
    fullName: repo.full_name,
    repoId: repo.id,
    privateRepo: repo.private,
    defaultBranch: repo.default_branch,
    description: repo.description,
  });
  return asSelectedRepoSummary({
    fullName: repo.full_name,
    description: repo.description,
    privateRepo: repo.private,
    defaultBranch: repo.default_branch,
    addedAt: new Date(),
  });
}

export async function unselectGithubRepo(userId: string, fullName: string) {
  await db.removeGithubSelectedRepo(userId, fullName);
}

async function requireSelectedRepo(userId: string, fullName: string) {
  const selected = await db.listGithubSelectedRepos(userId);
  const match = selected.find(
    (repo) => repo.fullName.toLowerCase() === fullName.toLowerCase(),
  );
  if (!match)
    throw new Error(
      `${fullName} is not in the GitHub working set. Ask the user to add it from Account → GitHub first.`,
    );
  return match;
}

async function requireRepoToken(userId: string, fullName: string) {
  const repo = await requireSelectedRepo(userId, fullName);
  const accessToken = await getGithubAccessToken(userId);
  return { repo, accessToken };
}

export async function getGithubRepoOverview(userId: string, fullName: string) {
  const { accessToken } = await requireRepoToken(userId, fullName);
  const [repo, languages] = await Promise.all([
    rawGithub<GithubRepo>(accessToken, `/repos/${fullName}`),
    rawGithub<Record<string, number>>(
      accessToken,
      `/repos/${fullName}/languages`,
    )
      .then((value) => Object.keys(value).slice(0, 8))
      .catch(() => [] as string[]),
  ]);
  return {
    fullName: repo.full_name,
    description: repo.description,
    privateRepo: repo.private,
    defaultBranch: repo.default_branch,
    language: repo.language,
    languages,
    updatedAt: repo.updated_at,
    htmlUrl: repo.html_url,
    canPush: Boolean(repo.permissions?.push),
  };
}

export async function listGithubRepoFiles(
  userId: string,
  fullName: string,
  path?: string,
) {
  const { repo, accessToken } = await requireRepoToken(userId, fullName);
  const cleanPath = (path ?? "").replace(/^\/+|\/+$/g, "");
  const ref = repo.defaultBranch
    ? `?ref=${encodeURIComponent(repo.defaultBranch)}`
    : "";
  const contents = await rawGithub<
    Array<{ name: string; path: string; type: string; size: number }>
  >(accessToken, `/repos/${fullName}/contents/${cleanPath}${ref}`);
  if (!Array.isArray(contents))
    throw new Error(
      "That path is a file, not a directory. Use github_read_file.",
    );
  return {
    repo: repo.fullName,
    path: cleanPath || "/",
    entries: contents.slice(0, 100).map((entry) => ({
      name: entry.name,
      path: entry.path,
      type: entry.type,
      size: entry.size,
    })),
    truncated: contents.length > 100,
  };
}

export async function readGithubRepoFile(
  userId: string,
  fullName: string,
  path: string,
) {
  const { repo, accessToken } = await requireRepoToken(userId, fullName);
  const cleanPath = path.replace(/^\/+/, "");
  const ref = repo.defaultBranch
    ? `?ref=${encodeURIComponent(repo.defaultBranch)}`
    : "";
  const file = await rawGithub<{
    name: string;
    path: string;
    size: number;
    encoding: string;
    content?: string;
  }>(accessToken, `/repos/${fullName}/contents/${cleanPath}${ref}`);
  if (file.encoding === "none" || !file.content)
    throw new Error(
      `${cleanPath} is too large for the contents API. Ask the user to attach the relevant excerpt instead.`,
    );
  const text = Buffer.from(file.content, "base64").toString("utf8");
  return {
    repo: repo.fullName,
    path: file.path,
    size: file.size,
    content:
      text.length > 60_000 ? `${text.slice(0, 60_000)}\n… (truncated)` : text,
    truncated: text.length > 60_000,
  };
}

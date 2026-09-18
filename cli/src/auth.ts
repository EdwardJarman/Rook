/**
 * Sign-in for the terminal. `login` is a device-code flow: the terminal
 * shows a short code, the browser approves anytime, the terminal polls
 * until the token lands. No localhost listener, no shared timing — a
 * closed terminal or a slow approver cannot strand either side.
 * Logic returns values; cli.ts prints. Nothing here touches stdout, so
 * every path is unit-testable against stub HTTP servers.
 */

import { exec } from "node:child_process";

import { ApiError, trpc } from "./api.js";
import { clearProfile, DEFAULT_API_URL, loadProfile, saveProfile, type CliProfile } from "./config.js";

export type Me = {
  id: string;
  name: string | null;
  email: string | null;
} | null;

/** Where the approval page lives. Local API dev convention: UI :8081, API :3000. */
export function webUrlFor(apiUrl: string, explicit?: string): string {
  if (explicit?.trim()) return explicit.trim().replace(/\/+$/, "");
  try {
    const url = new URL(apiUrl);
    if (
      (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
      url.port === "3000"
    ) {
      return `${url.protocol}//${url.hostname}:8081`;
    }
  } catch {
    // Fall through to apiUrl.
  }
  return apiUrl.replace(/\/+$/, "");
}

export const cliAuthPageUrl = (webUrl: string, code: string): string =>
  `${webUrl.replace(/\/+$/, "")}/cli-auth?code=${encodeURIComponent(code)}`;

export function openBrowser(url: string): void {
  const command =
    process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(command, () => {
    // A failed open is not fatal: the caller always prints the manual URL.
  });
}

export const LOGIN_WAIT_MS = 10 * 60 * 1_000;
const LOGIN_POLL_MS = 3_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type DeviceChallenge = { code: string; expiresInSec: number };
type DevicePoll =
  | { status: "pending" }
  | { status: "approved"; token: string; expiresAt: string }
  | { status: "expired" };

/**
 * Anonymous device calls (the terminal holds no token yet). Mutations
 * POST; queries ride GET — the server answers 405 to POSTed queries.
 */
async function deviceCall<T>(
  apiUrl: string,
  procPath: string,
  input?: unknown,
  method: "GET" | "POST" = "POST",
): Promise<T> {
  try {
    return await trpc<T>({ apiUrl, token: null }, procPath, input, {
      method,
      anonymous: true,
      timeoutMs: 30_000,
    });
  } catch (error) {
    if (error instanceof ApiError && /no procedure|NOT_FOUND/i.test(`${error.code ?? ""} ${error.message}`)) {
      throw new ApiError(
        "This Rook server is too old for device login. Restart it from current sources, then try again.",
      );
    }
    throw error;
  }
}

const FAST_CALL_TIMEOUT_MS = 30_000;

export async function fetchMe(profile: CliProfile): Promise<Me> {
  if (!profile.token) return null;
  try {
    return await trpc<Me>(profile, "auth.me", undefined, { timeoutMs: FAST_CALL_TIMEOUT_MS });
  } catch (error) {
    if (error instanceof ApiError && error.code === "UNAUTHORIZED") return null;
    throw error;
  }
}

/** Direct-token sign-in (`--token`). Verifies before saving. */
export async function loginWithToken(
  apiUrl: string,
  token: string,
): Promise<{ profile: CliProfile; me: Exclude<Me, null> }> {
  const profile: CliProfile = { apiUrl, token: token.trim() };
  const me = await fetchMe(profile);
  if (!me) throw new ApiError("That token was rejected. Re-run `rook login` for a fresh one.");
  saveProfile(profile);
  return { profile, me };
}

/**
 * Device-code login. `open` is injectable for tests (defaults to the real
 * system browser); `onCode` reports the code + URL for display. Polls
 * until approval, expiry, or timeout — a closed browser or a slow human
 * cannot strand either side, because nothing here depends on timing.
 */
export async function loginWithDevice(
  apiUrl: string,
  opts?: {
    webUrl?: string;
    open?: (url: string) => void;
    onCode?: (code: string, manualUrl: string) => void;
    timeoutMs?: number;
    pollIntervalMs?: number;
  },
): Promise<{ profile: CliProfile; me: Exclude<Me, null>; manualUrl: string }> {
  const challenge = await deviceCall<DeviceChallenge>(apiUrl, "auth.deviceChallenge");
  const webUrl = webUrlFor(apiUrl, opts?.webUrl);
  const manualUrl = cliAuthPageUrl(webUrl, challenge.code);
  (opts?.open ?? openBrowser)(manualUrl);
  opts?.onCode?.(challenge.code, manualUrl);
  const deadline = Date.now() + (opts?.timeoutMs ?? LOGIN_WAIT_MS);
  const interval = opts?.pollIntervalMs ?? LOGIN_POLL_MS;
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error("Approval timed out after 10 minutes. Re-run `rook login` when ready.");
    }
    await sleep(interval);
    const poll = await deviceCall<DevicePoll>(apiUrl, "auth.devicePoll", { code: challenge.code }, "GET");
    if (poll.status === "approved" && poll.token) {
      const profile: CliProfile = { apiUrl, token: poll.token };
      const me = await fetchMe(profile);
      if (!me) throw new ApiError("That token was rejected. Re-run `rook login` for a fresh one.");
      saveProfile(profile);
      return { profile, me, manualUrl };
    }
    if (poll.status === "expired") {
      throw new Error("That code expired. Re-run `rook login` for a fresh one.");
    }
  }
}

export function logout(): void {
  clearProfile();
}

export function currentProfile(): CliProfile {
  return loadProfile();
}

export const defaultApiUrl = (explicit?: string): string =>
  explicit?.trim() || loadProfile().apiUrl || DEFAULT_API_URL;

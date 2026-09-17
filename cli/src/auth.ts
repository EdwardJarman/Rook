/**
 * Sign-in for the terminal. `login` uses the same device approval the web
 * app shows: browser opens, user approves, token lands on localhost.
 * Logic returns values; cli.ts prints. Nothing here touches stdout, so
 * every path is unit-testable against stub HTTP servers.
 */

import { exec } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";

import { ApiError, trpc } from "./api.js";
import { clearProfile, DEFAULT_API_URL, loadProfile, saveProfile, type CliProfile } from "./config.js";

export type Me = {
  id: string;
  name: string | null;
  email: string | null;
} | null;

export const newCallbackKey = (): string => randomBytes(16).toString("hex");

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

export const cliAuthPageUrl = (webUrl: string, port: number, key: string): string =>
  `${webUrl.replace(/\/+$/, "")}/cli-auth?port=${port}&key=${encodeURIComponent(key)}`;

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

export type CallbackPayload = { key: string; token: string; apiUrl: string };

/** Localhost listener for the approval POST. Caller must close(). */
export async function listenForCallback(timeoutMs = 5 * 60 * 1_000): Promise<{
  port: number;
  wait: Promise<CallbackPayload>;
  close: () => void;
}> {
  let server: Server | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // DOM lib (root `tsc`) types setTimeout as number while Node returns a
  // Timeout: reach unref through a narrow cast that is valid under both.
  const unrefTimer = (): void => {
    (timer as unknown as { unref?: () => void } | undefined)?.unref?.();
  };
  const wait = new Promise<CallbackPayload>((resolve, reject) => {
    server = createServer((req, res) => {
      if (req.method !== "POST" || !req.url?.startsWith("/callback")) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end("{}");
        return;
      }
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        try {
          const payload = JSON.parse(body) as Partial<CallbackPayload>;
          if (
            typeof payload.key === "string" &&
            payload.key &&
            typeof payload.token === "string" &&
            payload.token.startsWith("rook_") &&
            typeof payload.apiUrl === "string" &&
            payload.apiUrl
          ) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end('{"ok":true}');
            resolve(payload as CallbackPayload);
          } else {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end("{}");
          }
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end("{}");
        }
      });
    });
    timer = setTimeout(() => {
      try {
        server?.close();
      } catch {
        // Already closed.
      }
      reject(
        new Error("Approval timed out after 5 minutes. Re-run `rook login` when ready."),
      );
    }, timeoutMs);
    unrefTimer();
  });
  const port = await new Promise<number>((resolve, reject) => {
    server!.on("error", reject).listen(0, "127.0.0.1", () => {
      resolve((server!.address() as { port: number }).port);
    });
  });
  return {
    port,
    wait: wait.finally(() => {
      if (timer) clearTimeout(timer);
    }),
    close: () => {
      if (timer) clearTimeout(timer);
      try {
        server?.close();
      } catch {
        // Already closed.
      }
    },
  };
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
 * Browser device login. `open` is injectable for tests (defaults to the
 * real system browser). Resolves once the approval lands or rejects.
 */
export async function loginWithBrowser(
  apiUrl: string,
  opts?: {
    webUrl?: string;
    open?: (url: string) => void;
    key?: string;
    timeoutMs?: number;
    onOpened?: (manualUrl: string) => void;
  },
): Promise<{ profile: CliProfile; me: Exclude<Me, null>; manualUrl: string }> {
  const key = opts?.key ?? newCallbackKey();
  const listener = await listenForCallback(opts?.timeoutMs);
  const webUrl = webUrlFor(apiUrl, opts?.webUrl);
  const manualUrl = cliAuthPageUrl(webUrl, listener.port, key);
  try {
    (opts?.open ?? openBrowser)(manualUrl);
    opts?.onOpened?.(manualUrl);
    const payload = await listener.wait;
    if (payload.key !== key) {
      throw new Error("Approval key mismatch. Re-run `rook login` and approve once.");
    }
    const profile: CliProfile = { apiUrl: payload.apiUrl, token: payload.token };
    const me = await fetchMe(profile);
    if (!me) throw new ApiError("That token was rejected. Re-run `rook login` for a fresh one.");
    saveProfile(profile);
    return { profile, me, manualUrl };
  } finally {
    listener.close();
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

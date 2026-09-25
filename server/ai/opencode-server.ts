/**
 * Rook-managed OpenCode sidecar.
 *
 * Before this module, running OpenCode through Rook meant hand-operating
 * two daemons: install the binary, start `opencode serve` with the right
 * flags, export passwords/URLs, restart Rook on every change — and redo it
 * all after every reboot or dead process. Any step missed left the UI
 * stranded on "Setup required" with no path back.
 *
 * Now the Rook server owns the lifecycle for local servers: when the
 * configured (or default loopback) base URL is unreachable and management
 * is enabled, Rook spawns `opencode serve` itself, waits for
 * `/global/health`, and recovers it on later turns. An already-running
 * server is never touched (no kills, no password overrides).
 *
 * Boundaries, deliberately:
 * - Only loopback bases are ever managed. Remote URLs stay BYO.
 * - `OPENCODE_MANAGED=0` disables everything (pure BYO, old behavior).
 * - No per-token/per-user servers: one managed child per Rook process.
 * - Passwords: explicit env wins; otherwise an in-memory ephemeral one
 *   that dies with the process (never logged, never returned by status).
 */

import { randomBytes } from "node:crypto";
import { spawn as spawnProcess, type ChildProcess } from "node:child_process";

export const OPENCODE_DEFAULT_HOST = "127.0.0.1";
export const OPENCODE_DEFAULT_PORT = 4123;
export const OPENCODE_DEFAULT_BASE = `http://${OPENCODE_DEFAULT_HOST}:${OPENCODE_DEFAULT_PORT}`;
export const MANAGED_START_TIMEOUT_MS = 15_000;
const HEALTH_PROBE_TIMEOUT_MS = 2_000;
const HEALTH_POLL_INTERVAL_MS = 500;
const STDERR_TAIL_CHARS = 2_000;

export type SpawnFn = (
  bin: string,
  args: string[],
  opts: {
    env: NodeJS.ProcessEnv;
    stdio: ["ignore", "ignore", "pipe"];
    detached: false;
    shell: boolean;
    windowsHide: boolean;
  },
) => ChildProcess;

export type ManagedServerResult = {
  baseUrl: string;
  /** True when this call started the process (false = already running). */
  started: boolean;
  /** Process id when Rook owns the child. */
  pid?: number;
};

export const opencodeBinary = (): string =>
  process.env.OPENCODE_BIN?.trim() || "opencode";

export const isManagedEnabled = (): boolean => {
  const raw = (process.env.OPENCODE_MANAGED ?? "").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "no" && raw !== "off";
};

export const isLoopbackBaseUrl = (baseUrl: string): boolean => {
  try {
    // WHATWG URLs keep IPv6 brackets on hostname ("[::1]").
    const host = new URL(baseUrl).hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
};

export const envPassword = (): string =>
  (process.env.OPENCODE_SERVER_PASSWORD ?? "").trim();

export const envUsername = (): string =>
  (process.env.OPENCODE_SERVER_USERNAME ?? "").trim() || "opencode";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type HealthState = { ok: boolean; version?: string };

/** Raw health probe (authenticated: managed servers carry a password). False on any failure — never throws. */
export const probeOpenCodeHealth = async (baseUrl: string): Promise<HealthState> => {
  const password = envPassword() || managedPassword;
  const headers: Record<string, string> = password
    ? { Authorization: `Basic ${Buffer.from(`${envUsername()}:${password}`).toString("base64")}` }
    : {};
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/global/health`, {
      headers,
      signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false };
    const body = (await response.json().catch(() => ({}))) as {
      healthy?: boolean;
      version?: string;
    };
    return {
      ok: body.healthy !== false,
      version: typeof body.version === "string" ? body.version : undefined,
    };
  } catch {
    return { ok: false };
  }
};

let managedChild: ChildProcess | undefined;
let managedPassword: string | undefined;
let inflight: Promise<ManagedServerResult> | undefined;

/** Ephemeral password for Rook-spawned servers (env wins when set). */
export const managedAuthPassword = (): string | undefined =>
  envPassword() || managedPassword;

const killManagedChild = async (): Promise<void> => {
  const child = managedChild;
  managedChild = undefined;
  if (!child || child.killed) return;
  try {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise<void>((resolve) => child.once("exit", () => resolve())),
      sleep(2_500),
    ]);
  } catch {
    // Already gone.
  }
  try {
    if (!child.killed) child.kill("SIGKILL");
  } catch {
    // Already gone.
  }
};

// Never orphan a Rook-spawned server on shutdown or tsx-watch restart.
// The "exit" hook covers process.exit() paths where signals never fire;
// child.kill() is synchronous fire-and-forget, so it works there too.
const killManagedChildSync = (): void => {
  try {
    managedChild?.kill("SIGTERM");
  } catch {
    // Exiting anyway.
  }
};
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, killManagedChildSync);
}
process.once("exit", killManagedChildSync);

const parseBase = (baseUrl: string): { host: string; port: number } => {
  const url = new URL(baseUrl);
  const port = Number(url.port);
  if (!url.hostname || !Number.isInteger(port) || port <= 0) {
    throw new Error(
      `OpenCode base URL is not usable (${baseUrl}). Use http://127.0.0.1:4123 style.`,
    );
  }
  return { host: url.hostname, port };
};

/**
 * Ensure an OpenCode server answers at baseUrl, spawning a Rook-managed
 * one when nothing does. Resolves fast when a server is already up.
 * Throws honest, user-actionable errors (missing binary, occupied port,
 * startup timeout) — never hangs past timeoutMs.
 */
export async function ensureManagedServer(
  baseUrl: string,
  opts?: { spawn?: SpawnFn; timeoutMs?: number },
): Promise<ManagedServerResult> {
  if (inflight) return inflight;
  inflight = (async (): Promise<ManagedServerResult> => {
    if ((await probeOpenCodeHealth(baseUrl)).ok) {
      return { baseUrl, started: false, pid: managedChild?.pid };
    }
    const timeoutMs = opts?.timeoutMs ?? MANAGED_START_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;
    const { host, port } = parseBase(baseUrl);
    const bin = opencodeBinary();
    const password = envPassword() || randomBytes(16).toString("hex");
    if (!envPassword()) managedPassword = password;

    await killManagedChild();

    let stderrTail = "";
    let spawnError: unknown;
    const child = await (async (): Promise<ChildProcess | undefined> => {
      try {
        const proc = (opts?.spawn ?? defaultSpawn)(bin, ["serve", "--port", String(port), "--hostname", host], {
          env: {
            ...process.env,
            OPENCODE_SERVER_PASSWORD: password,
            OPENCODE_SERVER_USERNAME: envUsername(),
          },
          stdio: ["ignore", "ignore", "pipe"],
          detached: false,
          // Windows ships opencode as a .cmd shim: without a shell,
          // spawn fails with "%1 is not a valid Win32 application".
          shell: process.platform === "win32",
          windowsHide: true,
        });
        proc.stderr?.on("data", (chunk: Buffer) => {
          stderrTail = `${stderrTail}${chunk.toString()}`.slice(-STDERR_TAIL_CHARS);
        });
        return proc;
      } catch (error) {
        spawnError = error;
        return undefined;
      }
    })();

    if (!child) {
      managedPassword = envPassword() || undefined;
      throw new Error(
        `OpenCode CLI not found ("${bin}"). Install it: curl -fsSL https://opencode.ai/install | bash (Windows: irm https://opencode.ai/install.ps1 | iex) — or point OPENCODE_BASE_URL at a running server. [${describeSpawnError(spawnError)}]`,
      );
    }
    managedChild = child;

    const earlyExit = new Promise<never>((_, reject) => {
      child.once("exit", (code) => {
        reject(
          new Error(
            `OpenCode server exited during startup (code ${code ?? "?"}). Try \`opencode serve --port ${port}\` by hand to see why.${stderrTail ? ` Last output: ${stderrTail.slice(0, 500)}` : ""}`,
          ),
        );
      });
      child.once("error", (error) => {
        reject(
          new Error(
            `OpenCode server failed to start (${describeSpawnError(error)}). Is another program on port ${port}, or is the binary missing?`,
          ),
        );
      });
    });

    try {
      await Promise.race([
        (async () => {
          for (;;) {
            if ((await probeOpenCodeHealth(baseUrl)).ok) return;
            if (Date.now() > deadline) {
              throw new Error(
                `OpenCode server did not answer at ${baseUrl} within ${Math.round(timeoutMs / 1000)}s. Is port ${port} already taken by something else?${stderrTail ? ` Last output: ${stderrTail.slice(0, 500)}` : ""}`,
              );
            }
            await sleep(HEALTH_POLL_INTERVAL_MS);
          }
        })(),
        earlyExit,
      ]);
    } catch (error) {
      await killManagedChild();
      throw error;
    }
    return { baseUrl, started: true, pid: child.pid };
  })();

  try {
    return await inflight;
  } finally {
    inflight = undefined;
  }
}

const defaultSpawn: SpawnFn = (bin, args, opts) => spawnProcess(bin, args, opts);

const describeSpawnError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/ENOENT/i.test(message)) return "binary not on PATH";
  return message.slice(0, 160) || "unknown spawn error";
};

/** Best-effort stop of the Rook-managed child, if any. */
export async function stopManagedServer(): Promise<void> {
  await killManagedChild();
  managedPassword = undefined;
}

export const __resetManagedServerForTests = (): void => {
  managedChild = undefined;
  managedPassword = undefined;
  inflight = undefined;
};

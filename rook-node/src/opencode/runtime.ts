/**
 * OpenCode sidecar — per-workroom `opencode serve` lifecycle.
 *
 * Mirrors Orca's model: one agent = one isolated worktree + one server on an
 * isolated port, driven via SDK (`createOpencodeClient({baseUrl})` → session).
 * For Rook, the workroomId maps to a port + child process, managed alongside
 * ChromiumRuntime so it shares FileBroker workspace and dies with the node.
 *
 * This module is intentionally small and side-effect-free enough to unit-test
 * without spawning a real `opencode` binary (which may not be on PATH in CI).
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";

export type OpenCodeInstance = {
  workroomId: string;
  port: number;
  baseUrl: string;
  child: ChildProcess;
  password: string;
  startedAt: string;
};

export type OpenCodeHealth = {
  workroomId: string;
  port: number;
  baseUrl: string;
  reachable: boolean;
  status?: number;
};

const DEFAULT_HOST = "127.0.0.1";

/** Random port fallback when 0 is not desired (e.g., explicit advertise). */
export async function findAvailablePort(preferredPort = 0): Promise<number> {
  if (preferredPort === 0) {
    return new Promise((resolve, reject) => {
      const srv = createServer();
      srv.listen(0, DEFAULT_HOST, () => {
        const addr = srv.address() as { port: number } | null;
        const port = addr?.port;
        srv.close(() => (port ? resolve(port) : reject(new Error("No port assigned"))));
      });
      srv.on("error", reject);
    });
  }
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(preferredPort, DEFAULT_HOST, () => {
      const addr = srv.address() as { port: number } | null;
      const port = addr?.port ?? preferredPort;
      srv.close(() => resolve(port));
    });
  });
}

export function opencodeBinary(): string {
  return process.env.OPENCODE_BIN?.trim() || "opencode";
}

export function opencodePassword(): string {
  const env = process.env.OPENCODE_SERVER_PASSWORD?.trim();
  if (env) return env;
  return `rook-${randomBytes(12).toString("hex")}`;
}

export function opencodeEnvForInstance(password: string): NodeJS.ProcessEnv {
  return {
    OPENCODE_SERVER_PASSWORD: password,
    OPENCODE_SERVER_USERNAME: "opencode",
  };
}

export async function healthCheck(baseUrl: string): Promise<OpenCodeHealth & { status?: number }> {
  const workroomId = "probe";
  const root = baseUrl.replace(/\/$/, "");
  const port = Number(new URL(baseUrl).port) || 0;
  // `/global/health` answers `{ healthy: true, version }` (verified on v1.18.31);
  // `/doc` (OpenAPI JSON) is the fallback for older servers.
  for (const path of ["/global/health", "/doc"]) {
    try {
      const res = await fetch(`${root}${path}`, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        if (path === "/global/health") {
          const body = (await res.json().catch(() => ({}))) as { healthy?: boolean };
          const reachable = body.healthy !== false;
          return { workroomId, port, baseUrl, reachable, status: res.status };
        }
        return { workroomId, port, baseUrl, reachable: true, status: res.status };
      }
    } catch {
      // Try the next probe path.
    }
  }
  return { workroomId, port, baseUrl, reachable: false };
}

export class OpenCodeRuntime {
  private readonly instances = new Map<string, OpenCodeInstance>();

  constructor(private readonly opts: { host?: string } = {}) {}

  get host(): string {
    return this.opts.host ?? DEFAULT_HOST;
  }

  list(): OpenCodeInstance[] {
    return [...this.instances.values()];
  }

  get(workroomId: string): OpenCodeInstance | undefined {
    return this.instances.get(workroomId);
  }

  async spawn(workroomId: string, port?: number): Promise<OpenCodeInstance> {
    if (this.instances.has(workroomId)) return this.instances.get(workroomId)!;
    const resolvedPort = port ?? (await findAvailablePort(0));
    const baseUrl = `http://${this.host}:${resolvedPort}`;
    const password = opencodePassword();
    const bin = opencodeBinary();
    // Do not throw if binary missing in test/CI — caller can health-check.
    const child = spawn(bin, ["serve", "--port", String(resolvedPort), "--hostname", this.host], {
      env: { ...process.env, ...opencodeEnvForInstance(password) },
      stdio: "ignore",
      detached: false,
    });
    child.on("error", () => undefined);
    // Avoid zombie if parent exits unexpectedly — best-effort unref.
    child.unref?.();
    const instance: OpenCodeInstance = {
      workroomId,
      port: resolvedPort,
      baseUrl,
      child,
      password,
      startedAt: new Date().toISOString(),
    };
    this.instances.set(workroomId, instance);
    return instance;
  }

  async stop(workroomId: string): Promise<void> {
    const inst = this.instances.get(workroomId);
    if (!inst) return;
    this.instances.delete(workroomId);
    inst.child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        inst.child.kill("SIGKILL");
        resolve();
      }, 2500);
      inst.child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.instances.keys()].map((id) => this.stop(id)));
  }
}

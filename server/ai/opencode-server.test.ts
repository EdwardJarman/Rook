import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetManagedServerForTests,
  ensureManagedServer,
  isLoopbackBaseUrl,
  isManagedEnabled,
  managedAuthPassword,
  probeOpenCodeHealth,
  stopManagedServer,
} from "./opencode-server";

const BASE = "http://127.0.0.1:4123";

type Listener = (...args: unknown[]) => void;

class FakeChild {
  pid = 4242;
  killed = false;
  killCalls: string[] = [];
  handlers = new Map<string, Listener[]>();
  stderr = { on: vi.fn() };

  on(event: string, cb: Listener): this {
    const list = this.handlers.get(event) ?? [];
    list.push(cb);
    this.handlers.set(event, list);
    return this;
  }

  once(event: string, cb: Listener): this {
    return this.on(event, cb);
  }

  emit(event: string, ...args: unknown[]): void {
    for (const cb of this.handlers.get(event) ?? []) cb(...args);
  }

  kill(signal?: string): boolean {
    this.killCalls.push(signal ?? "SIGTERM");
    this.killed = true;
    // Die like a real child so kill-waiters resolve instead of timing out.
    setTimeout(() => this.emit("exit", 0), 10);
    return true;
  }
}

const healthyFetch = () =>
  vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ healthy: true, version: "1.18.31" }),
  })) as unknown as typeof fetch;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  __resetManagedServerForTests();
  delete process.env.OPENCODE_BASE_URL;
  delete process.env.OPENCODE_SERVER_PASSWORD;
  delete process.env.OPENCODE_SERVER_USERNAME;
  delete process.env.OPENCODE_MANAGED;
  delete process.env.OPENCODE_BIN;
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await stopManagedServer().catch(() => undefined);
  __resetManagedServerForTests();
  delete process.env.OPENCODE_MANAGED;
  delete process.env.OPENCODE_BIN;
  delete process.env.OPENCODE_SERVER_PASSWORD;
});

describe("managed mode switches", () => {
  it("is on by default and honors explicit off values", () => {
    expect(isManagedEnabled()).toBe(true);
    for (const off of ["0", "false", "FALSE", "no", "off", " 0 "]) {
      process.env.OPENCODE_MANAGED = off;
      expect(isManagedEnabled()).toBe(false);
    }
    process.env.OPENCODE_MANAGED = "1";
    expect(isManagedEnabled()).toBe(true);
  });

  it("only treats loopback bases as manageable", () => {
    expect(isLoopbackBaseUrl("http://127.0.0.1:4123")).toBe(true);
    expect(isLoopbackBaseUrl("http://localhost:9/")).toBe(true);
    expect(isLoopbackBaseUrl("http://[::1]:4123/")).toBe(true);
    expect(isLoopbackBaseUrl("http://192.168.1.9:4123")).toBe(false);
    expect(isLoopbackBaseUrl("https://example.com")).toBe(false);
    expect(isLoopbackBaseUrl("not a url")).toBe(false);
  });
});

describe("ensureManagedServer", () => {
  it("leaves a running server alone without spawning", async () => {
    vi.stubGlobal("fetch", healthyFetch());
    const spawn = vi.fn();
    const result = await ensureManagedServer(BASE, {
      spawn: spawn as never,
      timeoutMs: 2_000,
    });
    expect(result).toMatchObject({ baseUrl: BASE, started: false });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("spawns with port, hostname, and password env, then waits for health", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        if (calls < 3) throw new Error("ECONNREFUSED");
        return { ok: true, status: 200, json: async () => ({ healthy: true }) };
      }) as unknown as typeof fetch,
    );
    const child = new FakeChild();
    let seenArgs: string[] = [];
    let seenEnv: Record<string, string | undefined> = {};
    const spawn = vi.fn((bin: string, args: string[], opts: { env: Record<string, string | undefined> }) => {
      expect(bin).toBe("opencode");
      seenArgs = args;
      seenEnv = opts.env;
      return child;
    });
    const result = await ensureManagedServer(BASE, {
      spawn: spawn as never,
      timeoutMs: 5_000,
    });
    expect(seenArgs).toEqual(["serve", "--port", "4123", "--hostname", "127.0.0.1"]);
    expect(typeof seenEnv.OPENCODE_SERVER_PASSWORD).toBe("string");
    expect(seenEnv.OPENCODE_SERVER_USERNAME).toBe("opencode");
    expect(result).toMatchObject({ baseUrl: BASE, started: true, pid: 4242 });
    // Ephemeral password is reused for API calls until the process ends.
    expect(managedAuthPassword()).toBe(seenEnv.OPENCODE_SERVER_PASSWORD);
  });

  it("prefers the explicit env password over ephemeral ones", async () => {
    process.env.OPENCODE_SERVER_PASSWORD = "fixed-pass";
    vi.stubGlobal("fetch", healthyFetch());
    // Healthy already: no spawn, env password wins for API auth.
    await ensureManagedServer(BASE, { timeoutMs: 2_000 });
    expect(managedAuthPassword()).toBe("fixed-pass");
  });

  it("explains a missing binary with an install hint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
    );
    const spawn = vi.fn(() => {
      throw new Error("spawn opencode ENOENT");
    });
    await expect(
      ensureManagedServer(BASE, { spawn: spawn as never, timeoutMs: 2_000 }),
    ).rejects.toThrow(/not found.*opencode\.ai\/install/);
  });

  it("surfaces early exits with the child output", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
    );
    const child = new FakeChild();
    const spawn = vi.fn(() => {
      setTimeout(() => child.emit("exit", 1), 20);
      return child;
    });
    await expect(
      ensureManagedServer(BASE, { spawn: spawn as never, timeoutMs: 5_000 }),
    ).rejects.toThrow(/exited during startup/);
  });

  it("times out with port guidance and kills the child", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
    );
    const child = new FakeChild();
    const spawn = vi.fn(() => child);
    await expect(
      ensureManagedServer(BASE, { spawn: spawn as never, timeoutMs: 1_200 }),
    ).rejects.toThrow(/did not answer.*4123/);
    expect(child.killCalls.length).toBeGreaterThan(0);
  });

  it("kills a previous managed child before respawning", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
    );
    const first = new FakeChild();
    const second = new FakeChild();
    const spawn = vi.fn(() => (spawn.mock.calls.length <= 1 ? first : second));
    await expect(
      ensureManagedServer(BASE, { spawn: spawn as never, timeoutMs: 800 }),
    ).rejects.toThrow();
    await expect(
      ensureManagedServer(BASE, { spawn: spawn as never, timeoutMs: 800 }),
    ).rejects.toThrow();
    expect(first.killCalls.length).toBeGreaterThan(0);
  });

  it("shares one spawn between concurrent callers", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        if (calls < 4) throw new Error("ECONNREFUSED");
        return { ok: true, status: 200, json: async () => ({ healthy: true }) };
      }) as unknown as typeof fetch,
    );
    const spawn = vi.fn(() => new FakeChild());
    const [a, b] = await Promise.all([
      ensureManagedServer(BASE, { spawn: spawn as never, timeoutMs: 5_000 }),
      ensureManagedServer(BASE, { spawn: spawn as never, timeoutMs: 5_000 }),
    ]);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(a.started).toBe(true);
    expect(b.started).toBe(true);
  });

  it("probeOpenCodeHealth never throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("down");
      }) as unknown as typeof fetch,
    );
    await expect(probeOpenCodeHealth(BASE)).resolves.toEqual({ ok: false });
  });
});

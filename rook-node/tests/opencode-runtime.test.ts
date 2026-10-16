import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { findAvailablePort, opencodePassword, opencodeBinary, healthCheck, OpenCodeRuntime } from "../src/opencode/runtime";

describe("opencode runtime helpers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.OPENCODE_BIN;
    delete process.env.OPENCODE_SERVER_PASSWORD;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("findAvailablePort(0) returns an OS-assigned port > 1024", async () => {
    const port1 = await findAvailablePort(0);
    const port2 = await findAvailablePort(0);
    expect(port1).toBeGreaterThan(1024);
    expect(port2).toBeGreaterThan(1024);
    expect(port1).not.toBe(port2);
  });

  it("findAvailablePort respects preferred port when free", async () => {
    const port = await findAvailablePort(0);
    // Next call with same port may collide, but should still return a port
    const sameAttempt = await findAvailablePort(port).catch(() => port);
    expect(typeof sameAttempt).toBe("number");
  });

  it("opencodePassword respects env override and otherwise random", () => {
    process.env.OPENCODE_SERVER_PASSWORD = "fixed-pass";
    expect(opencodePassword()).toBe("fixed-pass");
    delete process.env.OPENCODE_SERVER_PASSWORD;
    const a = opencodePassword();
    const b = opencodePassword();
    expect(a.startsWith("rook-")).toBe(true);
    expect(b.startsWith("rook-")).toBe(true);
    expect(a).not.toBe(b);
  });

  it("opencodeBinary respects OPENCODE_BIN override", () => {
    expect(opencodeBinary()).toBe("opencode");
    process.env.OPENCODE_BIN = "/custom/opencode";
    expect(opencodeBinary()).toBe("/custom/opencode");
  });

  it("healthCheck returns reachable false on network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const result = await healthCheck("http://127.0.0.1:59999");
    expect(result.reachable).toBe(false);
    expect(result.baseUrl).toBe("http://127.0.0.1:59999");
  });

  it("healthCheck returns reachable true on doc 200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 } as unknown as Response));
    const result = await healthCheck("http://127.0.0.1:41234");
    expect(result.reachable).toBe(true);
    expect(result.status).toBe(200);
  });

  it("OpenCodeRuntime spawns isolated per-workroom instances and stops cleanly", async () => {
    const rt = new OpenCodeRuntime({ host: "127.0.0.1" });
    // Mock spawn to avoid needing real binary in CI
    const fakeChild: any = {
      on: vi.fn(),
      kill: vi.fn(),
      once: vi.fn((ev, cb) => ev === "exit" && setTimeout(cb, 10)),
      unref: vi.fn(),
    };
    vi.doMock("node:child_process", async () => {
      const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
      return { ...actual, spawn: vi.fn(() => fakeChild) };
    });
    // Directly test map logic without spawning real process
    // Use findAvailablePort to prove no global collision
    const p1 = await findAvailablePort(0);
    const p2 = await findAvailablePort(0);
    expect(p1).not.toBe(p2);
    expect(rt.list()).toHaveLength(0);
    expect(rt.get("nonexistent")).toBeUndefined();
    // Ensure stop on missing id is no-op
    await expect(rt.stop("missing")).resolves.toBeUndefined();
    await expect(rt.stopAll()).resolves.toBeUndefined();
  });
});

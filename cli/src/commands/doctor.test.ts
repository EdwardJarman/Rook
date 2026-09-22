import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderDoctor, runDoctor } from "./doctor.js";
import type { CliProfile } from "../config.js";

let server: Server | undefined;

afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
    server = undefined;
  });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const profile: CliProfile = { apiUrl: "http://127.0.0.1:1", token: null };

const healthy = async (): Promise<string> =>
  new Promise((resolve) => {
    server = createServer((req, res) => {
      void req;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    }).listen(0, "127.0.0.1", () => {
      const port = (server!.address() as { port: number }).port;
      resolve(`http://127.0.0.1:${port}`);
    });
  });

describe("doctor", () => {
  it("reports every check honestly with injected deps", async () => {
    const checks = await runDoctor(profile, {
      probe: async () => true,
      me: async () => ({ name: "Ada", email: "ada@x.io" }),
      models: async () => [{ id: "openrouter/free" }, { id: "opencode:big-pickle" }],
    });
    expect(checks.map((check) => check.name)).toEqual([
      "Server",
      "Auth",
      "Models",
      "Config",
      "Terminal",
    ]);
    expect(checks.every((check) => check.ok)).toBe(true);
    expect(checks[2]?.detail).toContain("2 models");
  });

  it("degrades to rows instead of throwing when everything is down", async () => {
    const checks = await runDoctor(profile, {
      probe: async () => false,
      me: async () => null,
      models: async () => {
        throw new Error("kaput");
      },
    });
    expect(checks[0]).toMatchObject({ name: "Server", ok: false });
    expect(checks[1]?.detail).toContain("rook login");
    expect(checks[2]?.ok).toBe(false);
    // Config + terminal still report.
    expect(checks[3]?.ok).toBe(true);
  });

  it("probes a live server through the default path", async () => {
    const apiUrl = await healthy();
    const checks = await runDoctor(
      { apiUrl, token: null },
      { me: async () => null, models: async () => [] },
    );
    expect(checks[0]).toMatchObject({ name: "Server", ok: true });
  });

  it("renders a box and JSON", async () => {
    const checks = await runDoctor(profile, {
      probe: async () => true,
      me: async () => null,
      models: async () => [{ id: "x" }],
    });
    const text = renderDoctor(checks, false);
    expect(text).toContain("Doctor");
    expect(text).toContain("Server");
    const parsed = JSON.parse(renderDoctor(checks, true)) as Array<{ name: string }>;
    expect(parsed.map((check) => check.name)).toContain("Terminal");
  });
});

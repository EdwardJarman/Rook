import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import superjson from "superjson";

import {
  cliAuthPageUrl,
  defaultApiUrl,
  fetchMe,
  listenForCallback,
  loginWithBrowser,
  loginWithToken,
  logout,
  webUrlFor,
} from "./auth.js";

let server: Server | undefined;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("ROOK_CONFIG_DIR", `${process.cwd()}/node_modules/.cache/rook-cli-test`);
});

afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
    server = undefined;
  });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const trpcOk = (data: unknown) =>
  JSON.stringify([{ result: { data: superjson.serialize(data) } }]);

const stubApi = async (
  me: unknown,
): Promise<string> =>
  new Promise((resolve) => {
    server = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(trpcOk(me));
    }).listen(0, "127.0.0.1", () => {
      resolve(`http://127.0.0.1:${(server!.address() as { port: number }).port}`);
    });
  });

describe("login plumbing", () => {
  it("derives the approval-page origin sanely", () => {
    expect(webUrlFor("http://localhost:3000")).toBe("http://localhost:8081");
    expect(webUrlFor("http://127.0.0.1:3000")).toBe("http://127.0.0.1:8081");
    expect(webUrlFor("https://api.example.com")).toBe("https://api.example.com");
    expect(webUrlFor("https://api.example.com", "https://web.example.com/")).toBe(
      "https://web.example.com",
    );
    expect(cliAuthPageUrl("http://localhost:8081/", 1234, "k e y")).toBe(
      "http://localhost:8081/cli-auth?port=1234&key=k%20e%20y",
    );
    expect(defaultApiUrl("https://x.example.com")).toBe("https://x.example.com");
  });

  it("accepts a well-formed callback and rejects impostors", async () => {
    const listener = await listenForCallback(5_000);
    try {
      const good = fetch(listenerUrl(listener.port), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "k", token: "rook_x", apiUrl: "http://a" }),
      }).then((r) => r.status);
      const bad = fetch(listenerUrl(listener.port), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "k", token: "nope", apiUrl: "http://a" }),
      }).then((r) => r.status);
      expect(await good).toBe(200);
      expect(await bad).toBe(400);
      await expect(listener.wait).resolves.toEqual({ key: "k", token: "rook_x", apiUrl: "http://a" });
    } finally {
      listener.close();
    }
  });

  it("logs in with a token after verifying it", async () => {
    const apiUrl = await stubApi({ id: "user-1", name: "Ada", email: null });
    const { me, profile } = await loginWithToken(apiUrl, "rook_test");
    expect(me).toEqual({ id: "user-1", name: "Ada", email: null });
    expect(profile).toEqual({ apiUrl, token: "rook_test" });
  });

  it("refuses to save rejected tokens", async () => {
    const apiUrl = await stubApi(null);
    await expect(loginWithToken(apiUrl, "rook_bad")).rejects.toThrow(/rejected/);
  });

  it("completes the browser flow end to end", async () => {
    const apiUrl = await stubApi({ id: "user-9", name: null, email: "a@b.c" });
    let opened = "";
    const pending = loginWithBrowser(apiUrl, {
      webUrl: "http://web.invalid",
      open: (url) => {
        opened = url;
      },
      key: "fixed-key",
      timeoutMs: 10_000,
    });
    // Play the browser: wait for the open call, parse the manual URL,
    // and POST the approval back.
    for (let i = 0; i < 200 && !opened; i += 1) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(opened).toContain("/cli-auth?port=");
    const manual = new URL(opened);
    expect(manual.pathname).toBe("/cli-auth");
    const port = Number(manual.searchParams.get("port"));
    await fetch(`http://127.0.0.1:${port}/callback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "fixed-key", token: "rook_browser", apiUrl }),
    });
    const { me, profile } = await pending;
    expect(opened.startsWith("http://web.invalid/cli-auth?port=")).toBe(true);
    expect(me?.id).toBe("user-9");
    expect(profile.token).toBe("rook_browser");
  });

  it("fetchMe maps auth failure to signed-out", async () => {
    expect(await fetchMe({ apiUrl: "http://x.invalid", token: null })).toBeNull();
  });

  it("logout only touches local state", () => {
    logout();
  });
});

const listenerUrl = (port: number): string => `http://127.0.0.1:${port}/callback`;

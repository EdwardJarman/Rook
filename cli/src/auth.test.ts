import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import superjson from "superjson";

import {
  cliAuthPageUrl,
  defaultApiUrl,
  fetchMe,
  loginWithDevice,
  loginWithToken,
  logout,
  resolveServerUrl,
  webUrlFor,
} from "./auth.js";
import { DEFAULT_API_URL } from "./config.js";

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

const trpcErr = (message: string, code: string) =>
  JSON.stringify([{ error: { message, data: { code, httpStatus: 404 } } }]);

/** Stub API that routes by procedure path; poll replies follow a script. */
const stubDeviceApi = async (
  opts: {
    me: unknown;
    polls: unknown[];
    challenge?: unknown;
    challengeError?: { message: string; code: string };
  },
  seen?: Record<string, string>,
): Promise<string> =>
  new Promise((resolve) => {
    let pollCalls = 0;
    server = createServer((req, res) => {
      const proc = req.url?.includes("auth.deviceChallenge")
        ? "challenge"
        : req.url?.includes("auth.devicePoll")
          ? "poll"
          : "me";
      if (seen) seen[proc] = req.method ?? "";
      if (seen) seen[`${proc}:connection`] = String(req.headers.connection ?? "");
      res.writeHead(200, { "Content-Type": "application/json" });
      if (req.url?.includes("auth.deviceChallenge")) {
        res.end(
          opts.challengeError
            ? trpcErr(opts.challengeError.message, opts.challengeError.code)
            : trpcOk(opts.challenge ?? { code: "ABCD-1234", expiresInSec: 600 }),
        );
      } else if (req.url?.includes("auth.devicePoll")) {
        const reply = opts.polls[Math.min(pollCalls, opts.polls.length - 1)];
        pollCalls += 1;
        res.end(trpcOk(reply));
      } else {
        res.end(trpcOk(opts.me));
      }
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
    // The approval page lives on the API origin (/api/cli-auth), same origin
    // as the tRPC calls â€” not the Expo SPA's /cli-auth route.
    expect(cliAuthPageUrl("http://localhost:3000/", "AB CD")).toBe(
      "http://localhost:3000/api/cli-auth?code=AB%20CD",
    );
    expect(defaultApiUrl("https://x.example.com")).toBe("https://x.example.com");
  });

  it("logs in with a token after verifying it", async () => {
    const apiUrl = await stubDeviceApi({ me: { id: "user-1", name: "Ada", email: null }, polls: [] });
    const { me, profile } = await loginWithToken(apiUrl, "rook_test");
    expect(me).toEqual({ id: "user-1", name: "Ada", email: null });
    expect(profile).toEqual({ apiUrl, token: "rook_test" });
  });

  it("refuses to save rejected tokens", async () => {
    const apiUrl = await stubDeviceApi({ me: null, polls: [] });
    await expect(loginWithToken(apiUrl, "rook_bad")).rejects.toThrow(/rejected/);
  });

  it("completes the device flow end to end", async () => {
    const seen: Record<string, string> = {};
    const apiUrl = await stubDeviceApi(
      {
        me: { id: "user-9", name: null, email: "a@b.c" },
        polls: [
          { status: "pending" },
          { status: "approved", token: "rook_device", expiresAt: new Date().toISOString() },
        ],
      },
      seen,
    );
    let opened = "";
    let reported: { code: string; url: string } | undefined;
    const { me, profile, manualUrl } = await loginWithDevice(apiUrl, {
      webUrl: "http://web.invalid",
      open: (url) => {
        opened = url;
      },
      onCode: (code, url) => {
        reported = { code, url };
      },
      timeoutMs: 10_000,
      pollIntervalMs: 5,
    });
    // The terminal shows a human code and opens the matching approval page.
    expect(reported?.code).toBe("ABCD-1234");
    expect(opened).toBe("http://web.invalid/api/cli-auth?code=ABCD-1234");
    expect(manualUrl).toBe(opened);
    expect(reported?.url).toBe(opened);
    // Approval lands through polling; the token is verified before saving.
    expect(me?.id).toBe("user-9");
    expect(profile).toEqual({ apiUrl, token: "rook_device" });
    // Mutations POST; queries ride GET (the server 405s POSTed queries).
    expect(seen.challenge).toBe("POST");
    expect(seen.poll).toBe("GET");
    // No keep-alive: pooled sockets crash force-exit on Windows.
    expect(seen["challenge:connection"]).toBe("close");
    expect(seen["poll:connection"]).toBe("close");
  });

  it("rejects expired codes with a re-run hint", async () => {
    const apiUrl = await stubDeviceApi({
      me: { id: "user-9", name: null, email: null },
      polls: [{ status: "expired" }],
    });
    await expect(
      loginWithDevice(apiUrl, {
        open: () => {},
        timeoutMs: 10_000,
        pollIntervalMs: 5,
      }),
    ).rejects.toThrow(/expired/);
  });

  it("blames an outdated server instead of the network", async () => {
    const apiUrl = await stubDeviceApi({
      me: null,
      polls: [],
      challengeError: {
        message: 'No procedure found on path "auth.deviceChallenge"',
        code: "NOT_FOUND",
      },
    });
    await expect(loginWithDevice(apiUrl, { open: () => {} })).rejects.toThrow(/too old/);
  });

  it("fetchMe maps auth failure to signed-out", async () => {
    expect(await fetchMe({ apiUrl: "http://x.invalid", token: null })).toBeNull();
  });

  it("logout only touches local state", () => {
    logout();
  });

  describe("resolveServerUrl â€” the dead-localhost-pin recovery", () => {
    const probeOf = (ok: boolean): (() => Promise<boolean>) => async () => ok;

    it("falls back to production when a pinned localhost is unreachable", async () => {
      await expect(resolveServerUrl("http://localhost:3000", { probe: probeOf(false) })).resolves.toEqual({
        apiUrl: DEFAULT_API_URL,
        fellBackFrom: "http://localhost:3000",
      });
      await expect(resolveServerUrl("http://127.0.0.1:3000", { probe: probeOf(false) })).resolves.toEqual({
        apiUrl: DEFAULT_API_URL,
        fellBackFrom: "http://127.0.0.1:3000",
      });
    });

    it("keeps a live localhost and never questions explicit or remote targets", async () => {
      await expect(resolveServerUrl("http://localhost:3000", { probe: probeOf(true) })).resolves.toEqual({
        apiUrl: "http://localhost:3000",
      });
      // Explicit flags and ROOK_API_URL are honored without a probe.
      await expect(
        resolveServerUrl("http://localhost:9999", { explicit: true, probe: probeOf(false) }),
      ).resolves.toEqual({ apiUrl: "http://localhost:9999" });
      await expect(resolveServerUrl("https://api.example.com", { probe: probeOf(false) })).resolves.toEqual({
        apiUrl: "https://api.example.com",
      });
    });
  });
});

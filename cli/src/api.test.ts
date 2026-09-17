import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import superjson from "superjson";

import { ApiError, streamAgentRound, trpc } from "./api.js";
import type { CliProfile } from "./config.js";

let server: Server | undefined;

afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
    server = undefined;
  });
  vi.restoreAllMocks();
});

const profile: CliProfile = { apiUrl: "", token: "rook_test" };

const listen = async (
  handler: (req: { method?: string; url?: string; body: string; auth: string | undefined }) => {
    status: number;
    response: string;
  },
): Promise<string> =>
  new Promise((resolve) => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        const { status, response } = handler({
          method: req.method,
          url: req.url,
          body,
          auth: req.headers.authorization,
        });
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(response);
      });
    }).listen(0, "127.0.0.1", () => {
      const port = (server!.address() as { port: number }).port;
      resolve(`http://127.0.0.1:${port}`);
    });
  });

const trpcOk = (data: unknown) =>
  JSON.stringify([{ result: { data: superjson.serialize(data) } }]);

describe("trpc client", () => {
  it("gets batch-of-one queries with bearer and deserializes superjson", async () => {
    let seenAuth = "";
    let seenMethod = "";
    let seenUrl = "";
    const apiUrl = await listen(({ auth, body, method, url }) => {
      seenAuth = auth ?? "";
      seenMethod = method ?? "";
      seenUrl = url ?? "";
      void body;
      return { status: 200, response: trpcOk({ models: [{ id: "opencode:big-pickle" }] }) };
    });
    const data = await trpc<{ models: Array<{ id: string }> }>(
      { ...profile, apiUrl },
      "ai.models",
    );
    expect(data.models[0]?.id).toBe("opencode:big-pickle");
    expect(seenAuth).toBe("Bearer rook_test");
    expect(seenMethod).toBe("GET");
    expect(seenUrl).toContain("batch=1&input=");
  });

  it("posts mutations with a json body", async () => {
    let seenMethod = "";
    let seenBody = "";
    const apiUrl = await listen(({ method, body }) => {
      seenMethod = method ?? "";
      seenBody = body;
      return { status: 200, response: trpcOk({ text: "hi" }) };
    });
    const data = await trpc<{ text: string }>(
      { ...profile, apiUrl },
      "workroom.reply",
      { message: "hi" },
      { method: "POST" },
    );
    expect(data.text).toBe("hi");
    expect(seenMethod).toBe("POST");
    expect(JSON.parse(seenBody)).toEqual({ "0": { json: { message: "hi" } } });
  });

  it("turns auth failures into login guidance", async () => {
    const apiUrl = await listen(() => ({
      status: 200,
      response: JSON.stringify([
        { error: { message: "UNAUTHORIZED", data: { code: "UNAUTHORIZED" } } },
      ]),
    }));
    await expect(trpc({ ...profile, apiUrl }, "ai.models")).rejects.toThrow(/rook login/);
  });

  it("requires sign-in before dialing", async () => {
    await expect(trpc({ apiUrl: "http://x", token: null }, "ai.models")).rejects.toThrow(
      /rook login/,
    );
  });

  it("reports unreachable servers honestly", async () => {
    await expect(
      trpc({ ...profile, apiUrl: "http://127.0.0.1:1" }, "ai.models"),
    ).rejects.toThrow(/unreachable/);
  });

  it("fails loudly instead of hanging on wedged servers", async () => {
    const hanging: string = await new Promise((resolve) => {
      server = createServer((_req, res) => {
        // Accept and hold: headers only, body never ends.
        res.writeHead(200, { "Content-Type": "application/json" });
      }).listen(0, "127.0.0.1", () => {
        resolve(`http://127.0.0.1:${(server!.address() as { port: number }).port}`);
      });
    });
    await expect(
      trpc({ ...profile, apiUrl: hanging }, "ai.models", undefined, { timeoutMs: 300 }),
    ).rejects.toThrow(/took too long/);
  }, 15000);
});

describe("agent stream client", () => {
  it("forwards tokens and resolves on done", async () => {
    const apiUrl = await listen(() => ({
      status: 200,
      response: [
        'data: {"kind":"trace","step":{"kind":"context","title":"Read"}}',
        "",
        'data: {"kind":"token","delta":"Hello "}',
        "",
        'data: {"kind":"token","delta":"there."}',
        "",
        'data: {"kind":"done","result":{"text":"Hello there.","model":"m"}}',
        "",
      ].join("\n"),
    }));
    const deltas: string[] = [];
    const traces: string[] = [];
    const done = await streamAgentRound(
      { ...profile, apiUrl },
      { botId: "cli", message: "hi" },
      { onToken: (d) => deltas.push(d), onTrace: (s) => traces.push(s.title) },
    );
    expect(deltas.join("")).toBe("Hello there.");
    expect(traces).toEqual(["Read"]);
    expect(done.text).toBe("Hello there.");
  });

  it("surfaces mid-stream errors and cut streams", async () => {
    const failing = await listen(() => ({
      status: 200,
      response: 'data: {"kind":"error","message":"kaput"}\n\n',
    }));
    await expect(streamAgentRound({ ...profile, apiUrl: failing }, {})).rejects.toThrow("kaput");

    const cut = await listen(() => ({ status: 200, response: 'data: {"kind":"token"}\n\n' }));
    await expect(
      streamAgentRound({ ...profile, apiUrl: cut }, {}, { onToken: () => undefined }),
    ).rejects.toThrow(/before finishing/);
  });

  it("rejects unauthenticated streams with login guidance", async () => {
    const apiUrl = await listen(() => ({ status: 401, response: "{}" }));
    await expect(
      streamAgentRound({ ...profile, apiUrl }, {}),
    ).rejects.toThrow(/rook login/);
    // ApiError carries the status for programmatic use.
    const err = await streamAgentRound({ ...profile, apiUrl }, {}).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
  });
});

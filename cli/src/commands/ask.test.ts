import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import superjson from "superjson";

import { println } from "../output.js";
import { runAsk } from "./ask.js";
import type { CliProfile } from "../config.js";

vi.mock("../output.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../output.js")>();
  return { ...original, println: vi.fn() };
});

let server: Server | undefined;

afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
    server = undefined;
  });
  vi.restoreAllMocks();
});

const trpcOk = (data: unknown) =>
  JSON.stringify([{ result: { data: superjson.serialize(data) } }]);

const listen = async (response: string): Promise<string> =>
  new Promise((resolve) => {
    server = createServer((req, res) => {
      void req;
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        void body;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(response);
      });
    }).listen(0, "127.0.0.1", () => {
      const port = (server!.address() as { port: number }).port;
      resolve(`http://127.0.0.1:${port}`);
    });
  });

describe("ask --json envelope", () => {
  it("prints one JSON doc and never streams deltas to stdout", async () => {
    const apiUrl = await listen(trpcOk({ text: "hello there" }));
    const profile: CliProfile = { apiUrl, token: "rook_test" };
    const onToken = vi.fn();
    const result = await runAsk(profile, {
      message: "hi",
      model: "openrouter/free",
      json: true,
      onToken,
    });
    expect(result.text).toBe("hello there");
    expect(onToken).not.toHaveBeenCalled();
    expect(vi.mocked(println)).toHaveBeenCalledTimes(1);
    const doc = JSON.parse(vi.mocked(println).mock.calls[0]?.[0] ?? "") as {
      text: string;
      model: string;
      files: string[];
    };
    expect(doc).toEqual({ text: "hello there", model: "openrouter/free", files: [] });
  });
});

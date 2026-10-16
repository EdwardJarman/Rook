import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import {
  cliCallbackUrl,
  deliverCliApproval,
  isTerminalAlive,
  parseCallbackPort,
  postCliCallback,
  TerminalGoneError,
  TerminalRefusedError,
} from "./cli-auth";

let server: Server | undefined;

afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
    server = undefined;
  });
});

const listen = async (
  handler: (body: string) => { status: number; response: string },
): Promise<number> =>
  new Promise((resolve) => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        const { status, response } = handler(body);
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(response);
      });
    }).listen(0, "127.0.0.1", () => {
      resolve((server!.address() as { port: number }).port);
    });
  });

describe("cli device-login handshake", () => {
  it("builds the localhost callback url", () => {
    expect(cliCallbackUrl(4123)).toBe("http://127.0.0.1:4123/callback");
  });

  it("validates callback ports strictly", () => {
    expect(parseCallbackPort("4123")).toBe(4123);
    expect(parseCallbackPort(undefined)).toBeNull();
    expect(parseCallbackPort("abc")).toBeNull();
    expect(parseCallbackPort("0")).toBeNull();
    expect(parseCallbackPort("99999")).toBeNull();
    expect(parseCallbackPort(" 4123 ")).toBe(4123);
  });

  it("delivers the token payload the CLI waits for", async () => {
    let received = "";
    const port = await listen((body) => {
      received = body;
      return { status: 200, response: '{"ok":true}' };
    });
    await postCliCallback(port, { key: "csrf-1", token: "rook_x", apiUrl: "http://x:3000" });
    expect(JSON.parse(received)).toEqual({ key: "csrf-1", token: "rook_x", apiUrl: "http://x:3000" });
  });

  it("types gone vs refused terminals distinctly", async () => {
    const refusing = await listen(() => ({ status: 400, response: "{}" }));
    await expect(postCliCallback(refusing, { key: "k", token: "t", apiUrl: "u" })).rejects.toBeInstanceOf(
      TerminalRefusedError,
    );
  });

  it("retries a starting terminal, then delivers", async () => {
    let calls = 0;
    const post = async () => {
      calls += 1;
      if (calls < 3) throw new TerminalGoneError("gone");
    };
    await deliverCliApproval(1, { key: "k", token: "t", apiUrl: "u" }, { post, delayMs: 5 });
    expect(calls).toBe(3);
  });

  it("gives up after its attempts and never retries refusals", async () => {
    let gone = 0;
    await expect(
      deliverCliApproval(
        1,
        { key: "k", token: "t", apiUrl: "u" },
        {
          attempts: 2,
          delayMs: 5,
          post: async () => {
            gone += 1;
            throw new TerminalGoneError("gone");
          },
        },
      ),
    ).rejects.toBeInstanceOf(TerminalGoneError);
    expect(gone).toBe(2);

    let refused = 0;
    await expect(
      deliverCliApproval(
        1,
        { key: "k", token: "t", apiUrl: "u" },
        {
          post: async () => {
            refused += 1;
            throw new TerminalRefusedError("no");
          },
        },
      ),
    ).rejects.toBeInstanceOf(TerminalRefusedError);
    expect(refused).toBe(1);
  });

  it("senses terminal liveness without caring about status", async () => {
    const alive = await listen(() => ({ status: 404, response: "{}" }));
    await expect(isTerminalAlive(alive)).resolves.toBe(true);
    await expect(isTerminalAlive(1, 300)).resolves.toBe(false);
  });

  it("explains refusal and disappearance honestly", async () => {
    const refusing = await listen(() => ({ status: 400, response: "{}" }));
    await expect(postCliCallback(refusing, { key: "k", token: "t", apiUrl: "u" })).rejects.toThrow(
      /fresh code/,
    );
    await expect(
      postCliCallback(1, { key: "k", token: "t", apiUrl: "u" }, 500),
    ).rejects.toThrow(/not listening/);
    await expect(postCliCallback(1, { key: "", token: "", apiUrl: "u" })).rejects.toThrow(
      /came back empty/,
    );
  });
});

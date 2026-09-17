import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { cliCallbackUrl, parseCallbackPort, postCliCallback } from "./cli-auth";

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

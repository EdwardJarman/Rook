/**
 * Desktop pairing: local Connect Account panel → authenticated Rook web request
 * → user-entered code → stored identity → immediate onPaired hook.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

import { defaultConfig } from "../src/config.js";
import { RookNode } from "../src/core/node.js";
import { Gateway } from "../src/gateway/server.js";

let relay: http.Server;
let relayUrl = "";
let gateway: Gateway;
let baseUrl = "";
let tmp = "";
let node: RookNode;
const onPaired = vi.fn();

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rook-pair-"));
  relay = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      if (req.url?.endsWith("/api/node/desktop-pairing/start")) {
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ requestId: "rkd-" + "a".repeat(48), expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() }));
        return;
      }
      if (req.url?.endsWith("/api/node/desktop-pairing/complete")) {
        const parsed = JSON.parse(body || "{}");
        if (parsed.requestId !== "rkd-" + "a".repeat(48) || parsed.code !== "ABCDEFGH") {
          res.writeHead(401).end(JSON.stringify({ error: "bad code" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ nodeId: "node-paired-1", nodeSecret: "rks-secret", userId: "user-1" }));
        return;
      }
      if (req.url?.endsWith("/api/node/pair")) {
        const parsed = JSON.parse(body || "{}");
        if (parsed.pairingToken !== "rkp-good") {
          res.writeHead(401).end(JSON.stringify({ error: "bad token" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ nodeId: "node-legacy-1", nodeSecret: "rks-legacy", userId: "user-1" }));
        return;
      }
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve) => relay.listen(0, "127.0.0.1", resolve));
  relayUrl = `http://127.0.0.1:${(relay.address() as AddressInfo).port}`;

  const config = defaultConfig({
    dataHome: path.join(tmp, "data"),
    workspaceRoot: path.join(tmp, "data", "Rook"),
    requireAuth: false,
    noLaunch: true,
    serverUrl: relayUrl,
    gatewayPort: 0,
  });
  node = new RookNode(config, {});
  node.db.ensureNodeIdentity({ nodeId: "node-local", deviceKeyId: "rkdev-1", createdAt: new Date().toISOString() });
  gateway = new Gateway(config, node, { onPaired });
  await gateway.listen();
  baseUrl = `http://127.0.0.1:${gateway.address().port}`;
});

afterAll(async () => {
  await gateway.close();
  await new Promise<void>((resolve) => relay.close(() => resolve()));
  try { node.close(); } catch { /* already closed */ }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
});

async function get(pathAndQuery: string): Promise<{ status: number; body: string; headers: Headers }> {
  const response = await fetch(new URL(pathAndQuery, baseUrl));
  return { status: response.status, body: await response.text(), headers: response.headers };
}

async function postForm(pathname: string, form: Record<string, string>): Promise<{ status: number; body: string }> {
  const response = await fetch(new URL(pathname, baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  return { status: response.status, body: await response.text() };
}

describe("desktop one-time-code pairing", () => {
  it("serves a compact Connect Account page with no loopback callback or secret", async () => {
    const { status, body } = await get("/connect");
    expect(status).toBe(200);
    expect(body).toContain("Connect account");
    expect(body).toContain("One-time code");
    expect(body).toContain("/connect-node?request=rkd-");
    expect(body).not.toContain("port=");
    expect(body).not.toContain("rkp-");
  });

  it("rejects a malformed legacy callback without affecting the code flow", async () => {
    expect((await get("/pair?state=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).status).toBe(400);
  });

  it("exchanges a pasted code, persists the cloud identity, and fires onPaired", async () => {
    const connectPage = await get("/connect");
    const session = connectPage.body.match(/name="session" value="([a-f0-9]+)"/)?.[1];
    expect(session).toBeDefined();

    const { status, body } = await postForm("/connect", { session: session!, code: "ABCD-EFGH" });
    expect(status).toBe(200);
    expect(body).toContain("connected");
    const identity = node.db.getCloudIdentity();
    expect(identity).toMatchObject({ nodeId: "node-paired-1", nodeSecret: "rks-secret", userId: "user-1" });
    expect(onPaired).toHaveBeenCalledWith(expect.objectContaining({ nodeId: "node-paired-1" }));
  });

  it("keeps a rejected code recoverable but burns the local session after success", async () => {
    const connectPage = await get("/connect");
    const session = connectPage.body.match(/name="session" value="([a-f0-9]+)"/)?.[1];
    expect(session).toBeDefined();
    expect((await postForm("/connect", { session: session!, code: "AAAA-AAAA" })).status).toBe(401);
    expect((await postForm("/connect", { session: session!, code: "ABCD-EFGH" })).status).toBe(200);
    expect((await postForm("/connect", { session: session!, code: "ABCD-EFGH" })).status).toBe(400);
  });

  it("reports health including paired status", async () => {
    const { status, body } = await get("/healthz");
    expect(status).toBe(200);
    expect(JSON.parse(body)).toMatchObject({ ok: true, paired: true });
  });

  it("exposes healthz with CORS headers so the shell window can poll it directly", async () => {
    const { status, body, headers } = await get("/healthz");
    expect(status).toBe(200);
    expect(JSON.parse(body)).toMatchObject({ ok: true, paired: true });
    expect(headers.get("access-control-allow-origin")).toBe("*");
    expect(headers.get("cache-control")).toBe("no-store");
  });
});

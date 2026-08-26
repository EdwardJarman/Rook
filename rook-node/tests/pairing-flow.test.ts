/**
 * Browser pairing flow: local connect page → web mint → loopback callback →
 * stored identity → onPaired hook. Uses a fake relay server, no InstantDB.
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
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      if (req.url?.endsWith("/api/node/pair")) {
        const parsed = JSON.parse(body || "{}");
        if (parsed.pairingToken !== "rkp-good") {
          res.writeHead(401).end(JSON.stringify({ error: "bad token" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ nodeId: "node-paired-1", nodeSecret: "rks-secret", userId: "user-1" }));
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
  try {
    node.close();
  } catch {
    // Already closed.
  }
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    // Best effort cleanup.
  }
});

async function get(pathAndQuery: string): Promise<{ status: number; body: string; headers: Headers }> {
  const response = await fetch(new URL(pathAndQuery, baseUrl));
  return { status: response.status, body: await response.text(), headers: response.headers };
}

describe("browser pairing", () => {
  it("serves a connect page that links to the web app with a fresh state", async () => {
    const { status, body } = await get("/connect");
    expect(status).toBe(200);
    expect(body).toContain("/connect-node?");
    const match = body.match(/state=([a-f0-9]{48})/);
    expect(match).not.toBeNull();
    expect(body).toContain(`port=${gateway.address().port}`);
    expect(body).toContain("Connect account");
  });

  it("rejects pair callbacks with an unknown state", async () => {
    const { status } = await get("/pair?token=rkp-good&state=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(status).toBe(400);
    expect(onPaired).not.toHaveBeenCalled();
  });

  it("rejects malformed callbacks outright", async () => {
    expect((await get("/pair?state=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).status).toBe(400);
    expect((await get("/pair?token=nope&state=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).status).toBe(400);
  });

  it("completes the handshake: valid state + token stores the identity and fires onPaired", async () => {
    const connectPage = await get("/connect");
    const state = connectPage.body.match(/state=([a-f0-9]{48})/)?.[1];
    expect(state).toBeDefined();

    const { status, body } = await get(`/pair?token=rkp-good&state=${state}`);
    expect(status).toBe(200);
    expect(body).toContain("connected");

    const identity = node.db.getCloudIdentity();
    expect(identity?.nodeId).toBe("node-paired-1");
    expect(identity?.nodeSecret).toBe("rks-secret");
    expect(identity?.userId).toBe("user-1");
    expect(onPaired).toHaveBeenCalledTimes(1);
    expect(onPaired.mock.calls[0][0].nodeId).toBe("node-paired-1");
  });

  it("burns the state after a successful handshake (single use)", async () => {
    const connectPage = await get("/connect");
    const state = connectPage.body.match(/state=([a-f0-9]{48})/)?.[1];
    const first = await get(`/pair?token=rkp-good&state=${state}`);
    expect(first.status).toBe(200);
    const second = await get(`/pair?token=rkp-good&state=${state}`);
    expect(second.status).toBe(400);
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

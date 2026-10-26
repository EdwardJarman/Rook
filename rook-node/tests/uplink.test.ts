/**
 * Uplink integration tests against an in-process fake relay server.
 * Exercises pair → sync → dispatch → report-back end to end without InstantDB.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

import { defaultConfig } from "../src/config.js";
import { RookNode } from "../src/core/node.js";
import { pairWithServer, UplinkClient } from "../src/uplink/uplink.js";

let server: http.Server;
let baseUrl = "";
const receivedResults: Array<Record<string, unknown>> = [];
const commandQueue: Array<Record<string, unknown>> = [];

let tmp = "";
let node: RookNode;

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rook-uplink-"));
  const config = defaultConfig({
    dataHome: path.join(tmp, "data"),
    workspaceRoot: path.join(tmp, "data", "Rook"),
    requireAuth: false,
    noLaunch: true,
  });
  node = new RookNode(config, {});
  node.db.ensureNodeIdentity({ nodeId: "node-local", deviceKeyId: "rkdev-1", createdAt: new Date().toISOString() });

  // A registered Bot + primary tab so protocol revision checks pass.
  node.registry.registerBot({ id: "bot-1", name: "Scout", role: "helper", identity: "shared" });
  const tab = node.registry.createPrimaryTab("bot-1", "about:blank");

  commandQueue.push({
    commandId: "cmd-read-url",
    envelope: {
      version: 1,
      deviceId: "cloud",
      userId: "user-1",
      botId: "bot-1",
      pageId: tab.id,
      seq: 1,
      nonce: `n-${Math.random()}`,
      issuedAt: Date.now(),
      deadline: Date.now() + 60_000,
      pageRevision: tab.revision,
      capability: "read",
      action: { type: "readUrl" },
    },
  });

  server = http.createServer((req, res) => {
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
        res.end(JSON.stringify({ nodeId: "node-cloud-1", nodeSecret: "rks-secret", userId: "user-1" }));
        return;
      }
      if (req.url?.endsWith("/api/node/sync")) {
        const auth = String(req.headers.authorization ?? "");
        if (!auth.startsWith("Bearer node-cloud-1:rks-secret")) {
          res.writeHead(401).end();
          return;
        }
        receivedResults.push(...(JSON.parse(body || "{}").results ?? []));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ commands: commandQueue.splice(0, commandQueue.length), pollAfterMs: 250 }));
        return;
      }
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
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

describe("uplink", () => {
  it("pairs with the server using a one-time token and persists the credential", async () => {
    const identity = await pairWithServer({
      serverUrl: baseUrl,
      pairingToken: "rkp-good",
      name: "test-node",
      version: "0.1.0",
    });
    expect(identity.nodeId).toBe("node-cloud-1");
    expect(identity.userId).toBe("user-1");
    expect(identity.nodeSecret).toBe("rks-secret");

    node.db.saveCloudIdentity(identity);
    expect(node.db.getCloudIdentity()?.nodeId).toBe("node-cloud-1");

    await expect(
      pairWithServer({ serverUrl: baseUrl, pairingToken: "rkp-bad", name: "x", version: "0.1.0" }),
    ).rejects.toThrow(/Pairing failed \(401\)/);
  });

  it("claims queued commands, executes them through dispatch(), and reports results back", async () => {
    const identity = node.db.getCloudIdentity()!;
    const client = new UplinkClient(node, identity);

    // Tick 1 claims and executes; tick 2 flushes the result reports.
    const pollAfter = await client.tick();
    await client.tick();
    expect(pollAfter).toBeGreaterThan(0);

    const report = receivedResults.find((entry) => entry.commandId === "cmd-read-url");
    expect(report).toBeDefined();
    expect(report?.ok).toBe(true);
  });

  it("rejects replayed commands on a second delivery of the same seq", async () => {
    // newTab is a mutating action: the Bot must hold its lease.
    node.leases.giveToBot("bot-1");
    const identity = node.db.getCloudIdentity()!;
    const client = new UplinkClient(node, identity);
    commandQueue.push({
      commandId: "cmd-replay",
      envelope: {
        version: 1,
        deviceId: "cloud",
        userId: "user-1",
        botId: "bot-1",
        pageId: "whatever",
        seq: 999_999,
        nonce: "replay-nonce",
        issuedAt: Date.now(),
        deadline: Date.now() + 60_000,
        pageRevision: 1,
        capability: "navigate",
        action: { type: "newTab", url: "https://example.com" },
      },
    });
    await client.tick();
    await client.tick();

    const firstReport = receivedResults.find((entry) => entry.commandId === "cmd-replay");
        expect(firstReport?.ok).toBe(true);

    // Same seq again → REPLAYED by the node's own protection.
    commandQueue.push({
      commandId: "cmd-replay-2",
      envelope: {
        version: 1,
        deviceId: "cloud",
        userId: "user-1",
        botId: "bot-1",
        pageId: "whatever",
        seq: 999_999,
        nonce: "replay-nonce-2",
        issuedAt: Date.now(),
        deadline: Date.now() + 60_000,
        pageRevision: 1,
        capability: "navigate",
        action: { type: "newTab", url: "https://example.com" },
      },
    });
    await client.tick();
    await client.tick();
    const second = receivedResults.filter((entry) => entry.commandId === "cmd-replay-2")[0];
    expect(second?.ok).toBe(false);
    expect(second?.code).toBe("REPLAYED");
  });
});

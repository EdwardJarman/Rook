import express from "express";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { registerNodeRelayRoutes, type NodeRelayStore } from "../server/node-relay-routes";

const REQUEST_ID = `rkd-${"a".repeat(48)}`;
let server: http.Server;
let baseUrl = "";
let consumed = false;
const createNode = vi.fn();

const store: NodeRelayStore = {
  consumePairingToken: async () => undefined,
  markPairingTokenUsed: async () => undefined,
  createDesktopPairingRequest: async () => ({ requestId: REQUEST_ID, expiresAt: new Date(Date.now() + 60_000) }),
  consumeDesktopPairingCode: async ({ requestId, code, nodeId, secretHash }) => {
    if (consumed || requestId !== REQUEST_ID || code !== "ABCDEFGH") return undefined;
    consumed = true;
    expect(nodeId).toMatch(/^node-/);
    expect(secretHash).toMatch(/^[a-f0-9]{64}$/);
    createNode({ nodeId, userId: "user-existing", name: "Laptop", version: "0.1.0", secretHash });
    return { userId: "user-existing", name: "Laptop", version: "0.1.0" };
  },
  createRookNode: async () => undefined,
  getRookNode: async () => undefined,
  touchRookNode: async () => undefined,
  completeNodeCommand: async () => undefined,
  takePendingNodeCommands: async () => [],
};

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerNodeRelayRoutes(app, store);
  server = await new Promise<http.Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function post(path: string, body: unknown) {
  const response = await fetch(new URL(path, baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

describe("desktop pairing relay routes", () => {
  it("creates an opaque request without returning a pairing token", async () => {
    const result = await post("/api/node/desktop-pairing/start", { name: "Laptop", version: "0.1.0" });
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ requestId: REQUEST_ID });
    expect(JSON.stringify(result.body)).not.toContain("rkp-");
  });

  it("rejects malformed code bodies before credential creation", async () => {
    const result = await post("/api/node/desktop-pairing/complete", { requestId: REQUEST_ID, code: "bad", name: "Laptop", version: "0.1.0" });
    expect(result.status).toBe(400);
    expect(createNode).not.toHaveBeenCalled();
  });

  it("exchanges a normalized code exactly once for a durable credential", async () => {
    const first = await post("/api/node/desktop-pairing/complete", { requestId: REQUEST_ID, code: "abcd-efgh", name: "Laptop", version: "0.1.0" });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ nodeSecret: expect.stringMatching(/^rks-/), userId: "user-existing" });
    expect(createNode).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-existing", name: "Laptop", version: "0.1.0" }));

    const replay = await post("/api/node/desktop-pairing/complete", { requestId: REQUEST_ID, code: "ABCD-EFGH", name: "Laptop", version: "0.1.0" });
    expect(replay.status).toBe(401);
  });
});

/**
 * Loopback HTTP surface for the Computer panel's takeover banner:
 * GET /api/leases, POST /api/take-over, POST /api/release.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

import { defaultConfig } from "../src/config.js";
import { RookNode } from "../src/core/node.js";
import { Gateway } from "../src/gateway/server.js";

let gateway: Gateway;
let baseUrl = "";
let tmp = "";
let node: RookNode;

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rook-leases-"));
  const config = defaultConfig({
    dataHome: path.join(tmp, "data"),
    workspaceRoot: path.join(tmp, "data", "Rook"),
    requireAuth: false,
    noLaunch: true,
    gatewayPort: 0,
  });
  node = new RookNode(config, {});
  gateway = new Gateway(config, node, {});
  await gateway.listen();
  baseUrl = `http://127.0.0.1:${gateway.address().port}`;
});

afterAll(async () => {
  await gateway.close();
  try { node.close(); } catch { /* already closed */ }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
});

async function get(pathname: string) {
  const response = await fetch(new URL(pathname, baseUrl));
  return { status: response.status, body: await response.json() as any };
}

async function postForm(pathname: string, form: Record<string, string>) {
  const response = await fetch(new URL(pathname, baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  return { status: response.status, body: await response.json() as any };
}

describe("computer panel takeover endpoints", () => {
  it("starts with no leases", async () => {
    const { status, body } = await get("/api/leases");
    expect(status).toBe(200);
    expect(body.leases).toEqual([]);
  });

  it("reports a Bot's lease once it is working", async () => {
    node.leases.giveToBot("bot-1");
    const { body } = await get("/api/leases");
    expect(body.leases).toContainEqual(
      expect.objectContaining({ botId: "bot-1", state: "BOT" }),
    );
  });

  it("take-over pauses the Bot and hands control to the desktop shell", async () => {
    node.leases.giveToBot("bot-1");
    const { status, body } = await postForm("/api/take-over", { botId: "bot-1" });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.lease).toMatchObject({ botId: "bot-1", state: "HUMAN" });
    expect(node.leases.botHoldsControl("bot-1")).toBe(false);
  });

  it("release returns control to the Bot", async () => {
    node.leases.takeOver("bot-2", "desktop-shell");
    const { status, body } = await postForm("/api/release", { botId: "bot-2" });
    expect(status).toBe(200);
    expect(body.lease).toMatchObject({ botId: "bot-2", state: "BOT" });
    expect(node.leases.botHoldsControl("bot-2")).toBe(true);
  });

  it("rejects take-over and release without a botId", async () => {
    expect((await postForm("/api/take-over", {})).status).toBe(400);
    expect((await postForm("/api/release", {})).status).toBe(400);
  });
});

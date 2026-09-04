/**
 * Rook Node relay endpoints.
 *
 *   POST /api/node/pair  — exchange a one-time pairing token for a node credential.
 *   POST /api/node/sync  — authenticated poll loop: post results, claim commands.
 *
 * Handlers take injectable deps so the round-trip can be tested without
 * InstantDB. The node dials out; the server never opens connections inbound,
 * which keeps nodes reachable behind NAT and firewalls.
 */
import type { Request, Response } from "express";

import {
  DEFAULT_POLL_AFTER_MS,
  generateNodeId,
  parseUplinkAuth,
  validateDesktopPairingComplete,
  validateDesktopPairingStart,
  validatePairRequest,
  validateSyncRequest,
  verifyStoredSecret,
  type PairResponse,
  type QueuedRelayCommand,
} from "../shared/node-relay";

export interface NodeRelayStore {
  consumePairingToken(token: string): Promise<string | undefined>;
  markPairingTokenUsed(token: string, nodeId: string): Promise<void>;
  createDesktopPairingRequest(input: { name: string; version: string }): Promise<{ requestId: string; expiresAt: Date } | undefined>;
  consumeDesktopPairingCode(input: { requestId: string; code: string; nodeId: string; secretHash: string }): Promise<{ userId: string; name: string; version: string } | undefined>;
  createRookNode(input: { nodeId: string; userId: string; name: string; secretHash: string; version: string }): Promise<unknown>;
  getRookNode(nodeId: string): Promise<{ secretHash: string; status: string } | undefined>;
  touchRookNode(nodeId: string, version: string): Promise<void>;
  completeNodeCommand(commandId: string, report: { ok: boolean; result?: unknown; code?: string; message?: string }): Promise<void>;
  takePendingNodeCommands(nodeId: string): Promise<Array<Record<string, unknown>>>;
}

export function registerNodeRelayRoutes(app: import("express").Express, store: NodeRelayStore): void {
  app.post("/api/node/pair", (req, res) => {
    void handlePair(req, res, store);
  });
  app.post("/api/node/desktop-pairing/start", (req, res) => {
    void handleDesktopPairingStart(req, res, store);
  });
  app.post("/api/node/desktop-pairing/complete", (req, res) => {
    void handleDesktopPairingComplete(req, res, store);
  });
  app.post("/api/node/sync", (req, res) => {
    void handleSync(req, res, store);
  });
}

export async function handlePair(req: Request, res: Response, store: NodeRelayStore): Promise<void> {
  const input = validatePairRequest(req.body);
  if (!input) {
    res.status(400).json({ error: "Invalid pairing request." });
    return;
  }
  const userId = await store.consumePairingToken(input.pairingToken).catch(() => undefined);
  if (!userId) {
    res.status(401).json({ error: "This pairing code is invalid or has expired." });
    return;
  }
  const { generateNodeId, generateNodeSecret, hashToken } = await import("../shared/node-relay.js");
  const nodeId = generateNodeId();
  const nodeSecret = generateNodeSecret();
  await store.createRookNode({
    nodeId,
    userId,
    name: input.name,
    secretHash: hashToken(nodeSecret),
    version: input.version,
  });
  await store.markPairingTokenUsed(input.pairingToken, nodeId).catch(() => undefined);
  const body: PairResponse = { nodeId, nodeSecret, userId };
  res.json(body);
}

export async function handleDesktopPairingStart(req: Request, res: Response, store: NodeRelayStore): Promise<void> {
  const input = validateDesktopPairingStart(req.body);
  if (!input) {
    res.status(400).json({ error: "Invalid desktop pairing request." });
    return;
  }
  const request = await store.createDesktopPairingRequest(input).catch(() => undefined);
  if (!request) {
    res.status(503).json({ error: "Pairing is temporarily unavailable. Please try again." });
    return;
  }
  res.status(201).json({ requestId: request.requestId, expiresAt: request.expiresAt.toISOString() });
}

export async function handleDesktopPairingComplete(req: Request, res: Response, store: NodeRelayStore): Promise<void> {
  const input = validateDesktopPairingComplete(req.body);
  if (!input) {
    res.status(400).json({ error: "Enter the eight-character code shown on Rook." });
    return;
  }
  const nodeId = generateNodeId();
  const { generateNodeSecret, hashToken } = await import("../shared/node-relay.js");
  const nodeSecret = generateNodeSecret();
  const claim = await store.consumeDesktopPairingCode({
    requestId: input.requestId,
    code: input.code,
    nodeId,
    secretHash: hashToken(nodeSecret),
  }).catch(() => undefined);
  if (!claim) {
    res.status(401).json({ error: "This code is invalid, expired, or has already been used." });
    return;
  }
  const body: PairResponse = { nodeId, nodeSecret, userId: claim.userId };
  res.json(body);
}

export async function handleSync(req: Request, res: Response, store: NodeRelayStore): Promise<void> {
  const auth = parseUplinkAuth(req.headers.authorization);
  if (!auth) {
    res.status(401).json({ error: "Missing node credentials." });
    return;
  }
  const node = await store.getRookNode(auth.nodeId).catch(() => undefined);
  if (!node || node.status === "revoked") {
    res.status(401).json({ error: "Unknown node." });
    return;
  }
  if (!verifyStoredSecret(auth.secret, node.secretHash)) {
    res.status(401).json({ error: "Invalid node credential." });
    return;
  }
  const sync = validateSyncRequest(req.body);
  if (!sync) {
    res.status(400).json({ error: "Invalid sync payload." });
    return;
  }

  for (const report of sync.results.slice(0, 64)) {
    await store.completeNodeCommand(report.commandId, report).catch(() => undefined);
  }
  await store.touchRookNode(auth.nodeId, sync.version).catch(() => undefined);

  let commands: QueuedRelayCommand[] = [];
  try {
    commands = (await store.takePendingNodeCommands(auth.nodeId))
      .filter((row) => typeof row.commandId === "string" && typeof row.envelope === "object")
      .map((row) => ({
        commandId: String(row.commandId),
        envelope: row.envelope as Record<string, unknown>,
        approval: (row.approval ?? undefined) as QueuedRelayCommand["approval"],
      }));
  } catch {
    commands = [];
  }

  res.json({ commands, pollAfterMs: DEFAULT_POLL_AFTER_MS });
}

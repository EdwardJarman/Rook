/**
 * POST /api/agent/stream — Server-Sent Events for live agent replies.
 *
 * Same auth (Clerk Bearer) and same input shape as `trpc.workroom.reply`,
 * but the answer streams: `trace` / `token` / `approval` / `proposal`
 * events as they happen, then a final `done` event carrying the complete
 * turn result (identical shape to the tRPC reply, plus `streamed: true`).
 *
 * Clients must treat this as best-effort: any non-200, parse failure, or
 * mid-stream `error` event means "fall back to `workroom.reply`". The
 * reply mutation stays the supported contract; streaming is the fast path.
 */

import { z } from "zod";
import type { Express, Request, Response } from "express";

import { authenticateClerkRequest } from "./clerk-auth";
import { runRookAgentStream } from "./ai/agent-stream";
import { friendlyAgentError } from "./ai/agent-reliability";

const streamBodySchema = z.object({
  botId: z.string().min(1).max(128),
  taskId: z.string().min(1).max(128),
  botName: z.string().min(1).max(80),
  botRole: z.string().min(1).max(120),
  botPurpose: z.string().min(1).max(500),
  model: z.string().min(1).max(180).optional(),
  message: z.string().min(1).max(4000),
  userTimeZone: z.string().min(1).max(80).optional(),
  connectors: z.array(z.enum(["microsoft-excel", "github"])).max(4).optional(),
  skillIds: z.array(z.string().min(1).max(64)).max(6).optional(),
  botMemory: z.string().max(4000).optional(),
  reasoningEffort: z.enum(["low", "medium", "high"]).optional(),
  recentContext: z
    .array(
      z.object({
        author: z.enum(["user", "bot", "system"]),
        body: z.string().max(2000),
      }),
    )
    .max(8),
});

export function serializeStreamEvent(
  event:
    | { type: "trace"; step: unknown }
    | { type: "token"; delta: string }
    | { type: "approval"; approval: unknown }
    | { type: "proposal"; proposal: unknown },
): Record<string, unknown> {
  switch (event.type) {
    case "trace":
      return { kind: "trace", step: event.step };
    case "token":
      return { kind: "token", delta: event.delta };
    case "approval":
      return { kind: "approval", approval: event.approval };
    case "proposal":
      return { kind: "proposal", proposal: event.proposal };
  }
}

export function registerAgentStreamRoute(app: Express): void {
  app.post("/api/agent/stream", async (req: Request, res: Response) => {
    const user = await authenticateClerkRequest(req);
    if (!user) {
      res.status(401).json({ error: "Sign in to Rook before chatting." });
      return;
    }
    const parsed = streamBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "That chat request was malformed." });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    // Flush headers immediately so the client leaves its spinner fast.
    void (res as { flushHeaders?: () => void }).flushHeaders?.();

    const send = (payload: Record<string, unknown>): void => {
      if (!res.writableEnded && !res.destroyed) {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      }
    };

    const controller = new AbortController();
    req.on("close", () => controller.abort());

    try {
      const result = await runRookAgentStream(
        { userId: user.id, request: req, ...parsed.data },
        (event) => send(serializeStreamEvent(event)),
        controller.signal,
      );
      send({ kind: "done", result });
    } catch (error) {
      console.warn("[agent/stream] turn failed", {
        userId: user.id,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      send({ kind: "error", message: friendlyAgentError(error) });
    } finally {
      if (!res.writableEnded) res.end();
    }
  });
}

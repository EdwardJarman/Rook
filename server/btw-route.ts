import type { Express, Request, Response } from "express";
import { authenticateClerkRequest } from "./clerk-auth";
import { answerBtw, btwInputSchema } from "./ai/btw";
import type { BtwEvent } from "../shared/btw";

type Dependencies = { authenticate: typeof authenticateClerkRequest; answer: typeof answerBtw };
/** Separate endpoint and cancellation lifetime; it cannot stop a foreground/background job. */
export function registerBtwRoute(app: Express, deps: Dependencies = { authenticate: authenticateClerkRequest, answer: answerBtw }) {
  const inFlight = new Set<string>();
  app.post("/api/agent/btw", async (req: Request, res: Response) => {
    const user = await deps.authenticate(req).catch(() => null);
    if (!user) { res.status(401).json({ error: "Sign in to ask a side question." }); return; }
    const parsed = btwInputSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "That side question was malformed or too long." }); return; }
    if (inFlight.has(user.id)) { res.status(429).json({ error: "A side question is still answering. Try again in a moment." }); return; }
    inFlight.add(user.id);
    const controller = new AbortController();
    const disconnect = () => { if (!res.writableEnded) controller.abort(); };
    res.on("close", disconnect);
    const streaming = (req.headers.accept ?? "").includes("text/event-stream");
    const send = (event: BtwEvent) => {
      if (!res.destroyed && !res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    if (streaming) {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" });
      res.flushHeaders?.();
    }
    try {
      const result = await deps.answer({ ...parsed.data, userId: user.id },
        streaming ? (delta) => send({ kind: "token", delta }) : undefined, controller.signal);
      if (streaming) send({ kind: "done", result });
      else if (!res.destroyed) res.json(result);
    } catch {
      const message = controller.signal.aborted ? "Side question cancelled." : "The side answer couldn't finish. You can retry; your main work is unaffected.";
      if (streaming) send({ kind: "error", message });
      else if (!res.destroyed) res.status(502).json({ error: message });
    } finally {
      inFlight.delete(user.id);
      res.off("close", disconnect);
      if (!res.writableEnded) res.end();
    }
  });
}

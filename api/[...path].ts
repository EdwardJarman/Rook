/**
 * Vercel serverless function entry.
 *
 * Wraps the Rook Express app in a Vercel-compatible `(req, res)`
 * handler. Catches synchronous initialization errors so a transient
 * cold-start failure (e.g. a third-party SDK not yet ready) returns
 * a clean 500 with a useful log line instead of a FUNCTION_INVOCATION_FAILED
 * that gives the caller no signal.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
// `.js` extension is required under the ESM resolver that Vercel uses
// for this function (api/package.json sets "type": "module"). At build
// time Vercel strips the .ts and resolves the matching .js in the
// compiled output.
import { createApp } from "../server/_core/app.js";

let appInstance: ReturnType<typeof createApp> | null = null;
let appError: unknown = null;

try {
  appInstance = createApp();
} catch (error) {
  appError = error;
  // Surface the failure to Vercel's logs immediately.
  // eslint-disable-next-line no-console
  console.error("[api] failed to initialize Rook server:", error);
}

function fail(res: ServerResponse, status: number, message: string): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify({ ok: false, error: message }));
}

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  if (!appInstance) {
    fail(
      res,
      503,
      "Rook server is initializing. Please retry in a moment." +
        (appError instanceof Error ? ` (${appError.message})` : ""),
    );
    return;
  }
  // Express apps are themselves `(req, res, next?) => void` handlers.
  (appInstance as unknown as (req: IncomingMessage, res: ServerResponse) => void)(
    req,
    res,
  );
}

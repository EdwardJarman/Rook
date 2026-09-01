/**
 * Vercel serverless function entry.
 *
 * Imports the pre-bundled Rook server from dist-server/index.js. That
 * bundle is produced by `pnpm build` (esbuild --format=esm) in the
 * Vercel buildCommand before the static export runs, so the function
 * receives a single self-contained ESM file with no transitive
 * require()/import mismatches.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { createApp } from "../dist-server/index.js";

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

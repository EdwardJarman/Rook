import dotenv from "dotenv";
// Local-dev convention (Next.js-style): load `.env`, then let `.env.local`
// take precedence. `dotenv/config` alone only reads `.env`, which left the
// local dev server blind to `.env.local` secrets — every authenticated call
// 401'd despite a valid login. Missing files are a silent no-op; in
// production there are no such files, so deployed env vars are unaffected.
dotenv.config();
dotenv.config({ path: ".env.local", override: true });
import { createServer } from "node:http";
import net from "node:net";

import { createApp } from "./app";
import { startBackgroundRuntime } from "../background/service";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => server.close(() => resolve(true)));
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available port found starting at ${startPort}`);
}

async function startServer() {
  const preferredPort = Number.parseInt(process.env.PORT || "3000", 10);
  const port = await findAvailablePort(preferredPort);
  // Boot diagnostics: key NAMES only, never values. A missing secret here
  // is the classic "logged in but every call 401s" dev trap — this line
  // makes it visible in the first seconds of the server log.
  const present = (name: string) => (process.env[name]?.trim() ? "set" : "MISSING");
  console.log(
    `[env] CLERK_SECRET_KEY=${present("CLERK_SECRET_KEY")} ` +
      `INSTANT_APP_ADMIN_TOKEN=${present("INSTANT_APP_ADMIN_TOKEN")} ` +
      `OPENROUTER_API_KEY=${present("OPENROUTER_API_KEY")} ` +
      `ORCAROUTER_API_KEY=${present("ORCAROUTER_API_KEY")} ` +
      `TOKENROUTER_API_KEY=${present("TOKENROUTER_API_KEY")} ` +
      `OPENCODE_BASE_URL=${present("OPENCODE_BASE_URL")} ` +
      `ROOK_CLI_TOKEN_SECRET=${present("ROOK_CLI_TOKEN_SECRET")}`,
  );
  createServer(createApp()).listen(port, () => {
    console.log(`[api] server listening on port ${port}`);
    startBackgroundRuntime();
  });
}

startServer().catch(console.error);

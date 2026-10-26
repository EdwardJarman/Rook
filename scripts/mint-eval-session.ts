/* eslint-disable no-console */
/**
 * Mint a short-lived Clerk session JWT for the eval probe (operator machine only).
 * Usage: ROOK_EVAL_USER_EMAIL=you@x.io npx tsx scripts/mint-eval-session.ts
 * Prints ONLY the JWT to stdout (pipe it, never commit it). Needs CLERK_SECRET_KEY
 * in the environment and an ACTIVE Clerk session for the user.
 */
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve .env.local from this script's location, not the working directory,
// so token commands work from any cwd (evals, worktrees, CI).
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: join(repoRoot, ".env.local") });

import { createClerkClient } from "@clerk/backend";

async function main(): Promise<void> {
  const email = (process.env.ROOK_EVAL_USER_EMAIL ?? "edwardcranko7@gmail.com").trim();
  const secret = process.env.CLERK_SECRET_KEY ?? "";
  if (!secret) throw new Error("CLERK_SECRET_KEY is not set.");
  const clerk = createClerkClient({ secretKey: secret });
  const users = await clerk.users.getUserList({ emailAddress: [email] });
  const found = users.data?.[0];
  if (!found) throw new Error(`No Clerk user for ${email}.`);
  const clerkUserId: string = found.id;
  const sessions = (await clerk.sessions.getSessionList({ userId: clerkUserId })) as unknown as
    | Array<{ id: string; status: string }>
    | { data?: Array<{ id: string; status: string }> };
  const list = Array.isArray(sessions) ? sessions : (sessions.data ?? []);
  const active = list.find((session) => session.status === "active");
  if (!active) {
    throw new Error(
      `No active Clerk session for ${email} (saw ${list.length} session(s)). Sign in to Rook on web or mobile first, then retry within a minute of the probe run.`,
    );
  }
  const token = await clerk.sessions.getToken(active.id);
  const jwt = typeof token === "string" ? token : (token as { jwt?: string }).jwt;
  if (!jwt) throw new Error("Clerk issued no token.");
  process.stdout.write(`${jwt}\n`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "mint failed");
  process.exit(1);
});

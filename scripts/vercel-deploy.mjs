#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Deploy Rook to Vercel.
 *
 * The Vercel project (rook-lighting) isn't connected to the GitHub repo for
 * auto-deploy, so the api function and the static site only update when
 * this script is run.
 *
 * Usage:
 *   1. pnpm add -D vercel   (already in devDependencies)
 *   2. pnpm exec vercel login         (one-time: opens browser to authenticate)
 *   3. pnpm exec vercel link          (one-time: links ./ to rook-lighting)
 *   4. pnpm vercel:deploy             (deploys to production)
 *
 * Non-interactive (with a token):
 *   export VERCEL_TOKEN=... VERCEL_ORG_ID=... VERCEL_PROJECT_ID=...
 *   pnpm vercel:deploy
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function run(cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, { stdio: "inherit", shell: true, ...opts });
  if (result.status !== 0) {
    console.error(`command failed with exit ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

const vercelPkg = require.resolve("vercel/package.json");
const vercelBin = resolve(vercelPkg.replace("/package.json", "/bin/vercel.js"));

const hasToken = Boolean(process.env.VERCEL_TOKEN);
const hasProject = existsSync(resolve(process.cwd(), ".vercel"));

if (!hasToken && !hasProject) {
  console.error(
    [
      "Cannot deploy: no VERCEL_TOKEN env var and no .vercel/ directory.",
      "",
      "One-time setup (interactive):",
      "  pnpm exec vercel login",
      "  pnpm exec vercel link    # link to project: rook-lighting",
      "  pnpm vercel:deploy",
      "",
      "Or non-interactive (CI):",
      "  export VERCEL_TOKEN=... VERCEL_ORG_ID=... VERCEL_PROJECT_ID=...",
      "  pnpm vercel:deploy",
      "",
      "See docs/vercel-deploy.md for the full guide.",
    ].join("\n"),
  );
  process.exit(1);
}

const prod = process.argv.includes("--prod");
const args = ["deploy", "--yes"];
if (prod) args.push("--prod");

console.log(`Deploying with: node ${vercelBin} ${args.join(" ")}`);
run(process.execPath, [vercelBin, ...args]);


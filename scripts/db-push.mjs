#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Push instant.schema.ts / instant.perms.ts to InstantDB.
 *
 * Wrapped in a script (instead of a raw `instant-cli ...` line in
 * package.json) because npm scripts only expand `${VAR:-default}` bash
 * substitution on POSIX shells: on Windows (cmd.exe / PowerShell) the
 * literal string `${INSTANT_APP_ID:-...}` was passed straight through to
 * instant-cli and failed with "Expected App ID to be a UUID". Node resolves
 * the default itself here, so behavior is identical on every shell.
 *
 * Usage:
 *   INSTANT_APP_ADMIN_TOKEN=... pnpm db:push
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const DEFAULT_APP_ID = "ed69763d-c8a4-4a28-8bed-c13806f2493d";
const appId = process.env.INSTANT_APP_ID || DEFAULT_APP_ID;
const token = process.env.INSTANT_APP_ADMIN_TOKEN;

if (!token) {
  console.error("INSTANT_APP_ADMIN_TOKEN is not set. Get it from the InstantDB dashboard and run:\n" +
    "  INSTANT_APP_ADMIN_TOKEN=... pnpm db:push");
  process.exit(1);
}

const instantCliPkgPath = require.resolve("instant-cli/package.json");
const instantCliPkgJson = require(instantCliPkgPath);
const binRel =
  typeof instantCliPkgJson.bin === "string"
    ? instantCliPkgJson.bin
    : (instantCliPkgJson.bin?.["instant-cli"] ?? Object.values(instantCliPkgJson.bin ?? {})[0]);
const instantCliBin = instantCliPkgPath.replace(/package\.json$/, binRel.replace(/^\.\//, ""));

const result = spawnSync(
  process.execPath,
  [instantCliBin, "push", "all", "--app", appId, "--token", token, "--yes"],
  {
    stdio: "inherit",
    shell: false,
    // instant-cli's perms diff (via `colors`/`json-diff`) recurses on ANSI
    // escape codes and stack-overflows on some Windows terminals. Disabling
    // color avoids the recursive path entirely; the diff is still printed,
    // just uncolored.
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
  },
);
process.exit(result.status ?? 1);

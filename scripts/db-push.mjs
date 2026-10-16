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
 * Schema and perms are pushed as two separate `instant-cli` invocations
 * (rather than one `push all`) because the perms-diff step has been
 * observed to stack-overflow on some Windows terminals even with color
 * disabled. A perms crash is reported but does not fail the script, so a
 * successful schema push is never hidden behind it.
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

function runInstantCli(args) {
  return spawnSync(process.execPath, [instantCliBin, ...args], {
    stdio: "inherit",
    shell: false,
    // instant-cli's perms diff (via `colors`/`json-diff`) recurses on ANSI
    // escape codes and can still stack-overflow on some Windows terminals
    // even with color disabled, so schema and perms are pushed as separate
    // steps: a crash while diffing perms must not hide a successful schema
    // push, and must not block on a step that hasn't changed.
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
  });
}

const schemaResult = runInstantCli(["push", "schema", "--app", appId, "--token", token, "--yes"]);
if (schemaResult.status !== 0) {
  process.exit(schemaResult.status ?? 1);
}

const permsResult = runInstantCli(["push", "perms", "--app", appId, "--token", token, "--yes"]);
if (permsResult.status !== 0) {
  console.error(
    "\nSchema push succeeded, but pushing perms crashed (known instant-cli/colors bug on some " +
      "Windows terminals). This does not affect the schema push above. Run\n" +
      "  pnpm exec instant-cli push perms --app " +
      appId +
      ' --token "$INSTANT_APP_ADMIN_TOKEN" --yes\n' +
      "from a different terminal (e.g. Git Bash) if you need to apply a perms change.",
  );
  process.exit(0);
}

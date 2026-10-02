#!/usr/bin/env node
/**
 * Verifies that a release bundle directory contains every asset the
 * download page links to, each above a minimum plausible size. Run in CI
 * after the staging step so a missing/empty asset fails the release loudly
 * instead of shipping a broken download link.
 *
 * Usage: node scripts/verify-release-assets.mjs <dir> <name1,name2,...>
 */
import fs from "node:fs";
import path from "node:path";

const [, , dir, namesArg] = process.argv;
if (!dir || !namesArg) {
  console.error("usage: node verify-release-assets.mjs <dir> <asset-name,asset-name,...>");
  process.exit(2);
}
const EXPECTED = namesArg.split(",").map((s) => s.trim()).filter(Boolean);

// Minimum plausible size (bytes) — catches truncated/placeholder files.
const MIN_SIZE = 10 * 1024 * 1024;

let failed = false;
for (const name of EXPECTED) {
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) {
    console.error(`MISSING: ${name}`);
    failed = true;
    continue;
  }
  const size = fs.statSync(file).size;
  if (size < MIN_SIZE) {
    console.error(`TOO SMALL: ${name} is ${size} bytes (expected >= ${MIN_SIZE})`);
    failed = true;
    continue;
  }
  console.log(`ok: ${name} (${(size / (1024 * 1024)).toFixed(1)} MB)`);
}

if (failed) process.exit(1);
console.log(`all expected assets present: ${EXPECTED.join(", ")}`);

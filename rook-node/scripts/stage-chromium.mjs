#!/usr/bin/env node
/**
 * Stages ONLY the Chromium builds the pinned playwright actually resolves,
 * instead of the whole ms-playwright cache (which accumulates one full
 * ~600 MB copy per playwright upgrade and was triple-bloating installers).
 *
 * Usage: node scripts/stage-chromium.mjs <browsers-cache-dir> <dest-dir>
 * Reads the revision from the installed playwright-core's browsers.json so
 * it stays lockstep with the dependency.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const [, , cacheDir, destDir] = process.argv;
if (!cacheDir || !destDir) {
  console.error("usage: node stage-chromium.mjs <ms-playwright-dir> <dest-dir>");
  process.exit(2);
}

const require = createRequire(import.meta.url);
// playwright-core is not a direct dependency (pnpm), so resolve it as the
// sibling of playwright in the store — same approach as patch-inspector.mjs.
const playwrightPkgPath = path.dirname(fs.realpathSync(require.resolve("playwright/package.json")));
const { browsers } = JSON.parse(
  fs.readFileSync(path.join(playwrightPkgPath, "..", "playwright-core", "browsers.json"), "utf8"),
);

// Ship the full chromium plus the headless shell (playwright 1.49+ uses it
// for headless launches) and ffmpeg (media tasks). Nothing else.
const WANTED = new Set(["chromium", "chromium-headless-shell", "ffmpeg"]);
const wantedNames = browsers
  .filter((b) => WANTED.has(b.name))
  .map((b) => `${b.name.replace(/-/g, "_").replace("headless_shell", "headless_shell")}-${b.revision}`);

// browsers.json uses dashes; on-disk dirs use underscores with the pattern
// <name>-<revision> (e.g. chromium_headless_shell-1234). Match both spellings.
const allEntries = fs.readdirSync(cacheDir);
const toCopy = new Set();
for (const name of wantedNames) {
  const matches = allEntries.filter(
    (e) => e === name || e === name.replace(/_/g, "-") || e.startsWith(name + "-"),
  );
  if (matches.length === 0) {
    console.error(`MISSING: no browser dir for ${name} in ${cacheDir}`);
    process.exit(1);
  }
  for (const m of matches) toCopy.add(m);
}

fs.rmSync(destDir, { recursive: true, force: true });
fs.mkdirSync(destDir, { recursive: true });
let total = 0;
for (const entry of toCopy) {
  const src = path.join(cacheDir, entry);
  if (!fs.statSync(src).isDirectory()) continue;
  fs.cpSync(src, path.join(destDir, entry), { recursive: true });
  total += 1;
  console.log(`staged ${entry}`);
}
if (total === 0) {
  console.error("nothing staged");
  process.exit(1);
}
console.log(`staged ${total} browser dirs into ${destDir}`);

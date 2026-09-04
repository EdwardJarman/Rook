/**
 * Makes playwright-core loadable inside @yao-pkg/pkg executables.
 *
 * pkg builds ship without the V8 inspector, but playwright-core's page client
 * does a top-level `require("inspector")` (used only for CPU profiling, which
 * Rook never calls). This script guards both require sites with a no-op
 * fallback so the module loads cleanly. Run before `pkg`.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

// pnpm: playwright-core is not a direct dependency, so resolve it as the
// sibling of playwright inside the .pnpm store.
const playwrightPkg = fs.realpathSync(require.resolve("playwright/package.json"));
const corePkg = path.join(path.dirname(playwrightPkg), "..", "playwright-core", "package.json");
const coreBundle = path.join(path.dirname(corePkg), "lib", "coreBundle.js");

const fallback = `(() => {
  try {
    return require("inspector");
  } catch {
    return { Session: class { connect() {} post() {} disconnect() {} } };
  }
})()`;

const replacements = [
  [`inspector = __toESM(require("inspector"));`, `inspector = __toESM(${fallback});`],
  [`session = new (require("inspector")).Session();`, `session = new (${fallback}).Session();`],
];

let source = fs.readFileSync(coreBundle, "utf8");
let applied = 0;
for (const [from, to] of replacements) {
  if (source.includes(from)) {
    source = source.replaceAll(from, to);
    applied += 1;
  }
}
fs.writeFileSync(coreBundle, source);
console.log(`[patch-inspector] ${applied}/${replacements.length} guards applied in ${coreBundle}`);
if (applied === 0) {
  console.error("[patch-inspector] No occurrences found — playwright-core layout may have changed.");
  process.exit(1);
}

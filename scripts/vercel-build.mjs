import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Clerk publishable keys are designed to be embedded in client bundles. Keep a
// checked-in fallback so a Vercel redeploy cannot lose Rook's public auth
// configuration when only server secrets are edited in Project Settings.
const ROOK_CLERK_PUBLISHABLE_KEY =
  "pk_test_aW5zcGlyZWQtaG9uZXliZWUtNDMuY2xlcmsuYWNjb3VudHMuZGV2JA";
const publishableKey =
  process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ||
  process.env.CLERK_PUBLISHABLE_KEY ||
  ROOK_CLERK_PUBLISHABLE_KEY;

// Build the server bundle (api function target) before the static export.
// The api/[...path].ts serverless function imports from this bundle so
// the function can ship a single self-contained ESM file.
const esbuild = await import("esbuild");
const bundleResult = await esbuild.build({
  entryPoints: ["server/_core/index.ts"],
  bundle: true,
  platform: "node",
  packages: "external",
  format: "esm",
  outfile: "dist-server/index.js",
  logLevel: "info",
});
if (!existsSync("dist-server/index.js")) {
  console.error("[vercel-build] dist-server/index.js missing after bundle");
  process.exit(1);
}
const bundleSize = statSync("dist-server/index.js").size;
console.log(`[vercel-build] dist-server/index.js (${(bundleSize / 1024).toFixed(1)} KB) ready`);

// Resolve the expo CLI binary directly. Calling `pnpm exec expo` from a
// `spawnSync` on Windows is fragile because pnpm shims through a .ps1 entry
// that doesn't always propagate the child's exit status back through
// `inherit` stdio, which made the wrapper silently report exit 1.
const expoEntry = require.resolve("expo/bin/cli");
const result = spawnSync(process.execPath, [expoEntry, "export", "--platform", "web", "--output-dir", "dist", "--clear"], {
  stdio: "inherit",
  env: {
    ...process.env,
    EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: publishableKey,
  },
});

if (result.error) {
  console.error("[vercel-build] spawn error:", result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);

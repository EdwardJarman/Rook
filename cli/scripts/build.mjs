// Bundle the CLI to one file. Plain Node — no shell quoting involved
// (a quoted --banner flag breaks across cmd/PowerShell/sh).
import { buildSync } from "esbuild";

buildSync({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/rook.cjs",
  banner: { js: "#!/usr/bin/env node" },
  logLevel: "error",
});
console.log("built dist/rook.cjs");

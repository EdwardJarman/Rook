import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  esbuild: { jsx: "automatic" },
  test: {
    // rook-node is a self-contained package with its own test suite
    // (run `pnpm test` inside rook-node/).
    // .opencode holds harness-local files (commands, skills, cached deps) —
    // never Rook tests; without this, foreign suites pollute `pnpm test`.
    // **/node_modules/** (not just the root one): nested packages like
    // cli/ ship dependencies whose own test files must never run here.
    exclude: [".kilo/**", ".opencode/**", "rook-node/**", "node_modules/**", "**/node_modules/**", "dist/**", "dist-server/**"],
  },
});

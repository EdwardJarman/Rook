import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // rook-node is a self-contained package with its own test suite
    // (run `pnpm test` inside rook-node/).
    exclude: [".kilo/**", "rook-node/**", "node_modules/**", "dist/**", "dist-server/**"],
  },
});
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src/app") },
  },
  esbuild: {
    // The shared relay module lives outside this package, so vitest's tsconfig
    // discovery walks up to the web app's tsconfig (which extends
    // "expo/tsconfig.base" — unresolvable here). Pin the transform config.
    tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: false } },
  },
  test: {
    include: [
      "tests/**/*.test.ts",
      "src/app/**/*.test.ts",
      "src/app/**/*.test.tsx",
    ],
    environment: "node",
    testTimeout: 15_000,
    hookTimeout: 30_000,
    deps: {
      optimizer: {
        ssr: {
          exclude: ["node:sqlite"],
        },
      },
    },
  },
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    // The shared relay module lives outside this package, so vitest's tsconfig
    // discovery walks up to the web app's tsconfig (which extends
    // "expo/tsconfig.base" — unresolvable here). Pin the transform config.
    tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: false } },
  },
  test: {
    include: ["tests/**/*.test.ts"],
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

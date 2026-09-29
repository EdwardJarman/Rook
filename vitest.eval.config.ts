import { defineConfig } from "vitest/config";
import path from "node:path";

/** Operator-run evals only; `pnpm test` never includes these (`*.eval.ts`). */
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: { include: ["evals/**/*.eval.ts"], fileParallelism: false, testTimeout: 6 * 60 * 60_000, hookTimeout: 120_000 },
});

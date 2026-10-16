/**
 * Live drill for the ChatGPT path (needs a real connected account; spends a few
 * tokens of that account's plan). Run: `pnpm drill:chatgpt-models`.
 *
 * Env: CLERK_SECRET_KEY, and ROOK_EVAL_SESSION_TOKEN (or ..._TOKEN_CMD) = a Clerk
 * session JWT of a user who has connected ChatGPT. Optional: ROOK_DRILL_MODEL
 * (e.g. chatgpt:gpt-5.5) to also run a full "hey" through the resilient router,
 * and OPENROUTER_API_KEY to see the fallback. Prints no tokens or bodies beyond
 * the redacted provider message.
 */
import "dotenv/config";
import { execSync } from "node:child_process";

import type { Request } from "express";

const token = (() => {
  const direct = process.env.ROOK_EVAL_SESSION_TOKEN?.trim();
  if (direct) return direct;
  const command = process.env.ROOK_EVAL_SESSION_TOKEN_CMD?.trim();
  return command ? execSync(command, { encoding: "utf8", timeout: 30_000 }).trim() : "";
})();

async function main() {
  if (!process.env.CLERK_SECRET_KEY || !token) {
    throw new Error("Set CLERK_SECRET_KEY and ROOK_EVAL_SESSION_TOKEN (or ROOK_EVAL_SESSION_TOKEN_CMD).");
  }
  process.env.ROOK_AI_DEBUG ??= "1";
  const request = {
    protocol: "https",
    header: (name: string) => (name.toLowerCase() === "authorization" ? `Bearer ${token}` : undefined),
  } as unknown as Request;

  const { listChatGPTModels } = await import("../server/ai/chatgpt");
  const { invokeAiResilient } = await import("../server/ai/fallback-router");
  const { modelHealth } = await import("../server/ai/model-health");

  console.info("1) Listing + probing every slug the account is offered (sequential)…");
  const models = await listChatGPTModels(request, { verify: true });
  if (!models.length) throw new Error("No models listed: see the [ChatGPT models] log line above for the failing layer.");
  console.table(models.map((model) => ({
    id: model.id,
    verdict: model.unavailable ? "UNAVAILABLE" : "ok",
    reason: model.unavailableReason ?? "",
  })));

  const target = process.env.ROOK_DRILL_MODEL?.trim() || models.find((model) => !model.unavailable)?.id;
  if (target) {
    console.info(`2) "hey" through the resilient router with ${target}…`);
    const outcome = await invokeAiResilient({ model: target, messages: [{ role: "user", content: "hey" }] }, request);
    console.info({
      answeredBy: outcome.result.model,
      attempted: outcome.attemptedProviders,
      fellBack: outcome.fellBack,
      fallbackReason: outcome.fallbackReason,
      reply: String(outcome.result.choices[0]?.message.content).slice(0, 120),
    });
  }
  console.info("3) Per-model health:");
  console.table(modelHealth.snapshot());
}

main().catch((error) => {
  console.error("DRILL FAILED:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

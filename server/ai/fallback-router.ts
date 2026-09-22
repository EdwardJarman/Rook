/**
 * Cross-provider fallback router + per-turn telemetry (v2 loop-mode).
 *
 * `invokeAi` routes strictly by model prefix and only falls back
 * ChatGPT -> OpenRouter. This module adds the missing production layer:
 * when the requested provider wobbles transiently (429/5xx/timeout), try
 * the next healthy configured provider instead of failing the chat turn.
 *
 * Rules (deliberately conservative):
 * - Fallback happens ONLY on transient errors (see `isTransientAgentError`).
 *   Auth/config/unknown-model errors surface honestly — silently switching
 *   providers there would hide broken keys or surprise billing.
 * - The result always reports which model actually answered (`model`) plus
 *   whether a fallback happened (`fellBack`, `attemptedProviders`), so the
 *   system prompt's model-route transparency stays truthful.
 * - A tiny in-memory circuit breaker cools down providers that fail
 *   repeatedly (3 consecutive transient failures -> 60s cooldown), so a
 *   dead provider doesn't add latency to every turn.
 */

import type { Request } from "express";
import type { InvokeParams, InvokeResult } from "../_core/llm";
import { invokeAi } from "./index";
import { isOrcaRouterConfigured, isTokenRouterConfigured, listOrcaRouterModels, listTokenRouterModels } from "./router-gateways";
import { isOpenRouterConfigured } from "./openrouter";
import { classifyRetryDecision, isTransientAgentError } from "./agent-reliability";

export type ResilientInvokeResult = {
  result: InvokeResult;
  /** Providers tried in order, e.g. ["openrouter", "orcarouter"]. */
  attemptedProviders: string[];
  fellBack: boolean;
};

type BreakerState = {
  consecutiveFailures: number;
  /** Total attempts (success + failure) — the min-samples guard below. */
  totalSamples: number;
  cooledUntil: number;
};

const breaker = new Map<string, BreakerState>();
const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 60_000;
/**
 * Grok `xai-circuit-breaker` port (sliding-window-with-min-samples, adapted):
 * the breaker trips only when `consecutiveFailures >= THRESHOLD` AND
 * `totalSamples >= MIN_SAMPLES`, so 3 failures at 4am on a cold provider do
 * not add a 60s cooldown to every turn. Auth/config (`emit`) outcomes never
 * count as samples — a bad key must surface, never trip the breaker.
 */
export const BREAKER_MIN_SAMPLES = 5;

/** Pure trip predicate, exported for tests. */
export function breakerShouldTrip(state: BreakerState): boolean {
  return (
    state.consecutiveFailures >= BREAKER_THRESHOLD &&
    state.totalSamples >= BREAKER_MIN_SAMPLES
  );
}

const providerOf = (model: string | undefined): string => {
  if (model?.startsWith("orcarouter:")) return "orcarouter";
  if (model?.startsWith("tokenrouter:")) return "tokenrouter";
  if (model?.startsWith("chatgpt:")) return "chatgpt";
  if (model?.startsWith("opencode:")) return "opencode";
  return "openrouter";
};

const inCooldown = (provider: string): boolean =>
  (breaker.get(provider)?.cooledUntil ?? 0) > Date.now();

const recordSuccess = (provider: string): void => {
  const state = breaker.get(provider) ?? {
    consecutiveFailures: 0,
    totalSamples: 0,
    cooledUntil: 0,
  };
  // Success resets the streak but keeps the sample count — min-samples is
  // about total evidence, not consecutive evidence.
  state.consecutiveFailures = 0;
  state.totalSamples += 1;
  state.cooledUntil = 0;
  breaker.set(provider, state);
};

const recordFailure = (provider: string): void => {
  const state = breaker.get(provider) ?? {
    consecutiveFailures: 0,
    totalSamples: 0,
    cooledUntil: 0,
  };
  state.consecutiveFailures += 1;
  state.totalSamples += 1;
  if (breakerShouldTrip(state)) {
    state.cooledUntil = Date.now() + BREAKER_COOLDOWN_MS;
    console.warn("[RookAI] provider circuit-breaker tripped", {
      provider,
      cooledUntil: new Date(state.cooledUntil).toISOString(),
    });
  }
  breaker.set(provider, state);
};

const firstOrcaModel = (): string | undefined =>
  isOrcaRouterConfigured() ? listOrcaRouterModels()[0]?.id : undefined;

const firstTokenModel = (): string | undefined =>
  isTokenRouterConfigured() ? listTokenRouterModels()[0]?.id : undefined;

/** Ordered candidate models: requested first, then healthy configured fallbacks. */
export function fallbackCandidates(requestedModel: string | undefined): string[] {
  const candidates: string[] = [];
  const push = (model: string | undefined) => {
    if (model && !candidates.includes(model)) candidates.push(model);
  };
  push(requestedModel);
  const requestedProvider = providerOf(requestedModel);
  // Never auto-fallback TO ChatGPT: it bills the user's own ChatGPT plan and
  // needs their connected session. Fallback targets are Rook's shared routes.
  if (requestedProvider !== "chatgpt") {
    if (isOpenRouterConfigured()) push("openrouter/free");
    const orca = firstOrcaModel();
    if (orca) push(orca);
    const token = firstTokenModel();
    if (token) push(token);
  } else if (isOpenRouterConfigured()) {
    push("openrouter/free");
  }
  return candidates;
}

export async function invokeAiResilient(
  params: InvokeParams,
  request?: Request,
): Promise<ResilientInvokeResult> {
  const attemptedProviders: string[] = [];
  const candidates = fallbackCandidates(params.model);
  let lastError: unknown;

  for (const candidate of candidates) {
    const provider = providerOf(candidate);
    if (attemptedProviders.includes(provider)) continue;
    // The explicitly requested provider is always attempted once — it was
    // the user's choice and its error (if any) must surface honestly.
    // Only *fallback* candidates honor the circuit breaker.
    if (candidate !== params.model && inCooldown(provider)) continue;
    attemptedProviders.push(provider);
    try {
      const result = await invokeAi({ ...params, model: candidate }, request);
      recordSuccess(provider);
      return {
        result,
        attemptedProviders,
        fellBack: candidate !== params.model,
      };
    } catch (error) {
      lastError = error;
      // Error-class split (grok retry.rs order): auth/config surfaces
      // honestly and never counts toward the breaker; only wobbles do.
      if (classifyRetryDecision(error) === "emit") throw error;
      if (!isTransientAgentError(error)) throw error;
      recordFailure(provider);
      console.warn("[RookAI] provider wobble, trying fallback", {
        provider,
        attempted: attemptedProviders.join(","),
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }

  throw lastError ?? new Error("All configured AI providers failed.");
}

export const __resetFallbackBreakerForTests = (): void => {
  breaker.clear();
};

export const __tripFallbackBreakerForTests = (provider: string): void => {
  const state = breaker.get(provider) ?? {
    consecutiveFailures: 0,
    totalSamples: 0,
    cooledUntil: 0,
  };
  breaker.set(provider, {
    consecutiveFailures: Math.max(state.consecutiveFailures, BREAKER_THRESHOLD),
    // A forced trip must satisfy min-samples or it would clear immediately.
    totalSamples: Math.max(state.totalSamples, BREAKER_MIN_SAMPLES),
    cooledUntil: Date.now() + BREAKER_COOLDOWN_MS,
  });
};

/** Snapshot for tests (shape is test-only, not a public contract). */
export const __breakerStateForTests = (
  provider: string,
): { consecutiveFailures: number; totalSamples: number; cooledUntil: number } | undefined => {
  const state = breaker.get(provider);
  return state ? { ...state } : undefined;
};

/** Drive the private recorders without network (test-only). */
export const __recordBreakerOutcomeForTests = (
  provider: string,
  outcome: "success" | "wobble",
): void => {
  if (outcome === "success") recordSuccess(provider);
  else recordFailure(provider);
};

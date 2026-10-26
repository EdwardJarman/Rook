/**
 * Experimental variants with a measured decision (see docs/eval-probe.md).
 *
 * Lean prompt and tool offload passed the decision probe (no success/latency
 * regression, ~12% fewer input tokens) and are now PRODUCTION DEFAULTS. Plan
 * compaction stayed neutral and remains OFF. Any flag can still be turned off
 * per process with `ROOK_VARIANT_*` env or per turn with a server-owned
 * override (hermetic evals pin every flag explicitly). Off means byte-identical
 * requests to the pre-variant harness, pinned by tests.
 */

export type VariantFlags = {
  /** Rewritten standing instructions per docs/agent-system-prompt-audit.md. */
  leanPrompt: boolean;
  /** Low-use tools load on demand through `load_tools` instead of riding every request. */
  toolOffload: boolean;
  /** Smaller verbatim history window; older turns become a plan ledger plus a scoped transcript pointer. */
  compactPlan: boolean;
};

export const VARIANT_ENV: Record<keyof VariantFlags, string> = {
  leanPrompt: "ROOK_VARIANT_LEAN_PROMPT",
  toolOffload: "ROOK_VARIANT_TOOL_OFFLOAD",
  compactPlan: "ROOK_VARIANT_COMPACT_PLAN",
};

/** Every flag off — the legacy harness (used by evals and byte-parity tests). */
export const NO_VARIANTS: VariantFlags = { leanPrompt: false, toolOffload: false, compactPlan: false };

/** Production defaults after the decision probe. */
export const DEFAULT_VARIANTS: VariantFlags = { leanPrompt: true, toolOffload: true, compactPlan: false };

const truthy = (value: string | undefined) => value === "1" || value?.toLowerCase() === "true";

/**
 * Precedence: explicit per-turn override > explicit env > production default.
 * Env values are only consulted when set; `0`/`false`/`yes` disable a flag.
 */
export function resolveVariants(
  override?: Partial<VariantFlags>,
  env: Record<string, string | undefined> = process.env,
): VariantFlags {
  const flags = { ...DEFAULT_VARIANTS };
  for (const key of Object.keys(VARIANT_ENV) as Array<keyof VariantFlags>) {
    const forced = override?.[key];
    if (forced !== undefined) {
      flags[key] = forced;
      continue;
    }
    const envValue = env[VARIANT_ENV[key]];
    if (envValue !== undefined) flags[key] = truthy(envValue);
  }
  return flags;
}

/** Names of enabled variants, for telemetry attribution. */
export const activeVariantNames = (flags: VariantFlags): string[] =>
  (Object.keys(flags) as Array<keyof VariantFlags>).filter((key) => flags[key]).sort();

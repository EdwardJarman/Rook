/**
 * Default-off experimental variants (follow-up chunk 4).
 *
 * Each variant is an independent switch. Off means byte-identical requests to
 * the pre-variant harness (pinned by tests). Flags come from the process
 * environment, or from a server-owned per-call override so a hermetic eval can
 * compare arms in one process. Chat clients cannot set either: request schemas
 * strip unknown fields.
 */

export type VariantFlags = {
  /** Rewritten standing instructions per docs/agent-system-prompt-audit.md. */
  leanPrompt: boolean;
};

export const VARIANT_ENV: Record<keyof VariantFlags, string> = {
  leanPrompt: "ROOK_VARIANT_LEAN_PROMPT",
};

export const NO_VARIANTS: VariantFlags = { leanPrompt: false };

const truthy = (value: string | undefined) => value === "1" || value?.toLowerCase() === "true";

export function resolveVariants(
  override?: Partial<VariantFlags>,
  env: Record<string, string | undefined> = process.env,
): VariantFlags {
  const flags = { ...NO_VARIANTS };
  for (const key of Object.keys(VARIANT_ENV) as Array<keyof VariantFlags>) {
    flags[key] = override?.[key] ?? truthy(env[VARIANT_ENV[key]]);
  }
  return flags;
}

/** Names of enabled variants, for telemetry attribution. */
export const activeVariantNames = (flags: VariantFlags): string[] =>
  (Object.keys(flags) as Array<keyof VariantFlags>).filter((key) => flags[key]).sort();

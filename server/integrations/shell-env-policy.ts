/**
 * Shell environment secret filter (Grok `[shell_environment_policy]` port).
 *
 * Controls which variables a tool-spawned subprocess inherits, so a model-run
 * command cannot read a secret that happens to sit in the host environment.
 * Order (grok semantics): start from `inherit`, drop built-in secret
 * patterns unless `ignoreDefaultExcludes`, drop `exclude` matches, apply
 * `set`, then narrow to `includeOnly` when non-empty. Patterns are
 * case-insensitive globs (`*`, `?`).
 */

export type ShellEnvInherit = "all" | "core" | "none";

export type ShellEnvPolicy = {
  inherit?: ShellEnvInherit;
  ignoreDefaultExcludes?: boolean;
  exclude?: string[];
  includeOnly?: string[];
  set?: Record<string, string>;
};

/** Built-in secret patterns (grok defaults). */
export const DEFAULT_SECRET_PATTERNS = ["*KEY*", "*SECRET*", "*TOKEN*"];

/** Small platform set kept under `inherit: "core"`. */
export const CORE_ENV_KEYS = [
  "PATH",
  "PATHEXT",
  "HOME",
  "USERPROFILE",
  "SYSTEMROOT",
  "SYSTEMDRIVE",
  "TEMP",
  "TMP",
  "LANG",
  "LC_ALL",
  "LC_MESSAGES",
  "TERM",
  "TERM_PROGRAM",
  "SHELL",
  "COMSPEC",
];

const globMatch = (name: string, pattern: string): boolean => {
  const source = name.toLowerCase();
  const body = pattern.toLowerCase();
  let regex = "^";
  for (const ch of body) {
    if (ch === "*") regex += ".*";
    else if (ch === "?") regex += ".";
    else regex += ch.replace(/[.+^${}()|[\]\\]/, "\\$&");
  }
  return new RegExp(`${regex}$`).test(source);
};

const matchesAny = (name: string, patterns: readonly string[]): boolean =>
  patterns.some((pattern) => pattern.trim() !== "" && globMatch(name, pattern.trim()));

/** Build the child environment. Pure — the caller owns spawning. */
export function filterShellEnv(
  env: Record<string, string>,
  policy: ShellEnvPolicy = {},
): Record<string, string> {
  const inherit = policy.inherit ?? "all";
  let out: Record<string, string> = {};
  if (inherit === "all") {
    out = { ...env };
  } else if (inherit === "core") {
    for (const key of CORE_ENV_KEYS) {
      const hit = Object.keys(env).find((entry) => entry.toLowerCase() === key.toLowerCase());
      if (hit !== undefined) out[hit] = env[hit];
    }
  }
  if (!policy.ignoreDefaultExcludes) {
    for (const key of Object.keys(out)) {
      if (matchesAny(key, DEFAULT_SECRET_PATTERNS)) delete out[key];
    }
  }
  if (policy.exclude?.length) {
    for (const key of Object.keys(out)) {
      if (matchesAny(key, policy.exclude)) delete out[key];
    }
  }
  if (policy.set) {
    for (const [key, value] of Object.entries(policy.set)) out[key] = value;
  }
  if (policy.includeOnly?.length) {
    const narrowed: Record<string, string> = {};
    for (const [key, value] of Object.entries(out)) {
      if (matchesAny(key, policy.includeOnly)) narrowed[key] = value;
    }
    out = narrowed;
  }
  return out;
}

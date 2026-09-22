/**
 * Static deny policy (Grok `PermissionConfig` compiled-deny port, adapted).
 *
 * A deterministic glob/command block-list evaluated BEFORE `executeAgentTool`
 * dispatches — deny always wins over allow, modes, and remembered grants.
 * Empty by default (zero behavior change); configured per deployment via env
 * and per user via settings. Denied calls return
 * `{ status: "denied", code: "POLICY_DENIED", retryable: false }` so the
 * retry policy (which reads codes, not strings) never retries them.
 */

export type ToolPolicyConfig = {
  /** Command patterns, e.g. `rm -rf *`. `*` spans any chars, `?` one char. */
  deniedCommands: string[];
  /** Path patterns, e.g. `**\/.env`. `**` spans directories, `*` within one segment. */
  deniedPaths: string[];
};

const splitList = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

/** Deployment config. Read per call (no cache) so tests and settings stay hermetic. */
export function loadToolPolicyFromEnv(env: NodeJS.ProcessEnv = process.env): ToolPolicyConfig {
  return {
    deniedCommands: splitList(env.ROOK_TOOL_DENY_COMMANDS),
    deniedPaths: splitList(env.ROOK_TOOL_DENY_PATHS),
  };
}

const globToRegExp = (pattern: string, spanSlash: boolean): RegExp => {
  let out = "^";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*" && pattern[i + 1] === "*" && spanSlash) {
      out += ".*";
      i++;
    } else if (ch === "*") {
      out += spanSlash ? "[^/]*" : ".*";
    } else if (ch === "?") {
      out += spanSlash ? "[^/]" : ".";
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/, "\\$&");
    }
  }
  return new RegExp(`${out}$`, "i");
};

const normalizeCommand = (command: string): string => command.replace(/\s+/g, " ").trim();

/** Plain prefix without wildcards matches whole-word prefixes (`rm -rf *` blocks `rm -rf /x`, not `rm -rfx`). */
function prefixMatches(command: string, pattern: string): boolean {
  const clean = normalizeCommand(pattern);
  const normalized = normalizeCommand(command);
  if (!clean || !normalized) return false;
  if (!/[*?]/.test(clean)) {
    return normalized === clean || normalized.startsWith(`${clean} `);
  }
  return globToRegExp(clean, false).test(normalized);
}

/** True when the command matches any denied pattern. */
export function isDeniedCommand(command: string, patterns: string[]): boolean {
  return patterns.some((pattern) => prefixMatches(command, pattern));
}

const normalizePath = (path: string): string => {
  const forward = path.replace(/\\/g, "/").trim();
  const parts: string[] = [];
  for (const segment of forward.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  const rooted = forward.startsWith("/");
  return `${rooted ? "/" : ""}${parts.join("/")}`;
};

/** True when the path matches any denied pattern (case-insensitive). */
export function isDeniedPath(path: string, patterns: string[]): boolean {
  const normalized = normalizePath(path);
  if (!normalized) return false;
  return patterns.some((pattern) => {
    const clean = pattern.trim();
    if (!clean) return false;
    if (!/[*?[]/.test(clean)) {
      const target = normalizePath(clean);
      return normalized === target || normalized.startsWith(`${target}/`);
    }
    const anchored = clean.includes("/") ? clean : `**/${clean}`;
    return globToRegExp(anchored, true).test(normalized);
  });
}

export type PolicyCheckHints = {
  command?: unknown;
  path?: unknown;
  file?: unknown;
};

export type PolicyVerdict =
  | { allowed: true }
  | { allowed: false; code: "POLICY_DENIED"; reason: string };

/**
 * Evaluate the deny layer for one tool call. Only string hints are read;
 * non-string values are ignored (never denied on a guess).
 */
export function checkToolPolicy(
  hints: PolicyCheckHints,
  config: ToolPolicyConfig,
): PolicyVerdict {
  if (typeof hints.command === "string" && isDeniedCommand(hints.command, config.deniedCommands)) {
    return {
      allowed: false,
      code: "POLICY_DENIED",
      reason: `Blocked by policy: that command pattern is denied on this deployment.`,
    };
  }
  for (const key of ["path", "file"] as const) {
    const value = hints[key];
    if (typeof value === "string" && isDeniedPath(value, config.deniedPaths)) {
      return {
        allowed: false,
        code: "POLICY_DENIED",
        reason: `Blocked by policy: that path is denied on this deployment.`,
      };
    }
  }
  return { allowed: true };
}

/**
 * Best-effort hint sniffing over raw tool args (parsed once, fields read
 * generically so no family branch is touched). Returns {} when unparseable.
 */
export function sniffPolicyHints(rawArgs: string): PolicyCheckHints {
  try {
    const parsed = JSON.parse(rawArgs || "{}") as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const hints: PolicyCheckHints = {};
    if ("command" in parsed) hints.command = parsed.command;
    if ("path" in parsed) hints.path = parsed.path;
    if ("file" in parsed) hints.file = parsed.file;
    return hints;
  } catch {
    return {};
  }
}

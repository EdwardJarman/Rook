/**
 * Permission-level gate for approval-gated tools.
 *
 * Order of authority (each layer can only tighten the next):
 *   static deny layer (tool-policy.ts, never overridden)
 *     -> NEVER_AUTO rules (ask at every level, including Full)
 *     -> the user's level (Always ask / Auto / Full)
 *
 * Auto's judgement is a deterministic scored rule table, not a model call:
 * every verdict names the rule and score that produced it so the journal can
 * answer "why did this run (or ask)" truthfully.
 */

import {
  DEFAULT_PERMISSION_LEVEL,
  PERMISSION_LEVEL_LABELS,
  minPermissionLevel,
  parsePermissionLevel,
  type PermissionLevel,
} from "../../shared/permission-level";
import type { AgentTraceStep } from "../../shared/agent-trace";
import * as db from "../db";
import { CLI_TOKEN_PREFIX, verifyCliToken } from "../cli-tokens";

/** Score meaning: 0 read-only, 1 additive and reversible, 2 changes state, 3 destructive/irreversible/external. */
export const AUTO_MAX_SCORE = 1;

export type GateRule = {
  id: string;
  score: 0 | 1 | 2 | 3;
  /** Irreversible external effect or credential access: asks at EVERY level. */
  neverAuto?: boolean;
  fallback?: boolean;
  reason: string;
  match: (tool: string, args: Record<string, unknown>) => boolean;
};

const text = (value: unknown): string => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");
const command = (args: Record<string, unknown>) => text(args.command);

const CREDENTIAL_TEXT =
  /(^|[\s/"'=])\.env(\.[\w-]+)?($|[\s/"'])|\.ssh\b|\bid_(rsa|ed25519|ecdsa)\b|\.npmrc\b|\.netrc\b|\.aws\/|\.kube\/config|\.pem\b|\.p12\b|\bcredentials?\b|\bsecrets?\b|\.git-credentials/i;

const PUBLISH_COMMAND =
  /\b(npm|pnpm|yarn|bun)\s+publish\b|\bgit\s+push\b|\bdocker\s+push\b|\btwine\s+upload\b|\bcargo\s+publish\b|\bgh\s+(release\s+create|pr\s+(create|merge)|repo\s+(create|delete)|issue\s+(create|comment)|api)\b|\bvercel\b.*--prod\b|\bterraform\s+apply\b|\bkubectl\s+(apply|delete)\b/i;

const MESSAGE_COMMAND =
  /\b(sendmail|mailx?|mutt|msmtp|swaks)\b|\b(curl|wget|http|https|xh)\b.*(\s-X\s*(POST|PUT|PATCH|DELETE)\b|--request\s+(POST|PUT|PATCH|DELETE)\b|\s-d\s|--data|\s-F\s|--form|--upload-file|\s-T\s)/i;

const PURCHASE_COMMAND = /\b(stripe|paypal)\b|\bpurchase\b/i;
const REMOTE_COMMAND = /\b(ssh|scp|sftp)\b/i;
const CREDENTIAL_COMMAND = /\b(gh|aws|gcloud|az|vercel|npm|docker)\s+(auth|login|configure|token)\b/i;
const DESTRUCTIVE_COMMAND =
  /\brm\s+(-[a-z]*r[a-z]*|--recursive)\b|\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|push\b.*--force)|\bsudo\b|\bmkfs\b|\bdd\s+.*\bof=|\bdrop\s+(table|database)\b|\btruncate\b|\bchmod\s+-R\b|\bchown\s+-R\b|\bkill(all)?\b|\bfind\b.*(-delete|-exec)/i;

const READ_ONLY_BINARIES = new Set([
  "ls", "pwd", "cat", "head", "tail", "wc", "grep", "rg", "which", "whoami", "date",
  "uname", "tree", "stat", "file", "du", "df", "echo", "printf", "sort", "uniq",
]);
const READ_ONLY_GIT = new Set(["status", "log", "diff", "show", "branch", "rev-parse", "ls-files", "blame"]);
const SHELL_METACHARS = /[;&|<>`$()\n\\{}*?~]/;

const isReadOnlyCommand = (raw: string): boolean => {
  const cmd = raw.replace(/\s+/g, " ").trim();
  if (!cmd || SHELL_METACHARS.test(cmd)) return false;
  const [bin, sub] = cmd.split(" ");
  if (CREDENTIAL_TEXT.test(cmd)) return false;
  if (bin === "git") return READ_ONLY_GIT.has(sub ?? "") && !/\s--(output|ext-diff)\b|\s-[a-z]*[dDmM]\b/.test(cmd);
  return READ_ONLY_BINARIES.has(bin ?? "");
};

const RUN = "computer_run_command";
const WRITE = "computer_write_file";

/**
 * First-listed wins among equal scores; the highest score always wins. The
 * NEVER_AUTO subset (neverAuto: true) is pinned by test: adding to or removing
 * from it must be a deliberate, reviewed change.
 */
type RuleSpec = Omit<GateRule, "match"> & {
  tool: string;
  /** Command regex (any match). */
  re?: RegExp;
  /** Extra regex over command + cwd. */
  alsoRe?: RegExp;
  /** Path regex for file tools. */
  pathRe?: RegExp;
  test?: (cmd: string) => boolean;
  /** Used only when no specific rule matches. */
  fallback?: boolean;
};

const RULE_SPECS: RuleSpec[] = [
  { id: "task.manual-handoff", score: 3, neverAuto: true, tool: "computer_propose_task",
    reason: "It is a manual handoff with no executable form, so only you can carry it out." },
  { id: "cmd.publish", score: 3, neverAuto: true, tool: RUN,
    reason: "It publishes, pushes, or deploys to an external system, which cannot be undone.", re: PUBLISH_COMMAND },
  { id: "cmd.send", score: 3, neverAuto: true, tool: RUN,
    reason: "It sends data or a message to an outside service as you.", re: MESSAGE_COMMAND },
  { id: "cmd.purchase", score: 3, neverAuto: true, tool: RUN,
    reason: "It may spend money.", re: PURCHASE_COMMAND },
  { id: "cmd.remote", score: 3, neverAuto: true, tool: RUN,
    reason: "It reaches another machine as you.", re: REMOTE_COMMAND },
  { id: "cmd.credential", score: 3, neverAuto: true, tool: RUN,
    reason: "It touches credentials or signs in to a service.", re: CREDENTIAL_COMMAND, alsoRe: CREDENTIAL_TEXT },
  { id: "file.credential", score: 3, neverAuto: true, tool: WRITE,
    reason: "It writes to a credential or secret file.", pathRe: CREDENTIAL_TEXT },
  { id: "cmd.destructive", score: 3, tool: RUN,
    reason: "It can delete or overwrite data.", re: DESTRUCTIVE_COMMAND },
  { id: "excel.overwrite", score: 3, tool: "excel_update_range",
    reason: "It overwrites existing cells in your workbook." },
  { id: "cmd.read-only", score: 0, tool: RUN,
    reason: "It is a simple read-only command.", test: isReadOnlyCommand },
  { id: "excel.add-worksheet", score: 1, tool: "excel_add_worksheet",
    reason: "It only adds a worksheet and can be undone by deleting it." },
  { id: "excel.append-rows", score: 2, tool: "excel_append_table_rows",
    reason: "It adds rows to your table." },
  { id: "excel.create-workbook", score: 2, tool: "excel_create_workbook",
    reason: "It creates a new file in your account." },
  { id: "file.write", score: 2, tool: WRITE, fallback: true,
    reason: "It may create or overwrite a file." },
  { id: "cmd.unclassified", score: 2, tool: RUN, fallback: true,
    reason: "It runs a command whose effect is not known in advance." },
]
export const GATE_RULES: readonly GateRule[] = RULE_SPECS.map(
  ({ tool, re, alsoRe, pathRe, test, fallback, ...rule }): GateRule => {
  return {
    ...rule,
    ...(fallback ? { fallback } : {}),
    match: (name, args) => {
      if (name !== tool) return false;
      if (re || alsoRe) return Boolean((re && re.test(command(args))) || (alsoRe && alsoRe.test(`${command(args)} ${text(args.cwd)}`)));
      if (pathRe) return pathRe.test(text(args.path));
      if (test) return test(command(args));
      return true;
    },
  };
  },
);

/** Anything the table does not classify: ask unless Full. */
const UNCLASSIFIED: Pick<GateRule, "id" | "score" | "reason"> = {
  id: "tool.unclassified",
  score: 2,
  reason: "It is not in the risk table, so it is treated as unknown.",
};

export const NEVER_AUTO_RULE_IDS: readonly string[] = GATE_RULES.filter((rule) => rule.neverAuto).map((rule) => rule.id);

export type GateDecision = {
  decision: "run" | "ask";
  level: PermissionLevel;
  ruleId: string;
  score: number;
  neverAuto: boolean;
  /** One user-readable sentence, stored in the activity trail. */
  reason: string;
};

export function classifyTool(tool: string, args: Record<string, unknown>) {
  const matched = GATE_RULES.filter((rule) => rule.match(tool, args));
  const specific = matched.filter((rule) => !rule.fallback);
  const hits = specific.length ? specific : matched;
  if (!hits.length) return { ...UNCLASSIFIED, neverAuto: false };
  // Highest score wins; ties go to the earlier (more specific) rule.
  const best = hits.reduce((top, rule) => (rule.score > top.score ? rule : top));
  return { id: best.id, score: best.score, reason: best.reason, neverAuto: Boolean(best.neverAuto) };
}

/** Pure and deterministic: the same inputs always give the same verdict. */
export function decideGate(input: {
  level: PermissionLevel;
  tool: string;
  args: Record<string, unknown>;
}): GateDecision {
  const level = parsePermissionLevel(input.level);
  const label = PERMISSION_LEVEL_LABELS[level];
  const rule = classifyTool(input.tool, input.args);
  const base = { level, ruleId: rule.id, score: rule.score, neverAuto: rule.neverAuto };
  if (level === "always_ask") {
    return { ...base, decision: "ask", reason: `${label}: every approval-gated action pauses for your decision.` };
  }
  if (rule.neverAuto) {
    return { ...base, decision: "ask", reason: `Asked at every level (${rule.id}): ${rule.reason}` };
  }
  if (level === "full") {
    return { ...base, decision: "run", reason: `${label}: ran without asking (${rule.id}, score ${rule.score}).` };
  }
  if (rule.score <= AUTO_MAX_SCORE) {
    return { ...base, decision: "run", reason: `${label}: ran without asking (${rule.id}, score ${rule.score}): ${rule.reason}` };
  }
  return { ...base, decision: "ask", reason: `${label}: asked (${rule.id}, score ${rule.score}): ${rule.reason}` };
}

/** Per-turn view of the user's level. Read fresh at every gate so a mid-turn switch applies from the next call. */
export type PermissionContext = {
  getLevel: () => Promise<PermissionLevel> | PermissionLevel;
  /** Last level this turn observed, so a switch is journaled exactly once. */
  lastSeen?: PermissionLevel;
};

export async function resolveGate(
  context: PermissionContext | undefined,
  tool: string,
  args: Record<string, unknown>,
): Promise<GateDecision & { changedFrom?: PermissionLevel }> {
  let level: PermissionLevel = DEFAULT_PERMISSION_LEVEL;
  try {
    if (context) level = parsePermissionLevel(await context.getLevel());
  } catch {
    // Fail closed: an unreadable level is Always ask.
  }
  const changedFrom = context?.lastSeen && context.lastSeen !== level ? context.lastSeen : undefined;
  if (context) context.lastSeen = level;
  const decision = decideGate({ level, tool, args });
  return changedFrom
    ? {
        ...decision,
        changedFrom,
        reason: `${decision.reason} Level changed this turn: ${PERMISSION_LEVEL_LABELS[changedFrom]} → ${PERMISSION_LEVEL_LABELS[level]}.`,
      }
    : decision;
}

/**
 * Ceiling imposed by the credential on a request. Browser/app sessions have no
 * ceiling; `rook_` bearer tokens (CLI, gateway, external agents) are capped at
 * Always ask unless the token itself carries an explicit grant minted by the
 * user from a signed-in session. Headers, env vars and request bodies are never read.
 */
export function credentialCeiling(authorization: string | undefined): PermissionLevel {
  const [scheme, token] = (authorization ?? "").split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token?.startsWith(CLI_TOKEN_PREFIX)) return "full";
  return parsePermissionLevel(verifyCliToken(token)?.grant);
}

export const isTokenCredential = (authorization: string | undefined): boolean =>
  /^bearer\s+rook_/i.test(authorization ?? "");

export const effectiveLevel = (userLevel: PermissionLevel, ceiling: PermissionLevel): PermissionLevel =>
  minPermissionLevel(parsePermissionLevel(userLevel), parsePermissionLevel(ceiling));

/**
 * Foreground turn context. The level is read from the user's stored setting on
 * every gate (never from the request body) and capped by the credential used.
 */
export function permissionContextForTurn(input: {
  userId: string;
  request?: { headers?: { authorization?: string } };
}): PermissionContext {
  const ceiling = credentialCeiling(input.request?.headers?.authorization);
  return {
    getLevel: async () => effectiveLevel(await db.getUserPermissionLevel(input.userId), ceiling),
  };
}

/** Activity-trail entry answering "why did this run / ask". Identifiers only, no tool payloads. */
export function permissionTraceStep(decision: GateDecision): AgentTraceStep {
  return {
    kind: "approval",
    title: decision.decision === "run" ? "Ran without asking" : "Asked for your approval",
    detail: decision.reason,
  };
}

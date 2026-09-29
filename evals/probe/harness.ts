/**
 * Probe harness: runs fixed tasks across arms through Rook's real agent loop
 * and reports NUMBERS ONLY. It never stores prompts, responses, tool
 * arguments, headers, tokens or identifiers. Time, randomness, the model call
 * and the session are all injected, so it is fully testable offline.
 */
import type { Request } from "express";
import { ROOK_AGENT_MAX_ROUNDS } from "../../server/ai/agent-reliability";
import type { TurnRecord } from "../../server/ai/telemetry";
import type { RookAgentInput } from "../../server/integrations/excel-agent";
import { mean, pairedBootstrap, seededRng, shuffle, verdictFor, wilson, type Interval, type Verdict } from "./stats";
import type { Task } from "./tasks";
import { setWorld, probeWorld } from "./world";

const OFF = { leanPrompt: false, toolOffload: false, compactPlan: false };
export const ARM_FLAGS = {
  baseline: OFF,
  baseline_repeat: OFF,
  lean_prompt: { ...OFF, leanPrompt: true },
  tool_offload: { ...OFF, toolOffload: true },
  compact_plan: { ...OFF, compactPlan: true },
  all_variants: { leanPrompt: true, toolOffload: true, compactPlan: true },
} as const;
export type ArmId = keyof typeof ARM_FLAGS;
export const DEFAULT_ARMS: ArmId[] = ["baseline", "baseline_repeat", "lean_prompt", "tool_offload", "compact_plan"];
const VARIANT_ARMS: ArmId[] = ["lean_prompt", "tool_offload", "compact_plan", "all_variants"];

export const SHARED_KEY_VARS = ["OPENROUTER_API_KEY", "ORCAROUTER_API_KEY", "TOKENROUTER_API_KEY"] as const;

/** Names only, never values. Empty when the environment can run the probe. */
export function preflightProblems(env: Record<string, string | undefined>, model: string): string[] {
  const problems: string[] = [];
  if (!/^chatgpt:[A-Za-z0-9._-]{1,64}$/.test(model)) problems.push("ROOK_EVAL_MODEL must look like chatgpt:<model-slug>.");
  for (const name of SHARED_KEY_VARS) {
    if (env[name]?.trim()) problems.push(`${name} is set. Unset it: a failed ChatGPT call would silently fall back to the shared route and contaminate the eval.`);
  }
  if (!env.CLERK_SECRET_KEY?.trim()) problems.push("CLERK_SECRET_KEY is required: the existing ChatGPT session path verifies the Clerk token and decrypts the stored session with it.");
  if (!env.ROOK_EVAL_SESSION_TOKEN?.trim() && !env.ROOK_EVAL_SESSION_TOKEN_CMD?.trim()) problems.push("Set ROOK_EVAL_SESSION_TOKEN (a Clerk session JWT) or ROOK_EVAL_SESSION_TOKEN_CMD (a command that prints one).");
  return problems;
}

export type TokenSource = { current(): string; refresh(): Promise<void> };
const JWT = /^[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}$/;
export const looksLikeJwt = (value: string): boolean => JWT.test(value);

/** Static token, or a command re-run when older than `refreshMs`. Token text is never logged or thrown. */
export function createTokenSource(env: Record<string, string | undefined>, exec: (command: string) => Promise<string>, now: () => number, refreshMs = 45_000): TokenSource {
  let token = env.ROOK_EVAL_SESSION_TOKEN?.trim() ?? "";
  let fetchedAt = token ? now() : Number.NEGATIVE_INFINITY;
  const command = env.ROOK_EVAL_SESSION_TOKEN_CMD?.trim();
  return {
    current: () => token,
    async refresh() {
      if (!command || now() - fetchedAt < refreshMs) return;
      const printed = (await exec(command)).trim();
      if (!looksLikeJwt(printed)) throw new Error("The session token command did not print a JWT.");
      token = printed;
      fetchedAt = now();
    },
  };
}

/** The minimal request surface the existing ChatGPT session path reads. */
export const sessionRequest = (source: TokenSource): Request => ({
  protocol: "https",
  header: (name: string) => (name.toLowerCase() === "authorization" ? `Bearer ${source.current()}` : undefined),
}) as unknown as Request;

export type RunResult = { text: string; approvals: unknown[]; computerProposals?: unknown[]; requestId: string; error?: string };
export const INVALID_REASONS = ["exception", "no_telemetry", "fallback_used", "provider_error"] as const;
export type InvalidReason = (typeof INVALID_REASONS)[number];
export type Tokens = { input: number | null; cachedInput: number | null; output: number | null; reasoning: number | null };
export type Trial = {
  task: string; arm: ArmId; rep: number;
  valid: boolean; invalid: InvalidReason | null;
  success: boolean; checksPassed: number; checksTotal: number;
  requests: number; toolCalls: number; toolErrors: number; invalidArguments: number; skippedCalls: number; loadToolsCalls: number;
  approvals: number; tokens: Tokens; latencyMs: number; answerChars: number;
};

export type ProbeOptions = {
  model: string; tasks: readonly Task[]; arms: readonly ArmId[]; reps: number; seed: number;
  maxRequests: number; minIntervalMs: number; maxInvalidRate: number; margin: number; minPairs: number;
  sleep: (ms: number) => Promise<void>;
  session: TokenSource;
  run: (input: RookAgentInput) => Promise<RunResult>;
  telemetry: () => TurnRecord | undefined;
  log?: (line: string) => void;
};

const token = (turn: TurnRecord, key: "input" | "cachedInput" | "output" | "reasoningOutput"): number | null =>
  turn.usage && turn.usage.requests > 0 && turn.usage.unknown[key] === 0 ? (turn.usage.known[key] ?? null) : null;

async function runTrial(o: ProbeOptions, task: Task, arm: ArmId, rep: number): Promise<Trial> {
  setWorld(task.world);
  const blank = { requests: 0, toolCalls: 0, toolErrors: 0, invalidArguments: 0, skippedCalls: 0, loadToolsCalls: 0, approvals: 0,
    tokens: { input: null, cachedInput: null, output: null, reasoning: null }, latencyMs: 0, answerChars: 0 };
  const invalid = (reason: InvalidReason, extra: Partial<Trial> = {}): Trial => ({ task: task.id, arm, rep, valid: false, invalid: reason,
    success: false, checksPassed: 0, checksTotal: task.checks.length, ...blank, ...extra });
  let result: RunResult;
  try {
    result = await o.run({ userId: "eval-user", botId: `eval-${task.id}`, taskId: `eval-${task.id}-${arm}-${rep}`, botName: "Scout",
      botRole: "Helpful teammate", botPurpose: "Help the user get their work done.", model: o.model, message: task.message,
      userTimeZone: "UTC", recentContext: task.recentContext ?? [], ...(task.disallowedTools ? { disallowedTools: task.disallowedTools } : {}),
      request: sessionRequest(o.session), variants: { ...ARM_FLAGS[arm] } });
  } catch {
    return invalid("exception");
  }
  const turn = o.telemetry();
  if (!turn || turn.requestId !== result.requestId) return invalid("no_telemetry");
  const requests = turn.modelRequests?.length ?? 0;
  const outcomes = turn.toolOutcomes ?? [];
  const measured = {
    requests, toolCalls: outcomes.filter((entry) => entry.outcome !== "skipped").length,
    toolErrors: outcomes.filter((entry) => entry.outcome === "error").length,
    invalidArguments: outcomes.filter((entry) => entry.outcome === "invalid_arguments").length,
    skippedCalls: outcomes.filter((entry) => entry.outcome === "skipped").length,
    loadToolsCalls: probeWorld.calls.filter((call) => call.tool === "load_tools").length,
    approvals: result.approvals.length,
    tokens: { input: token(turn, "input"), cachedInput: token(turn, "cachedInput"), output: token(turn, "output"), reasoning: token(turn, "reasoningOutput") },
    latencyMs: turn.latencyMs, answerChars: result.text.length,
  };
  if (turn.fellBack || turn.providers.some((provider) => provider !== "chatgpt")) return invalid("fallback_used", measured);
  if (result.error && !turn.errorCode) return invalid("provider_error", measured);
  const ctx = { text: result.text, calls: [...probeWorld.calls], approvals: result.approvals.length, proposals: result.computerProposals?.length ?? 0, model: o.model };
  const passed = task.checks.filter((check) => { try { return check.pass(ctx); } catch { return false; } }).length;
  return { task: task.id, arm, rep, valid: true, invalid: null, success: passed === task.checks.length, checksPassed: passed, checksTotal: task.checks.length, ...measured };
}

export type Truncation = "none" | "request_cap" | "provider_failures" | "invalid_rate";
export const METRICS = ["success", "requests", "toolCalls", "toolErrors", "inputTokens", "outputTokens", "latencyMs"] as const;
export type MetricName = (typeof METRICS)[number];
const metricOf = (trial: Trial, metric: MetricName): number | null => {
  switch (metric) {
    case "success": return trial.success ? 1 : 0;
    case "requests": return trial.requests;
    case "toolCalls": return trial.toolCalls;
    case "toolErrors": return trial.toolErrors + trial.invalidArguments;
    case "inputTokens": return trial.tokens.input;
    case "outputTokens": return trial.tokens.output;
    case "latencyMs": return trial.latencyMs;
  }
};

export type ArmSummary = { trials: number; valid: number; successes: number; successRate: number; successLo: number; successHi: number;
  meanRequests: number; meanToolCalls: number; meanToolErrors: number; meanInputTokens: number | null; meanOutputTokens: number | null; meanLatencyMs: number };
export type Report = {
  kind: "rook-probe-report"; version: 1; model: string; seed: number; reps: number; tasks: number;
  requestsUsed: number; truncated: Truncation;
  arms: Partial<Record<ArmId, ArmSummary>>;
  noise: Partial<Record<MetricName, Interval>> | null;
  variants: Partial<Record<ArmId, { verdict: Verdict; paired: Partial<Record<MetricName, Interval>> }>>;
  perTask: Record<string, Partial<Record<ArmId, { valid: number; successes: number }>>>;
  trials: Trial[];
};

function pairedIntervals(trials: readonly Trial[], arm: ArmId, base: ArmId, seed: number): Partial<Record<MetricName, Interval>> {
  const byKey = (which: ArmId) => new Map(trials.filter((t) => t.arm === which && t.valid).map((t) => [`${t.task}|${t.rep}`, t]));
  const a = byKey(arm), b = byKey(base);
  const out: Partial<Record<MetricName, Interval>> = {};
  for (const metric of METRICS) {
    const diffs: number[] = [];
    for (const [key, trial] of a) {
      const other = b.get(key);
      const x = other && metricOf(trial, metric), y = other && metricOf(other, metric);
      if (typeof x === "number" && typeof y === "number") diffs.push(x - y);
    }
    out[metric] = pairedBootstrap(diffs, seededRng(seed + METRICS.indexOf(metric)));
  }
  return out;
}

const meanOrNull = (values: Array<number | null>): number | null => {
  const known = values.filter((value): value is number => value !== null);
  return known.length ? mean(known) : null;
};

export function buildReport(trials: Trial[], meta: { model: string; seed: number; reps: number; tasks: number; requestsUsed: number; truncated: Truncation; margin: number; minPairs: number }): Report {
  const arms: Report["arms"] = {};
  const perTask: Report["perTask"] = {};
  for (const arm of Object.keys(ARM_FLAGS) as ArmId[]) {
    const own = trials.filter((t) => t.arm === arm);
    if (!own.length) continue;
    const valid = own.filter((t) => t.valid);
    const successes = valid.filter((t) => t.success).length;
    const w = wilson(successes, valid.length);
    arms[arm] = { trials: own.length, valid: valid.length, successes, successRate: w.p, successLo: w.lo, successHi: w.hi,
      meanRequests: mean(valid.map((t) => t.requests)), meanToolCalls: mean(valid.map((t) => t.toolCalls)),
      meanToolErrors: mean(valid.map((t) => t.toolErrors + t.invalidArguments)),
      meanInputTokens: meanOrNull(valid.map((t) => t.tokens.input)), meanOutputTokens: meanOrNull(valid.map((t) => t.tokens.output)),
      meanLatencyMs: mean(valid.map((t) => t.latencyMs)) };
    for (const t of own) {
      const row = (perTask[t.task] ??= {});
      const cell = (row[arm] ??= { valid: 0, successes: 0 });
      cell.valid += t.valid ? 1 : 0; cell.successes += t.success ? 1 : 0;
    }
  }
  const noise = arms.baseline && arms.baseline_repeat ? pairedIntervals(trials, "baseline_repeat", "baseline", meta.seed) : null;
  const variants: Report["variants"] = {};
  if (arms.baseline) {
    for (const arm of VARIANT_ARMS) {
      if (!arms[arm]) continue;
      const paired = pairedIntervals(trials, arm, "baseline", meta.seed);
      variants[arm] = { paired, verdict: verdictFor({ diff: paired.success!, noise: noise?.success, margin: meta.margin, minPairs: meta.minPairs }) };
    }
  }
  return { kind: "rook-probe-report", version: 1, model: meta.model, seed: meta.seed, reps: meta.reps, tasks: meta.tasks,
    requestsUsed: meta.requestsUsed, truncated: meta.truncated, arms, noise, variants, perTask, trials };
}

/** Throws unless every string in the report is a known label. Keys and numbers are checked for shape. */
export function assertNumbersOnly(report: unknown, labels: Iterable<string>): void {
  const allowed = new Set([...labels, "rook-probe-report", ...Object.keys(ARM_FLAGS), ...INVALID_REASONS, "none", "request_cap", "provider_failures", "invalid_rate",
    "kill", "inconclusive", "pass", "insufficient"]);
  const walk = (value: unknown, path: string): void => {
    if (value === null || typeof value === "boolean") return;
    if (typeof value === "number") { if (!Number.isFinite(value)) throw new Error(`Non-finite number at ${path}`); return; }
    if (typeof value === "string") { if (!allowed.has(value)) throw new Error(`Unexpected text at ${path}`); return; }
    if (Array.isArray(value)) { value.forEach((entry, index) => walk(entry, `${path}[${index}]`)); return; }
    if (typeof value === "object") {
      for (const [key, entry] of Object.entries(value)) {
        if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(key)) throw new Error(`Unexpected key at ${path}`);
        walk(entry, `${path}.${key}`);
      }
      return;
    }
    throw new Error(`Unsupported value at ${path}`);
  };
  walk(report, "report");
}

export async function runProbe(o: ProbeOptions): Promise<Report> {
  const rng = seededRng(o.seed);
  const schedule: Array<{ task: Task; arm: ArmId; rep: number }> = [];
  for (let rep = 1; rep <= o.reps; rep += 1) {
    for (const task of shuffle(o.tasks, rng)) for (const arm of shuffle(o.arms, rng)) schedule.push({ task, arm, rep });
  }
  const trials: Trial[] = [];
  let requestsUsed = 0, infraStreak = 0, truncated: Truncation = "none";
  for (const [index, item] of schedule.entries()) {
    if (requestsUsed + ROOK_AGENT_MAX_ROUNDS > o.maxRequests) { truncated = "request_cap"; break; }
    await o.session.refresh();
    const trial = await runTrial(o, item.task, item.arm, item.rep);
    trials.push(trial);
    requestsUsed += trial.requests;
    infraStreak = trial.invalid === "provider_error" || trial.invalid === "exception" ? infraStreak + 1 : 0;
    o.log?.(`trial ${index + 1}/${schedule.length} arm=${item.arm} valid=${trial.valid} success=${trial.success} requests=${requestsUsed}/${o.maxRequests}`);
    if (infraStreak >= 3) { truncated = "provider_failures"; break; }
    if (trials.length >= 10 && trials.filter((t) => !t.valid).length / trials.length > o.maxInvalidRate) { truncated = "invalid_rate"; break; }
    await o.sleep(o.minIntervalMs * (infraStreak ? 10 : 1));
  }
  return buildReport(trials, { model: o.model, seed: o.seed, reps: o.reps, tasks: o.tasks.length, requestsUsed, truncated, margin: o.margin, minPairs: o.minPairs });
}

const pct = (value: number) => `${(value * 100).toFixed(0)}%`;
const num = (value: number | null, digits = 1) => (value === null ? "n/a" : value.toFixed(digits));
const signed = (interval: Interval | undefined, digits = 2) =>
  interval && interval.n ? `${interval.mean >= 0 ? "+" : ""}${interval.mean.toFixed(digits)} [${interval.lo.toFixed(digits)}, ${interval.hi.toFixed(digits)}] n=${interval.n}` : "n/a";

/** Human-readable table (numbers and arm names only) for the operator's terminal. */
export function renderSummary(report: Report): string {
  const lines = [`probe: ${report.tasks} tasks x ${report.reps} reps, ${report.requestsUsed} model requests, truncated=${report.truncated}`,
    "arm              valid/trials  success (95% CI)      req  toolcalls  toolerr  in-tok  out-tok"];
  for (const [arm, s] of Object.entries(report.arms) as Array<[ArmId, ArmSummary]>) {
    lines.push(`${arm.padEnd(16)} ${`${s.valid}/${s.trials}`.padEnd(13)} ${`${pct(s.successRate)} (${pct(s.successLo)}-${pct(s.successHi)})`.padEnd(21)} ${num(s.meanRequests).padEnd(4)} ${num(s.meanToolCalls).padEnd(10)} ${num(s.meanToolErrors, 2).padEnd(8)} ${num(s.meanInputTokens, 0).padEnd(7)} ${num(s.meanOutputTokens, 0)}`);
  }
  lines.push(`noise (baseline_repeat - baseline) success: ${signed(report.noise?.success)}`);
  for (const [arm, v] of Object.entries(report.variants) as Array<[ArmId, NonNullable<Report["variants"][ArmId]>]>) {
    lines.push(`${arm}: verdict=${v.verdict} success ${signed(v.paired.success)} requests ${signed(v.paired.requests)} toolerr ${signed(v.paired.toolErrors)} in-tok ${signed(v.paired.inputTokens, 0)}`);
  }
  return lines.join("\n");
}

export type EnvOptions = { model: string; arms: ArmId[]; reps: number; seed: number; maxRequests: number; minIntervalMs: number; taskIds: string[] | null; out: string | null };

/** Validated ROOK_EVAL_* settings. Throws with the variable name, never a value. */
export function parseEnvOptions(env: Record<string, string | undefined>): EnvOptions {
  const int = (name: string, fallback: number, min: number, max: number): number => {
    const raw = env[name]?.trim();
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}.`);
    return value;
  };
  const list = (name: string): string[] | null => {
    const raw = env[name]?.trim();
    return raw ? raw.split(",").map((part) => part.trim()).filter(Boolean) : null;
  };
  const armNames = list("ROOK_EVAL_ARMS");
  const arms = (armNames ?? DEFAULT_ARMS) as ArmId[];
  for (const arm of arms) if (!(arm in ARM_FLAGS)) throw new Error("ROOK_EVAL_ARMS contains an unknown arm.");
  const out = env.ROOK_EVAL_OUT?.trim() || null;
  if (out && !/^[A-Za-z0-9_./\\:-]{1,200}\.json$/.test(out)) throw new Error("ROOK_EVAL_OUT must be a simple .json path.");
  return { model: env.ROOK_EVAL_MODEL?.trim() ?? "", arms, reps: int("ROOK_EVAL_REPS", 3, 1, 20), seed: int("ROOK_EVAL_SEED", 20260930, 0, 2 ** 31),
    maxRequests: int("ROOK_EVAL_MAX_REQUESTS", 900, 6, 5000), minIntervalMs: int("ROOK_EVAL_MIN_INTERVAL_MS", 1500, 0, 60_000), taskIds: list("ROOK_EVAL_TASKS"), out };
}

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
import { DEFAULT_REQUEST_TIMEOUT_MS, parseBudget, parseRates, TrialScope, trialScope, type MeterActivity } from "./meter";
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
  for (const check of [() => parseRates(env), () => parseBudget(env)]) {
    try { check(); } catch (error) { problems.push(error instanceof Error ? error.message : "Invalid spend settings."); }
  }
  return problems;
}

export type TokenSource = { current(): string; refresh(): Promise<void> };
const JWT = /^[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}$/;
export const looksLikeJwt = (value: string): boolean => JWT.test(value);

/** Safe to log: messages never contain token text or command output. */
export class SessionTokenError extends Error {
  constructor(message: string) { super(message); this.name = "SessionTokenError"; }
}

/**
 * Static token, or a command re-run when older than `refreshMs`. Token text is never logged or thrown.
 * The command is given `commandTimeoutMs` to finish: a promisified `exec` only settles once the child's stdio
 * closes, so a grandchild holding the pipe would otherwise hang the whole run.
 */
export function createTokenSource(env: Record<string, string | undefined>, exec: (command: string) => Promise<string>, now: () => number, refreshMs = 45_000, commandTimeoutMs = 30_000): TokenSource {
  let token = env.ROOK_EVAL_SESSION_TOKEN?.trim() ?? "";
  let fetchedAt = token ? now() : Number.NEGATIVE_INFINITY;
  const command = env.ROOK_EVAL_SESSION_TOKEN_CMD?.trim();
  return {
    current: () => token,
    async refresh() {
      if (!command || now() - fetchedAt < refreshMs) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let printed: string;
      try {
        printed = (await Promise.race([
          exec(command),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new SessionTokenError(`The session token command did not finish within ${Math.round(commandTimeoutMs / 1000)}s.`)), commandTimeoutMs); }),
        ])).trim();
      } catch (error) {
        throw error instanceof SessionTokenError ? error : new SessionTokenError("The session token command failed.");
      } finally { clearTimeout(timer); }
      if (!looksLikeJwt(printed)) throw new SessionTokenError("The session token command did not print a JWT.");
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
export const INVALID_REASONS = ["exception", "no_telemetry", "fallback_used", "provider_error", "budget", "timeout"] as const;
export type InvalidReason = (typeof INVALID_REASONS)[number];
export type Tokens = { input: number | null; cachedInput: number | null; output: number | null; reasoning: number | null };
export type Trial = {
  task: string; arm: ArmId; rep: number;
  valid: boolean; invalid: InvalidReason | null;
  success: boolean; checksPassed: number; checksTotal: number;
  requests: number; toolCalls: number; toolErrors: number; invalidArguments: number; skippedCalls: number; loadToolsCalls: number;
  approvals: number; tokens: Tokens; latencyMs: number; answerChars: number;
  /** Charged by the spend meter (actual usage x 1.1, estimates for missing usage). */
  costUsd: number; costEstimated: boolean;
  /** Total characters of the first model request, from accounting. A variant is "exposed" on a pair when this differs from the baseline trial. */
  firstRequestChars: number;
};

/** The slice of the spend meter the harness reads. */
export type MeterLike = {
  capUsd: number; ceilingUsd: number;
  spentUsd(): number; remainingUsd(): number; estimatedCharges(): number; tripped(): boolean; clearTrip(): void;
  /** Requests abandoned for exceeding the request timeout (cumulative). */
  timeouts?(): number;
  /** In-flight request state, for the heartbeat. */
  activity?(): MeterActivity;
};

export const DEFAULT_TRIAL_TIMEOUT_MS = 420_000;
export const DEFAULT_HEARTBEAT_MS = 10_000;
export const DEFAULT_STALL_WARN_MS = 30_000;
const DEFAULT_CANCEL_GRACE_MS = 2_000;

export type ProbeOptions = {
  model: string; tasks: readonly Task[]; arms: readonly ArmId[]; seed: number;
  /** Repetitions every arm starts with. */
  reps: number;
  /** Escalate up to this many repetitions, but only when `decide` shows the extra data would be decisive. Defaults to `reps` (no escalation). */
  maxReps?: number;
  decide?: typeof decideEscalation;
  meter: MeterLike;
  maxRequests: number; minIntervalMs: number; maxInvalidRate: number; margin: number; minPairs: number;
  sleep: (ms: number) => Promise<void>;
  session: TokenSource;
  run: (input: RookAgentInput) => Promise<RunResult>;
  telemetry: () => TurnRecord | undefined;
  log?: (line: string) => void;
  /** Wall-clock bound for one trial. On expiry the trial is cancelled, recorded invalid ("timeout"), and the run continues. */
  trialTimeoutMs?: number;
  /** While a trial runs, log a heartbeat this often (0 disables). A line becomes a STALL WARNING after `stallWarnMs` without a finished model request. */
  heartbeatMs?: number;
  stallWarnMs?: number;
  /** How long a cancelled trial gets to unwind before it is abandoned. */
  cancelGraceMs?: number;
  /** Called after every trial with the report so far (`truncated: "in_progress"`), so a killed run still leaves numbers. */
  checkpoint?: (report: Report) => void;
  /** Operator stop (SIGINT/SIGTERM): the current trial is dropped and the run ends with `truncated: "interrupted"`. */
  stop?: AbortSignal;
};

const token = (turn: TurnRecord, key: "input" | "cachedInput" | "output" | "reasoningOutput"): number | null =>
  turn.usage && turn.usage.requests > 0 && turn.usage.unknown[key] === 0 ? (turn.usage.known[key] ?? null) : null;

const seconds = (ms: number) => `${Math.max(0, Math.round(ms / 1000))}s`;

type Bounded<T> = { kind: "done"; value: T } | { kind: "failed" } | { kind: "timeout"; abandoned: boolean } | { kind: "stopped" };

/** Races a trial against its deadline and the operator stop. Cancels the trial's scope when it loses, then gives it a short grace to unwind. */
async function boundTrial<T>(running: Promise<T>, scope: TrialScope, timeoutMs: number, graceMs: number, stop: AbortSignal | undefined): Promise<Bounded<T>> {
  const outcome = running.then((value): Bounded<T> => ({ kind: "done", value }), (): Bounded<T> => ({ kind: "failed" }));
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const expiry = new Promise<Bounded<T>>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "timeout", abandoned: false }), timeoutMs);
    if (stop) { onAbort = () => resolve({ kind: "stopped" }); if (stop.aborted) onAbort(); else stop.addEventListener("abort", onAbort, { once: true }); }
  });
  try {
    const first = await Promise.race([outcome, expiry]);
    if (first.kind === "done" || first.kind === "failed") return first;
    scope.cancel();
    let grace: ReturnType<typeof setTimeout> | undefined;
    const unwound = await Promise.race([outcome.then(() => true), new Promise<false>((resolve) => { grace = setTimeout(() => resolve(false), graceMs); })]);
    clearTimeout(grace);
    return first.kind === "timeout" ? { kind: "timeout", abandoned: !unwound } : first;
  } finally {
    clearTimeout(timer);
    if (onAbort) stop?.removeEventListener("abort", onAbort);
  }
}

/** Periodic proof of life while a trial runs, so a hang shows up in the log instead of as silence. */
function startHeartbeat(o: ProbeOptions, label: string, startedAt: number, timeoutMs: number): () => void {
  const every = o.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  if (!o.log || every <= 0) return () => undefined;
  const warnAfter = o.stallWarnMs ?? DEFAULT_STALL_WARN_MS;
  const timer = setInterval(() => {
    const now = Date.now();
    const activity = o.meter.activity?.();
    const quiet = now - Math.max(startedAt, activity?.lastCompletionAt ?? 0);
    const wire = activity ? `; ${activity.inFlight} model request${activity.inFlight === 1 ? "" : "s"} in flight${activity.inFlight ? ` (oldest ${seconds(activity.oldestInFlightMs)})` : ""}` : "";
    o.log!(`${quiet >= warnAfter ? "STALL WARNING: " : ""}${label} running ${seconds(now - startedAt)}, no model request has finished for ${seconds(quiet)}${wire}; abandoned at ${seconds(timeoutMs)}`);
  }, every);
  (timer as { unref?: () => void }).unref?.();
  return () => clearInterval(timer);
}

async function runTrial(o: ProbeOptions, task: Task, arm: ArmId, rep: number, number: number): Promise<Trial> {
  setWorld(task.world);
  const blank = { requests: 0, toolCalls: 0, toolErrors: 0, invalidArguments: 0, skippedCalls: 0, loadToolsCalls: 0, approvals: 0,
    tokens: { input: null, cachedInput: null, output: null, reasoning: null }, latencyMs: 0, answerChars: 0, costUsd: 0, costEstimated: false, firstRequestChars: 0 };
  const spentBefore = o.meter.spentUsd(), estimatedBefore = o.meter.estimatedCharges(), timeoutsBefore = o.meter.timeouts?.() ?? 0;
  const invalid = (reason: InvalidReason, extra: Partial<Trial> = {}): Trial => ({ task: task.id, arm, rep, valid: false, invalid: reason,
    success: false, checksPassed: 0, checksTotal: task.checks.length, ...blank, ...extra });
  let result: RunResult;
  const settle = (): Pick<Trial, "costUsd" | "costEstimated"> => ({ costUsd: o.meter.spentUsd() - spentBefore, costEstimated: o.meter.estimatedCharges() > estimatedBefore });
  const timeoutMs = o.trialTimeoutMs ?? DEFAULT_TRIAL_TIMEOUT_MS;
  const startedAt = Date.now();
  const stopBeat = startHeartbeat(o, `trial ${number} (task=${task.id} arm=${arm} rep=${rep})`, startedAt, timeoutMs);
  const scope = new TrialScope();
  try {
    const running = trialScope.run(scope, () => o.run({ userId: "eval-user", botId: `eval-${task.id}`, taskId: `eval-${task.id}-${arm}-${rep}`, botName: "Scout",
      botRole: "Helpful teammate", botPurpose: "Help the user get their work done.", model: o.model, message: task.message,
      userTimeZone: "UTC", recentContext: task.recentContext ?? [], ...(task.disallowedTools ? { disallowedTools: task.disallowedTools } : {}),
      request: sessionRequest(o.session), variants: { ...ARM_FLAGS[arm] } }));
    const bounded = await boundTrial(running, scope, timeoutMs, o.cancelGraceMs ?? DEFAULT_CANCEL_GRACE_MS, o.stop);
    if (bounded.kind === "timeout") {
      o.log?.(`trial ${number} (task=${task.id} arm=${arm} rep=${rep}) exceeded ${seconds(timeoutMs)} and was cancelled${bounded.abandoned ? "; it did not unwind and is abandoned" : ""}; recorded invalid (timeout)`);
      return invalid("timeout", settle());
    }
    if (bounded.kind === "stopped") return invalid("exception", settle());
    if (bounded.kind === "failed") return o.meter.tripped() ? invalid("budget", settle()) : (o.meter.timeouts?.() ?? 0) > timeoutsBefore ? invalid("timeout", settle()) : invalid("exception", settle());
    result = bounded.value;
  } finally {
    stopBeat();
  }
  if ((o.meter.timeouts?.() ?? 0) > timeoutsBefore) return invalid("timeout", settle());
  if (o.meter.tripped()) return invalid("budget", settle());
  const turn = o.telemetry();
  if (!turn || turn.requestId !== result.requestId) return invalid("no_telemetry", settle());
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
    latencyMs: turn.latencyMs, answerChars: result.text.length, ...settle(),
    firstRequestChars: Object.values(turn.modelRequests?.[0]?.inputCharacters ?? {}).reduce((sum, n) => sum + n, 0),
  };
  if (turn.fellBack || turn.providers.some((provider) => provider !== "chatgpt")) return invalid("fallback_used", measured);
  if (result.error && !turn.errorCode) return invalid("provider_error", measured);
  const ctx = { text: result.text, calls: [...probeWorld.calls], approvals: result.approvals.length, proposals: result.computerProposals?.length ?? 0, model: o.model };
  const passed = task.checks.filter((check) => { try { return check.pass(ctx); } catch { return false; } }).length;
  return { task: task.id, arm, rep, valid: true, invalid: null, success: passed === task.checks.length, checksPassed: passed, checksTotal: task.checks.length, ...measured };
}

export type Truncation = "none" | "request_cap" | "provider_failures" | "invalid_rate" | "budget_cap" | "trial_timeout" | "interrupted" | "session_refresh" | "aborted" | "in_progress";
export const METRICS = ["success", "requests", "toolCalls", "toolErrors", "inputTokens", "outputTokens", "latencyMs", "costUsd"] as const;
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
    case "costUsd": return trial.costUsd;
  }
};

export type ArmSummary = { trials: number; valid: number; successes: number; successRate: number; successLo: number; successHi: number;
  meanRequests: number; meanToolCalls: number; meanToolErrors: number; meanInputTokens: number | null; meanOutputTokens: number | null; meanLatencyMs: number; meanCostUsd: number };

export const ESCALATION_REASONS = ["go", "disabled", "max_reps_reached", "phase1_truncated", "noise_unmeasured", "no_undecided_variant", "noise_cannot_resolve", "over_budget"] as const;
export type EscalationReason = (typeof ESCALATION_REASONS)[number];
export type Escalation = {
  decision: "go" | "stop"; reason: EscalationReason; repsRun: number; maxReps: number;
  undecidedArms: ArmId[]; resolvableArms: ArmId[];
  observedDisagreement: number; repsNeededForPass: number; projectedCostUsd: number; remainingUsd: number;
};
export const SCOREBOARD_REASONS = ["success_regression", "success_parity_not_shown", "insufficient_data", "saving_not_demonstrated", "tool_errors_increased", "cost_mostly_estimated"] as const;
export type ScoreboardReason = (typeof SCOREBOARD_REASONS)[number];
export type ScoreboardRow = {
  arm: ArmId; verdict: Verdict; decision: "ship" | "no-ship"; reasons: ScoreboardReason[];
  /** All matched valid pairs, and the subset the variant changed (the basis of every field below except `suite*`). */
  pairs: number; exposedPairs: number;
  matchedSuccessBaseline: number; matchedSuccessVariant: number; successDiff: Interval; suiteSuccessDiff: Interval;
  costPerTaskBaseline: number; costPerTaskVariant: number; costSavingPct: number; costDiff: Interval; suiteCostSavingPct: number;
  inputTokenSavingPct: number | null; inputTokensDiff: Interval; outputTokensDiff: Interval; requestsDiff: Interval; toolErrorsDiff: Interval;
  estimatedCostShare: number;
};
export type Report = {
  kind: "rook-probe-report"; version: 2; model: string; seed: number; reps: number; maxReps: number; tasks: number;
  requestsUsed: number; truncated: Truncation;
  budget: { capUsd: number; ceilingUsd: number; spentUsd: number; runSpentUsd: number; estimatedCharges: number };
  escalation: Escalation | null;
  arms: Partial<Record<ArmId, ArmSummary>>;
  noise: Partial<Record<MetricName, Interval>> | null;
  variants: Partial<Record<ArmId, { verdict: Verdict; paired: Partial<Record<MetricName, Interval>> }>>;
  scoreboard: ScoreboardRow[];
  perTask: Record<string, Partial<Record<ArmId, { valid: number; successes: number }>>>;
  trials: Trial[];
};

const pairMap = (trials: readonly Trial[], arm: ArmId) => new Map(trials.filter((t) => t.arm === arm && t.valid).map((t) => [`${t.task}|${t.rep}`, t]));

function pairedIntervals(trials: readonly Trial[], arm: ArmId, base: ArmId, seed: number, only?: ReadonlySet<string>): Partial<Record<MetricName, Interval>> {
  const a = pairMap(trials, arm), b = pairMap(trials, base);
  const out: Partial<Record<MetricName, Interval>> = {};
  for (const metric of METRICS) {
    const diffs: number[] = [];
    for (const [key, trial] of a) {
      if (only && !only.has(key)) continue;
      const other = b.get(key);
      const x = other && metricOf(trial, metric), y = other && metricOf(other, metric);
      if (typeof x === "number" && typeof y === "number") diffs.push(x - y);
    }
    out[metric] = pairedBootstrap(diffs, seededRng(seed + METRICS.indexOf(metric)));
  }
  return out;
}

/** Share of matched pairs whose success differs between two arms. */
export function disagreement(trials: readonly Trial[], arm: ArmId, base: ArmId, only?: ReadonlySet<string>): number {
  const a = pairMap(trials, arm), b = pairMap(trials, base);
  let pairs = 0, differ = 0;
  for (const [key, trial] of a) { const other = b.get(key); if (!other || (only && !only.has(key))) continue; pairs += 1; if (trial.success !== other.success) differ += 1; }
  return pairs ? differ / pairs : 0;
}

const meanOrNull = (values: Array<number | null>): number | null => {
  const known = values.filter((value): value is number => value !== null);
  return known.length ? mean(known) : null;
};

/** Keys of matched valid pairs where the variant actually changed the first request. */
export function exposedKeys(trials: readonly Trial[], arm: ArmId): Set<string> {
  const a = pairMap(trials, arm), b = pairMap(trials, "baseline");
  return new Set([...a.keys()].filter((key) => b.has(key) && a.get(key)!.firstRequestChars !== b.get(key)!.firstRequestChars));
}

/**
 * One variant's row. Success parity, savings and every decision input use EXPOSED pairs
 * (those the variant changed), because averaging in tasks it never touches dilutes both a
 * regression and a saving. Suite-wide figures are reported beside them, unfiltered.
 */
function scoreRow(trials: readonly Trial[], arm: ArmId, global: Partial<Record<MetricName, Interval>>, exposed: Partial<Record<MetricName, Interval>>, verdict: Verdict, exposure: ReadonlySet<string>): ScoreboardRow {
  const a = pairMap(trials, arm), b = pairMap(trials, "baseline");
  const keys = [...exposure].sort();
  const mine = keys.map((key) => a.get(key)!), base = keys.map((key) => b.get(key)!);
  const zero: Interval = { n: 0, mean: 0, lo: 0, hi: 0 };
  const costBase = mean(base.map((t) => t.costUsd)), costVar = mean(mine.map((t) => t.costUsd));
  const inBase = meanOrNull(base.map((t) => t.tokens.input)), inDiff = exposed.inputTokens ?? zero;
  const costDiff = exposed.costUsd ?? zero, toolErrors = exposed.toolErrors ?? zero;
  const estimatedCostShare = mine.length ? mine.filter((t) => t.costEstimated).length / mine.length : 0;
  const allPairs = [...a.keys()].filter((key) => b.has(key));
  const suiteBase = mean(allPairs.map((key) => b.get(key)!.costUsd)), suiteVar = mean(allPairs.map((key) => a.get(key)!.costUsd));
  const reasons: ScoreboardReason[] = [];
  if (verdict === "kill") reasons.push("success_regression");
  else if (verdict === "inconclusive") reasons.push("success_parity_not_shown");
  else if (verdict === "insufficient") reasons.push("insufficient_data");
  if (verdict === "pass" && !(costDiff.n > 0 && costDiff.hi < 0)) reasons.push("saving_not_demonstrated");
  if (toolErrors.n > 0 && toolErrors.lo > 0) reasons.push("tool_errors_increased");
  if (estimatedCostShare > 0.1) reasons.push("cost_mostly_estimated");
  return { arm, verdict, decision: reasons.length ? "no-ship" : "ship", reasons, pairs: allPairs.length, exposedPairs: keys.length,
    matchedSuccessBaseline: mean(base.map((t) => (t.success ? 1 : 0))), matchedSuccessVariant: mean(mine.map((t) => (t.success ? 1 : 0))),
    successDiff: exposed.success ?? zero, suiteSuccessDiff: global.success ?? zero,
    costPerTaskBaseline: costBase, costPerTaskVariant: costVar, costSavingPct: costBase > 0 ? (costBase - costVar) / costBase : 0, costDiff,
    suiteCostSavingPct: suiteBase > 0 ? (suiteBase - suiteVar) / suiteBase : 0,
    inputTokenSavingPct: inBase ? -inDiff.mean / inBase : null, inputTokensDiff: inDiff,
    outputTokensDiff: exposed.outputTokens ?? zero, requestsDiff: exposed.requests ?? zero, toolErrorsDiff: toolErrors, estimatedCostShare };
}

export type ReportMeta = { model: string; seed: number; reps: number; maxReps: number; tasks: number; requestsUsed: number; truncated: Truncation; margin: number; minPairs: number;
  budget: Report["budget"]; escalation: Escalation | null };

export function buildReport(trials: Trial[], meta: ReportMeta): Report {
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
      meanLatencyMs: mean(valid.map((t) => t.latencyMs)), meanCostUsd: mean(valid.map((t) => t.costUsd)) };
    for (const t of own) {
      const row = (perTask[t.task] ??= {});
      const cell = (row[arm] ??= { valid: 0, successes: 0 });
      cell.valid += t.valid ? 1 : 0; cell.successes += t.success ? 1 : 0;
    }
  }
  const noise = arms.baseline && arms.baseline_repeat ? pairedIntervals(trials, "baseline_repeat", "baseline", meta.seed) : null;
  const variants: Report["variants"] = {};
  const scoreboard: ScoreboardRow[] = [];
  if (arms.baseline) {
    for (const arm of VARIANT_ARMS) {
      if (!arms[arm]) continue;
      const global = pairedIntervals(trials, arm, "baseline", meta.seed);
      const exposure = exposedKeys(trials, arm);
      const exposed = pairedIntervals(trials, arm, "baseline", meta.seed, exposure);
      // Noise is measured on the same tasks the variant touched.
      const noiseHere = arms.baseline_repeat ? pairedIntervals(trials, "baseline_repeat", "baseline", meta.seed, exposure).success : undefined;
      const verdict = verdictFor({ diff: exposed.success!, noise: noiseHere, margin: meta.margin, minPairs: meta.minPairs });
      variants[arm] = { paired: exposed, verdict };
      scoreboard.push(scoreRow(trials, arm, global, exposed, verdict, exposure));
    }
  }
  return { kind: "rook-probe-report", version: 2, model: meta.model, seed: meta.seed, reps: meta.reps, maxReps: meta.maxReps, tasks: meta.tasks,
    requestsUsed: meta.requestsUsed, truncated: meta.truncated, budget: meta.budget, escalation: meta.escalation, arms, noise, variants, scoreboard, perTask, trials };
}

export type EscalationInput = {
  enabled: boolean; truncated: Truncation; repsRun: number; maxReps: number; margin: number; minPairs: number; tasks: number;
  noise: Interval | undefined;
  /** Undecided variants are the ones whose verdict is `inconclusive`; killed and passed arms stop receiving data. */
  variants: Array<{ arm: ArmId; verdict: Verdict; diff: Interval; disagreement: number }>;
  costPerTrialUsd: number; armsInNextPhase: (arms: ArmId[]) => number; remainingUsd: number;
};

/**
 * More repetitions are justified only when they would be decisive: an undecided
 * variant's interval, shrunk by sqrt(repsRun / maxReps) with its mean held
 * fixed, must reach a pass (lower bound within the margin) or a kill (upper
 * bound below zero). If even that optimistic projection cannot decide, more
 * data is noise-chasing and is not bought. The projection must also fit in the
 * remaining budget with a 25% safety margin.
 */
export function decideEscalation(input: EscalationInput): Escalation {
  const base = { repsRun: input.repsRun, maxReps: input.maxReps, undecidedArms: [] as ArmId[], resolvableArms: [] as ArmId[],
    observedDisagreement: 0, repsNeededForPass: 0, projectedCostUsd: 0, remainingUsd: input.remainingUsd };
  const stop = (reason: EscalationReason, extra: Partial<Escalation> = {}): Escalation => ({ ...base, ...extra, decision: "stop", reason });
  if (!input.enabled) return stop("disabled");
  if (input.repsRun >= input.maxReps) return stop("max_reps_reached");
  if (input.truncated !== "none") return stop("phase1_truncated");
  if (!input.noise || input.noise.n < input.minPairs) return stop("noise_unmeasured");
  const undecided = input.variants.filter((v) => v.verdict === "inconclusive");
  if (!undecided.length) return stop("no_undecided_variant");
  const observedDisagreement = Math.max(...undecided.map((v) => v.disagreement));
  const repsNeededForPass = Math.ceil((3.8416 * observedDisagreement) / (input.margin * input.margin) / input.tasks);
  const shrink = Math.sqrt(input.repsRun / input.maxReps);
  const resolvable = undecided.filter((v) => {
    const half = ((v.diff.hi - v.diff.lo) / 2) * shrink;
    return v.diff.mean - half >= -input.margin || v.diff.mean + half < 0;
  }).map((v) => v.arm);
  const extra = { undecidedArms: undecided.map((v) => v.arm), observedDisagreement, repsNeededForPass };
  if (!resolvable.length) return stop("noise_cannot_resolve", extra);
  const extraTrials = (input.maxReps - input.repsRun) * input.tasks * input.armsInNextPhase(resolvable);
  const projectedCostUsd = extraTrials * input.costPerTrialUsd * 1.25;
  if (projectedCostUsd > input.remainingUsd) return stop("over_budget", { ...extra, resolvableArms: resolvable, projectedCostUsd });
  return { ...base, ...extra, decision: "go", reason: "go", resolvableArms: resolvable, projectedCostUsd };
}

export const REPORT_LABELS = [...ESCALATION_REASONS, ...SCOREBOARD_REASONS, "ship", "no-ship", "go", "stop", "neither"] as const;

/** Throws unless every string in the report is a known label. Keys and numbers are checked for shape. */
export function assertNumbersOnly(report: unknown, labels: Iterable<string>): void {
  const allowed = new Set([...labels, ...REPORT_LABELS, "rook-probe-report", ...Object.keys(ARM_FLAGS), ...INVALID_REASONS, "none", "request_cap", "provider_failures", "invalid_rate", "budget_cap", "trial_timeout", "interrupted", "session_refresh", "aborted", "in_progress",
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

/** Rejects with `message` if `work` has not settled within `ms`; the timer never outlives the race. */
export async function withDeadline<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]);
  } finally { clearTimeout(timer); }
}

const safeMessage = (error: unknown): string => error instanceof SessionTokenError ? error.message : `${error instanceof Error ? error.name : "Error"}: ${error instanceof Error ? error.message : "unknown"}`.slice(0, 200);

export async function runProbe(o: ProbeOptions): Promise<Report> {
  const maxReps = Math.max(o.reps, o.maxReps ?? o.reps);
  const decide = o.decide ?? decideEscalation;
  const startSpend = o.meter.spentUsd();
  const trials: Trial[] = [];
  let requestsUsed = 0, infraStreak = 0, truncated: Truncation = "none";
  let escalation: Escalation | null = null;
  let arms: ArmId[] = [...o.arms];

  const meta = (): ReportMeta => ({ model: o.model, seed: o.seed, reps: o.reps, maxReps, tasks: o.tasks.length, requestsUsed, truncated, margin: o.margin, minPairs: o.minPairs,
    budget: { capUsd: o.meter.capUsd, ceilingUsd: o.meter.ceilingUsd, spentUsd: o.meter.spentUsd(), runSpentUsd: o.meter.spentUsd() - startSpend, estimatedCharges: o.meter.estimatedCharges() }, escalation });

  const checkpoint = () => {
    if (!o.checkpoint) return;
    try { o.checkpoint(buildReport([...trials], { ...meta(), truncated: "in_progress" })); } catch (error) { o.log?.(`checkpoint report could not be written (${safeMessage(error)})`); }
  };
  /** A refresh that keeps failing ends the run with a report instead of an exception. */
  const refreshSession = async (): Promise<boolean> => {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try { await o.session.refresh(); return true; } catch (error) { o.log?.(`session token refresh failed (attempt ${attempt} of 2): ${error instanceof SessionTokenError ? error.message : "unexpected error"}`); }
    }
    return false;
  };

  const runReps = async (from: number, to: number): Promise<void> => {
    for (let rep = from; rep <= to && truncated === "none"; rep += 1) {
      // Each repetition is shuffled from its own seed, so a rep's order never depends on how many reps were planned.
      const rng = seededRng(o.seed + rep * 7919);
      const schedule = shuffle(o.tasks, rng).flatMap((task) => shuffle(arms, rng).map((arm) => ({ task, arm })));
      for (const item of schedule) {
        if (o.stop?.aborted) { truncated = "interrupted"; return; }
        const valid = trials.filter((t) => t.valid);
        const typical = valid.length ? mean(valid.map((t) => t.costUsd)) : 0;
        if (requestsUsed + ROOK_AGENT_MAX_ROUNDS > o.maxRequests) { truncated = "request_cap"; return; }
        if (o.meter.remainingUsd() < typical * 1.5) { truncated = "budget_cap"; return; }
        if (!(await refreshSession())) { truncated = "session_refresh"; return; }
        const trial = await runTrial(o, item.task, item.arm, rep, trials.length + 1);
        if (o.stop?.aborted) { truncated = "interrupted"; return; }
        trials.push(trial);
        requestsUsed += trial.requests;
        const hitBudget = o.meter.tripped(); o.meter.clearTrip();
        infraStreak = trial.invalid === "provider_error" || trial.invalid === "exception" || trial.invalid === "timeout" ? infraStreak + 1 : 0;
        o.log?.(`trial ${trials.length} task=${item.task.id} rep=${rep} arm=${item.arm} valid=${trial.valid}${trial.invalid ? ` invalid=${trial.invalid}` : ""} success=${trial.success} spent=$${o.meter.spentUsd().toFixed(2)}/$${o.meter.capUsd}`);
        checkpoint();
        if (hitBudget) { truncated = "budget_cap"; return; }
        if (infraStreak >= 3) { truncated = trial.invalid === "timeout" ? "trial_timeout" : "provider_failures"; return; }
        if (trials.length >= 10 && trials.filter((t) => !t.valid).length / trials.length > o.maxInvalidRate) { truncated = "invalid_rate"; return; }
        await o.sleep(o.minIntervalMs * (infraStreak ? 10 : 1));
      }
    }
  };

  try {
    await runPhases();
  } catch (error) {
    // Whatever went wrong, the trials already run are worth keeping.
    truncated = "aborted";
    o.log?.(`probe stopped by an unexpected error (${safeMessage(error)}); reporting the ${trials.length} completed trials`);
  }
  return buildReport(trials, meta());

  async function runPhases(): Promise<void> {
    await runReps(1, o.reps);
    if (maxReps > o.reps) {
      const interim = buildReport(trials, meta());
      const valid = trials.filter((t) => t.valid);
      escalation = decide({ enabled: true, truncated, repsRun: o.reps, maxReps, margin: o.margin, minPairs: o.minPairs, tasks: o.tasks.length,
        noise: interim.noise?.success,
        variants: interim.scoreboard.map((row) => ({ arm: row.arm, verdict: row.verdict, diff: row.successDiff, disagreement: disagreement(trials, row.arm, "baseline", exposedKeys(trials, row.arm)) })),
        costPerTrialUsd: valid.length ? mean(valid.map((t) => t.costUsd)) : 0, armsInNextPhase: (resolvable) => resolvable.length + 2, remainingUsd: o.meter.remainingUsd() });
      o.log?.(`escalation: ${escalation.decision} (${escalation.reason})`);
      if (escalation.decision === "go") {
        const next: ArmId[] = ["baseline", "baseline_repeat", ...escalation.resolvableArms];
        arms = next.filter((arm) => o.arms.includes(arm));
        await runReps(o.reps + 1, maxReps);
      }
    }
  }
}

const pct = (value: number) => `${(value * 100).toFixed(0)}%`;
const num = (value: number | null, digits = 1) => (value === null ? "n/a" : value.toFixed(digits));
const signed = (interval: Interval | undefined, digits = 2) =>
  interval && interval.n ? `${interval.mean >= 0 ? "+" : ""}${interval.mean.toFixed(digits)} [${interval.lo.toFixed(digits)}, ${interval.hi.toFixed(digits)}] n=${interval.n}` : "n/a";
const usd = (value: number) => `$${value.toFixed(4)}`;

/** Human-readable scoreboard (numbers and fixed labels only) for the operator's terminal. */
export function renderSummary(report: Report): string {
  const b = report.budget;
  const lines = [`probe: ${report.tasks} tasks, reps ${report.reps}${report.maxReps > report.reps ? `..${report.maxReps}` : ""}, ${report.requestsUsed} model requests, truncated=${report.truncated}`,
    `spend: $${b.runSpentUsd.toFixed(2)} this run, $${b.spentUsd.toFixed(2)} cumulative of $${b.capUsd} cap (stops at $${b.ceilingUsd.toFixed(2)}); ${b.estimatedCharges} charges estimated from missing usage`];
  if (report.escalation) {
    const e = report.escalation;
    lines.push(`escalation: ${e.decision} (${e.reason}); disagreement ${pct(e.observedDisagreement)}, reps needed for a pass at that disagreement ${e.repsNeededForPass}, projected extra $${e.projectedCostUsd.toFixed(2)} vs remaining $${e.remainingUsd.toFixed(2)}`);
  }
  lines.push("", "arm              valid/trials  success (95% CI)      req  toolerr  in-tok  out-tok  $/task");
  for (const [arm, s] of Object.entries(report.arms) as Array<[ArmId, ArmSummary]>) {
    lines.push(`${arm.padEnd(16)} ${`${s.valid}/${s.trials}`.padEnd(13)} ${`${pct(s.successRate)} (${pct(s.successLo)}-${pct(s.successHi)})`.padEnd(21)} ${num(s.meanRequests).padEnd(4)} ${num(s.meanToolErrors, 2).padEnd(8)} ${num(s.meanInputTokens, 0).padEnd(7)} ${num(s.meanOutputTokens, 0).padEnd(8)} ${usd(s.meanCostUsd)}`);
  }
  lines.push(`noise (baseline_repeat - baseline) success: ${signed(report.noise?.success)}`, "", "SCOREBOARD (matched pairs; ship only with measured success parity and a demonstrated saving)");
  for (const row of report.scoreboard) {
    lines.push(`${row.arm}: ${row.decision.toUpperCase()}${row.reasons.length ? ` [${row.reasons.join(", ")}]` : ""}`,
      `  exposed pairs ${row.exposedPairs} of ${row.pairs}; success ${pct(row.matchedSuccessBaseline)} -> ${pct(row.matchedSuccessVariant)} diff ${signed(row.successDiff)} verdict=${row.verdict} (suite-wide diff ${signed(row.suiteSuccessDiff)})`,
      `  cost/task ${usd(row.costPerTaskBaseline)} -> ${usd(row.costPerTaskVariant)} (${row.costSavingPct >= 0 ? "-" : "+"}${pct(Math.abs(row.costSavingPct))}) diff ${signed(row.costDiff, 5)}; suite-wide saving ${pct(row.suiteCostSavingPct)}`,
      `  input tokens saving ${row.inputTokenSavingPct === null ? "n/a" : pct(row.inputTokenSavingPct)}; requests ${signed(row.requestsDiff)}; tool errors ${signed(row.toolErrorsDiff)}; output tokens ${signed(row.outputTokensDiff, 0)}`);
  }
  return lines.join("\n");
}

export type EnvOptions = { model: string; arms: ArmId[]; reps: number; maxReps: number; seed: number; maxRequests: number; minIntervalMs: number; trialTimeoutMs: number; requestTimeoutMs: number; taskIds: string[] | null; out: string | null; ledger: string | null };

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
  const path = (name: string): string | null => {
    const raw = env[name]?.trim() || null;
    if (raw && !/^[A-Za-z0-9_./\\:-]{1,200}\.json$/.test(raw)) throw new Error(`${name} must be a simple .json path.`);
    return raw;
  };
  const armNames = list("ROOK_EVAL_ARMS");
  const arms = (armNames ?? DEFAULT_ARMS) as ArmId[];
  for (const arm of arms) if (!(arm in ARM_FLAGS)) throw new Error("ROOK_EVAL_ARMS contains an unknown arm.");
  const escalate = (env.ROOK_EVAL_ESCALATE?.trim() || "auto").toLowerCase();
  if (escalate !== "auto" && escalate !== "off") throw new Error("ROOK_EVAL_ESCALATE must be auto or off.");
  const reps = int("ROOK_EVAL_REPS", 5, 1, 20);
  const maxReps = escalate === "off" ? reps : int("ROOK_EVAL_MAX_REPS", 10, reps, 20);
  const trialTimeoutMs = int("ROOK_EVAL_TRIAL_TIMEOUT_MS", DEFAULT_TRIAL_TIMEOUT_MS, 10_000, 3_600_000);
  const requestTimeoutMs = int("ROOK_EVAL_REQUEST_TIMEOUT_MS", Math.min(DEFAULT_REQUEST_TIMEOUT_MS, trialTimeoutMs), 5_000, 3_600_000);
  if (requestTimeoutMs > trialTimeoutMs) throw new Error("ROOK_EVAL_REQUEST_TIMEOUT_MS must not exceed ROOK_EVAL_TRIAL_TIMEOUT_MS.");
  return { model: env.ROOK_EVAL_MODEL?.trim() ?? "", arms, reps, maxReps, trialTimeoutMs, requestTimeoutMs, seed: int("ROOK_EVAL_SEED", 20260930, 0, 2 ** 31),
    maxRequests: int("ROOK_EVAL_MAX_REQUESTS", 3000, 6, 20_000), minIntervalMs: int("ROOK_EVAL_MIN_INTERVAL_MS", 1500, 0, 60_000),
    taskIds: list("ROOK_EVAL_TASKS"), out: path("ROOK_EVAL_OUT"), ledger: path("ROOK_EVAL_LEDGER") };
}

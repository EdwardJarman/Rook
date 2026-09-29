/**
 * Minimal per-turn telemetry (v2 loop-mode).
 *
 * An in-memory ring buffer of recent agent turns: request id, latency,
 * resolved model, tools used, approvals, and errors. Deliberately
 * dependency-free and per-process (on serverless each instance keeps its
 * own window — good enough for live debugging via `trpc.ai.turns`, not a
 * billing ledger).
 *
 * Never records: user ids, bot names, message bodies, tool arguments, or
 * any secret material. Only shapes and timings.
 */

import { toolUsageStats, type ToolOutcomeRecord } from "./tool-metrics";
import { accountingTurnRecorded, markAccountingTurnRecorded, requestAccountingSnapshot, summarizeUsage, type ModelRequestRecord, type UsageTotals } from "./request-accounting";

export type TurnRecord = {
  kind?: "main" | "btw";
  requestId: string;
  at: string;
  latencyMs: number;
  model: string;
  requestedModel: string;
  fellBack: boolean;
  providers: string[];
  tools: string[];
  /** One entry per model-requested tool call, including skipped duplicates. Codes only. */
  toolOutcomes?: ToolOutcomeRecord[];
  approvals: number;
  computerProposals: number;
  webSearched: boolean;
  codeTask: boolean;
  /** Enabled experimental variants (names only) for eval attribution. */
  variants?: string[];
  continuations?: number;
  error?: string;
  /** Set when the turn ended on a deliberate loop stop (e.g. DOOM_LOOP), not a provider failure. */
  errorCode?: string;
  /** Opaque process-local HMAC; never the user, Bot or task id. */
  taskKey?: string;
  modelRequests?: ModelRequestRecord[];
  usage?: UsageTotals;
  /** Early exits have incomplete tool/approval counts, but retain all observed inference requests. */
  interrupted?: boolean;
};

const MAX_TURNS = 100;
const turns: TurnRecord[] = [];

export function recordTurn(record: TurnRecord): void {
  markAccountingTurnRecorded();
  const accounting = requestAccountingSnapshot();
  const enriched = { ...accounting, ...record };
  if (enriched.modelRequests) enriched.usage = summarizeUsage(enriched.modelRequests);
  turns.push(enriched);
  if (turns.length > MAX_TURNS) turns.splice(0, turns.length - MAX_TURNS);
}

/** Preserve request spend when a detached attempt parks, loses its fence, or a client disconnects. */
export function recordInterruptedTurn(requestId: string, model: string, startedAt: number, error: unknown, now: () => number = Date.now): void {
  if (accountingTurnRecorded()) return;
  const snapshot = requestAccountingSnapshot();
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  const parked = code === "PARKED";
  const endedAt = now();
  recordTurn({
    requestId, at: new Date(endedAt).toISOString(), latencyMs: Math.max(0, endedAt - startedAt),
    model, requestedModel: model, fellBack: false,
    providers: [...new Set(snapshot?.modelRequests.map((r) => r.provider) ?? [])],
    tools: [], approvals: 0, computerProposals: 0, webSearched: false, codeTask: false,
    interrupted: true,
    ...(parked ? {} : { error: "Turn exited before a final response; usage may be incomplete." }),
  });
}

/** Bounded-window task metrics, not lifetime totals or a durable billing ledger. */
export function taskUsageStats() {
  const tasks = new Map<string, { turns: number; requests: ModelRequestRecord[]; errors: number }>();
  for (const turn of turns) {
    if (!turn.taskKey) continue;
    const task = tasks.get(turn.taskKey) ?? { turns: 0, requests: [], errors: 0 };
    task.turns += 1;
    task.requests.push(...(turn.modelRequests ?? []));
    task.errors += turn.error ? 1 : 0;
    tasks.set(turn.taskKey, task);
  }
  return [...tasks.values()].map((task) => ({ turns: task.turns, errors: task.errors, usage: summarizeUsage(task.requests) }));
}

export function recentTurns(limit = 20): TurnRecord[] {
  return turns.slice(-Math.max(1, Math.min(limit, MAX_TURNS))).reverse();
}

export function turnStats(): {
  turns: number;
  errorRate: number;
  fallbackRate: number;
  medianLatencyMs: number;
  topTools: Array<{ tool: string; uses: number }>;
} {
  if (!turns.length) {
    return { turns: 0, errorRate: 0, fallbackRate: 0, medianLatencyMs: 0, topTools: [] };
  }
  const latencies = turns.map((turn) => turn.latencyMs).sort((a, b) => a - b);
  const toolCounts = new Map<string, number>();
  for (const turn of turns) {
    for (const tool of turn.tools) toolCounts.set(tool, (toolCounts.get(tool) ?? 0) + 1);
  }
  return {
    turns: turns.length,
    errorRate: turns.filter((turn) => turn.error).length / turns.length,
    fallbackRate: turns.filter((turn) => turn.fellBack).length / turns.length,
    medianLatencyMs: latencies[Math.floor(latencies.length / 2)],
    topTools: [...toolCounts.entries()]
      .map(([tool, uses]) => ({ tool, uses }))
      .sort((a, b) => b.uses - a.uses)
      .slice(0, 8),
  };
}

/** Per-tool call share and error rates over the bounded window. */
export const toolStats = () => toolUsageStats(turns);

export const __resetTelemetryForTests = (): void => {
  turns.length = 0;
};

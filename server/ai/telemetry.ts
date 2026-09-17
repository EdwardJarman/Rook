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

export type TurnRecord = {
  requestId: string;
  at: string;
  latencyMs: number;
  model: string;
  requestedModel: string;
  fellBack: boolean;
  providers: string[];
  tools: string[];
  approvals: number;
  computerProposals: number;
  webSearched: boolean;
  codeTask: boolean;
  continuations?: number;
  error?: string;
};

const MAX_TURNS = 100;
const turns: TurnRecord[] = [];

export function recordTurn(record: TurnRecord): void {
  turns.push(record);
  if (turns.length > MAX_TURNS) turns.splice(0, turns.length - MAX_TURNS);
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

export const __resetTelemetryForTests = (): void => {
  turns.length = 0;
};

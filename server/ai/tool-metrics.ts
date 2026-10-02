/**
 * Per-tool outcome metrics for the tool-description audit.
 *
 * Records only the tool name, an outcome class and a machine code. Never
 * arguments, results, ids or messages. A tool that is often called with
 * INVALID_ARGUMENTS has a description problem; one that is rarely called
 * costs its schema bytes on every request for little use.
 */

export const TOOL_OUTCOMES = ["ok", "proposed", "denied", "error", "invalid_arguments", "skipped"] as const;
export type ToolOutcome = (typeof TOOL_OUTCOMES)[number];
export type ToolOutcomeRecord = { tool: string; outcome: ToolOutcome; code?: string };

const CODE = /^[A-Z][A-Z0-9_]{1,40}$/;
const safeCode = (value: unknown): string | undefined => (typeof value === "string" && CODE.test(value) ? value : undefined);

/** Classify a dispatcher result payload. */
export function outcomeFromPayload(tool: string, payload: unknown): ToolOutcomeRecord {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const code = safeCode(record.code);
  const withCode = (outcome: ToolOutcome): ToolOutcomeRecord => ({ tool, outcome, ...(code ? { code } : {}) });
  switch (record.status) {
    case "approval_required": return withCode("proposed");
    case "denied": return withCode("denied");
    case "not_prepared": return withCode("skipped");
    case "error": return withCode(code === "INVALID_ARGUMENTS" ? "invalid_arguments" : "error");
    default: return withCode("ok");
  }
}

/** Classify a thrown error. Argument-schema and JSON failures are the description-quality signal. */
export function outcomeFromError(tool: string, error: unknown): ToolOutcomeRecord {
  const name = error instanceof Error ? error.name : "";
  if (name === "ZodError" || name === "SyntaxError") return { tool, outcome: "invalid_arguments", code: "INVALID_ARGUMENTS" };
  const code = safeCode(error && typeof error === "object" && "code" in error ? (error as { code: unknown }).code : undefined);
  return { tool, outcome: "error", code: code ?? "FAILED" };
}

/** A call the loop declined to run (duplicate fingerprint, exhausted output budget). */
export const skippedOutcome = (tool: string, code: "DUPLICATE_CALL" | "OUTPUT_BUDGET"): ToolOutcomeRecord => ({ tool, outcome: "skipped", code });

export type ToolUsageRow = {
  tool: string;
  calls: number;
  share: number;
  ok: number;
  proposed: number;
  denied: number;
  errors: number;
  invalidArguments: number;
  skipped: number;
  /** (errors + invalidArguments) / calls that reached the dispatcher (not skipped). */
  errorRate: number;
  invalidArgumentRate: number;
};

/** Call share and error rates over a window of turns. Skipped calls count toward share but not error rate. */
export function toolUsageStats(turns: ReadonlyArray<{ toolOutcomes?: ToolOutcomeRecord[] }>): { calls: number; turnsWithOutcomes: number; tools: ToolUsageRow[] } {
  const rows = new Map<string, Omit<ToolUsageRow, "share" | "errorRate" | "invalidArgumentRate">>();
  let calls = 0, turnsWithOutcomes = 0;
  for (const turn of turns) {
    if (!turn.toolOutcomes) continue;
    turnsWithOutcomes += 1;
    for (const entry of turn.toolOutcomes) {
      const row = rows.get(entry.tool) ?? { tool: entry.tool, calls: 0, ok: 0, proposed: 0, denied: 0, errors: 0, invalidArguments: 0, skipped: 0 };
      row.calls += 1; calls += 1;
      if (entry.outcome === "ok") row.ok += 1;
      else if (entry.outcome === "proposed") row.proposed += 1;
      else if (entry.outcome === "denied") row.denied += 1;
      else if (entry.outcome === "error") row.errors += 1;
      else if (entry.outcome === "invalid_arguments") row.invalidArguments += 1;
      else row.skipped += 1;
      rows.set(entry.tool, row);
    }
  }
  const tools = [...rows.values()].map((row) => {
    const dispatched = row.calls - row.skipped;
    return { ...row, share: calls ? row.calls / calls : 0,
      errorRate: dispatched ? (row.errors + row.invalidArguments) / dispatched : 0,
      invalidArgumentRate: dispatched ? row.invalidArguments / dispatched : 0 };
  }).sort((a, b) => b.calls - a.calls || a.tool.localeCompare(b.tool));
  return { calls, turnsWithOutcomes, tools };
}

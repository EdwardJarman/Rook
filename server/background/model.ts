import type { Message, InvokeResult } from "../_core/llm";
import type { AgentToolExecution } from "../integrations/agent-tool-executor";
import { TurnJournal } from "../ai/turn-context";

export const JOB_TTL = 7 * 24 * 60 * 60_000;
export const LEASE_TTL = 30_000;
export const APPROVAL_TTL = 24 * 60 * 60_000;
export const GRANT_TTL = 5 * 60_000;
export const RUN_BUDGET = 120_000;
export const ACTIVE_CAP = 50;
export const STATES = [
  "queued",
  "running",
  "awaiting_approval",
  "done",
  "failed",
  "expired",
  "cancelled",
] as const;
export type JobState = (typeof STATES)[number];
export const active = (state: JobState) =>
  ["queued", "running", "awaiting_approval"].includes(state);
export class JobError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable = false,
  ) {
    super(message);
    this.name = "JobError";
  }
}
export const transitions: Record<JobState, readonly JobState[]> = {
  queued: ["running", "expired", "cancelled"],
  running: [
    "awaiting_approval",
    "queued",
    "done",
    "failed",
    "expired",
    "cancelled",
  ],
  awaiting_approval: ["running", "failed", "expired", "cancelled"],
  done: [],
  failed: [],
  expired: [],
  cancelled: [],
};
export type Checkpoint = {
  messages: Message[];
  response: InvokeResult;
  round: number;
  continuation?: { text: string; used: number };
  toolPayloadChars?: number;
};
export type ToolOutcome = {
  fingerprint: string;
  name: string;
  phase: "intent" | "approval" | "executing" | "completed";
  arguments: string;
  output?: AgentToolExecution;
  approval?: {
    id: string;
    expiresAt: number;
    grantUntil?: number;
    decidedAt?: number;
  };
};
export type Job = {
  id: string;
  owner: string;
  bot: {
    id: string;
    name: string;
    role: string;
    purpose: string;
    model?: string;
  };
  prompt: string;
  intervalMs?: number;
  state: JobState;
  createdAt: number;
  updatedAt: number;
  nextFireAt: number;
  expiresAt: number;
  fence: number;
  lease?: { holder: string; until: number; acquiredAt: number };
  attempt: {
    id: string;
    firing: number;
    startedAt: number;
    spentMs: number;
    checkpoint?: Checkpoint;
    tools: ToolOutcome[];
  };
  journal: Array<{ at: number; kind: string; detail: string }>;
  result?: unknown;
  error?: { code: string; retryable: boolean; message: string };
  alert?: {
    id: string;
    kind: "approval" | "completion";
    body: string;
    sent?: boolean;
    nextTryAt?: number;
  };
};

// Match the durable-memory policy: never persist secret-bearing text in audit
// payloads. Tool inputs containing these markers are refused, not silently edited.
const SECRETY =
  /password|passcode|2fa|\botp\b|\btoken\b|secret|api[-_ ]?key|private[-_ ]?key|\bssn\b|account number|card number|\bcvv\b|\bBearer\s|\b(?:sk|rook)_[a-z0-9]{12,}|\bsk-[a-z0-9]{12,}/i;
export function sanitize<T>(value: T): T {
  if (typeof value === "string")
    return (SECRETY.test(value) ? "[redacted]" : value) as T;
  if (Array.isArray(value)) return value.map(sanitize) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        SECRETY.test(k) ? "[redacted]" : sanitize(v),
      ]),
    ) as T;
  return value;
}
export function assertNoSecrets(value: unknown) {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      /* Plain prompt. */
    }
  }
  if (
    JSON.stringify(sanitize(value)) !== JSON.stringify(value) ||
    JSON.stringify(sanitize(parsed)) !== JSON.stringify(parsed)
  )
    throw new JobError(
      "SECRET_INPUT",
      "Use connected credentials instead of secrets in a background job.",
    );
}
export function audit(job: Job, now: number, kind: string, detail: string) {
  job.updatedAt = now;
  job.journal.push({ at: now, kind, detail: sanitize(detail).slice(0, 2000) });
  // Preserve the header and latest events. Never evict attempt dedup records.
  while (Buffer.byteLength(JSON.stringify(job.journal)) > 128 * 1024)
    job.journal.splice(1, 1);
}
export function transition(
  job: Job,
  to: JobState,
  now: number,
  reason: string,
) {
  if (!transitions[job.state].includes(to))
    throw new JobError(
      "ILLEGAL_TRANSITION",
      `${job.state} cannot become ${to}.`,
    );
  audit(job, now, "transition", `${job.state} -> ${to}: ${reason}`);
  job.state = to;
  if (to !== "running") delete job.lease;
}
export function assertLease(
  job: Job,
  fence: number,
  holder: string,
  now: number,
) {
  if (
    job.state !== "running" ||
    job.fence !== fence ||
    job.lease?.holder !== holder ||
    job.lease.until <= now
  )
    throw new JobError(
      "STALE_FENCE",
      "This background lease is no longer valid.",
    );
  if (now >= job.expiresAt)
    throw new JobError("JOB_EXPIRED", "This job expired.");
}
export function completed(job: Job, fingerprint: string) {
  const journal = new TurnJournal();
  for (const entry of job.attempt.tools)
    if (entry.phase === "completed")
      journal.record({
        fingerprint: entry.fingerprint,
        code: "COMPLETED",
        retryable: false,
      });
  return journal.hasCompleted(fingerprint)
    ? job.attempt.tools.find(
        (t) => t.fingerprint === fingerprint && t.phase === "completed",
      )
    : undefined;
}
export function bounded<T>(value: T, max = 32 * 1024): T {
  if (Buffer.byteLength(JSON.stringify(value)) > max)
    throw new JobError(
      "JOURNAL_LIMIT",
      "The durable attempt reached its size limit.",
    );
  return value;
}

export interface JobStore {
  load(owner: string): Promise<{ revision: number; jobs: Job[] }>;
  /** Atomic revision check AND job write. False means contention; never hide IO errors. */
  commit(owner: string, revision: number, job: Job): Promise<boolean>;
  owners(): Promise<string[]>;
}

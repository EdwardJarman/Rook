/**
 * Foreground durable replay.
 *
 * A foreground turn that dies mid-flight (process crash, dropped connection,
 * deploy) can be retried by the client with the same opaque `turnId`. The
 * retry re-runs the normal loop, but every model round that requested tools
 * and every approval-gated tool outcome recorded by the earlier attempt is
 * replayed instead of repeated, so no proposal or write is created twice.
 *
 * The log is append-only and unique-keyed. A unique create is the atomic
 * claim: exactly one attempt may ever dispatch a given (turn, fingerprint),
 * and exactly one model response is canonical per (turn, round). Fingerprints
 * are the background runtime's: sha256 of `toolCallFingerprint`, completion
 * checked through `TurnJournal`.
 *
 * Read-only tools are re-executed on replay (fresh data, no side effects) and
 * never persisted. Storage failure fails open to today's non-durable turn.
 */

import { createHash } from "node:crypto";
import type { ToolCall } from "../_core/llm";
import { sanitize } from "../background/model";
import type { AgentToolExecution } from "../integrations/agent-tool-executor";
import { TOOL_REGISTRY } from "../integrations/agent-tool-executor";
import type { ExcelAgentApproval } from "../integrations/excel-agent";
import type { ComputerProposal } from "../integrations/computer-tools";
import { toolCallFingerprint } from "./agent-reliability";
import { TurnJournal } from "./turn-context";

export const FOREGROUND_TURN_TTL_MS = 24 * 60 * 60_000;
const MAX_ROUND_BYTES = 64 * 1024;
const MAX_OUTPUT_BYTES = 32 * 1024;
export const TURN_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export type TurnEventKind = "round" | "intent" | "done";
export type TurnEvent = {
  key: string;
  kind: TurnEventKind;
  at: number;
  expiresAt: number;
  payload: unknown;
};
export type CreateResult = { created: true } | { created: false; existing: TurnEvent };

export interface ForegroundTurnStore {
  list(owner: string, turn: string, now: number): Promise<TurnEvent[]>;
  /** Atomic: false (with the winner) when `event.key` already exists. */
  create(owner: string, turn: string, event: TurnEvent): Promise<CreateResult>;
}

export class MemoryForegroundTurnStore implements ForegroundTurnStore {
  private events = new Map<string, { owner: string; turn: string; event: TurnEvent }>();
  async list(owner: string, turn: string, now: number) {
    return [...this.events.values()]
      .filter((row) => row.owner === owner && row.turn === turn && row.event.expiresAt > now)
      .map((row) => structuredClone(row.event));
  }
  async create(owner: string, turn: string, event: TurnEvent): Promise<CreateResult> {
    const existing = this.events.get(event.key);
    if (existing) return { created: false, existing: structuredClone(existing.event) };
    this.events.set(event.key, { owner, turn, event: structuredClone(event) });
    return { created: true };
  }
}

export type SavedRound = {
  content: string;
  toolCalls: ToolCall[];
  finishReason: string | null;
  model: string;
};

type DonePayload =
  | { name: string; output: AgentToolExecution; approvals: ExcelAgentApproval[]; proposals: ComputerProposal[] }
  | { name: string; error: string };

/** The interrupted attempt claimed a step but never recorded its outcome. */
export class ForegroundOutcomeUnknown extends Error {
  readonly code = "OUTCOME_UNKNOWN";
  constructor() {
    super(
      "An earlier attempt was interrupted while preparing a step. It may already be waiting for your approval, so I did not repeat it. Check your pending approvals before asking again.",
    );
    this.name = "ForegroundOutcomeUnknown";
  }
}

export const turnKey = (input: { userId: string; botId: string; taskId: string; turnId: string }): string =>
  createHash("sha256")
    .update([input.userId, input.botId, input.taskId, input.turnId].join("\0"))
    .digest("hex")
    .slice(0, 40);

const fingerprintHash = (name: string, rawArgs: string): string =>
  createHash("sha256").update(toolCallFingerprint(name, rawArgs)).digest("hex");

const bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value));
const unchanged = (value: unknown): boolean => JSON.stringify(sanitize(value)) === JSON.stringify(value);

type ToolInput = {
  name: string;
  rawArgs: string;
  approvals: ExcelAgentApproval[];
  computerProposals: ComputerProposal[];
};

export class ForegroundReplay {
  private rounds = new Map<number, SavedRound>();
  private done = new Map<string, DonePayload>();
  private intents = new Set<string>();
  private journal = new TurnJournal();

  private constructor(
    private store: ForegroundTurnStore,
    private owner: string,
    private turn: string,
    private now: () => number,
  ) {}

  /** Undefined (non-durable turn) when the store cannot be read. */
  static async open(
    input: { userId: string; botId: string; taskId: string; turnId?: string },
    options: { store?: ForegroundTurnStore; now?: () => number } = {},
  ): Promise<ForegroundReplay | undefined> {
    if (!input.turnId || !TURN_ID_PATTERN.test(input.turnId)) return undefined;
    const now = options.now ?? Date.now;
    try {
      const store = options.store ?? (await import("./foreground-turn-store")).instantForegroundTurnStore;
      const replay = new ForegroundReplay(store, input.userId, turnKey({ ...input, turnId: input.turnId }), now);
      replay.absorb(await store.list(replay.owner, replay.turn, now()));
      return replay;
    } catch (error) {
      console.warn("[RookAI] foreground replay unavailable", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      return undefined;
    }
  }

  private absorb(events: TurnEvent[]): void {
    for (const event of events) {
      if (event.kind === "round") {
        const round = Number(event.key.split(":round:")[1]);
        if (Number.isInteger(round)) this.rounds.set(round, event.payload as SavedRound);
      } else {
        const fingerprint = event.key.split(`:${event.kind}:`)[1];
        if (!fingerprint) continue;
        if (event.kind === "intent") this.intents.add(fingerprint);
        else {
          this.done.set(fingerprint, event.payload as DonePayload);
          this.journal.record({ fingerprint, code: "COMPLETED", retryable: false });
        }
      }
    }
  }

  private event(kind: TurnEventKind, suffix: string, payload: unknown): TurnEvent {
    const at = this.now();
    return { key: `${this.turn}:${kind}:${suffix}`, kind, at, expiresAt: at + FOREGROUND_TURN_TTL_MS, payload };
  }

  savedRound(round: number): SavedRound | undefined {
    return this.rounds.get(round);
  }

  /**
   * Persist a tool-requesting model round and return the canonical one: if a
   * concurrent attempt already recorded this round, its response wins so both
   * attempts request identical tool calls.
   */
  async recordRound(round: number, saved: SavedRound): Promise<SavedRound> {
    const known = this.rounds.get(round);
    if (known) return known;
    // Secret-bearing or oversized rounds are not persisted; their approval
    // outcomes are still journaled by fingerprint hash.
    if (!unchanged(saved) || bytes(saved) > MAX_ROUND_BYTES) return saved;
    try {
      const result = await this.store.create(this.owner, this.turn, this.event("round", String(round), saved));
      if (!result.created) {
        const winner = result.existing.payload as SavedRound;
        this.rounds.set(round, winner);
        return winner;
      }
    } catch (error) {
      this.warn("round", error);
    }
    this.rounds.set(round, saved);
    return saved;
  }

  async execute(
    input: ToolInput,
    dispatch: () => Promise<AgentToolExecution>,
  ): Promise<AgentToolExecution> {
    const fingerprint = fingerprintHash(input.name, input.rawArgs);
    if (this.journal.hasCompleted(fingerprint)) return this.replayed(fingerprint, input);
    if (TOOL_REGISTRY[input.name]?.risk === "read-only") return dispatch();

    if (this.intents.has(fingerprint)) throw new ForegroundOutcomeUnknown();
    try {
      const claim = await this.store.create(this.owner, this.turn, this.event("intent", fingerprint, { name: input.name }));
      if (!claim.created) {
        // Another attempt claimed it; it may have finished since we listed.
        this.absorb(await this.store.list(this.owner, this.turn, this.now()));
        if (this.journal.hasCompleted(fingerprint)) return this.replayed(fingerprint, input);
        throw new ForegroundOutcomeUnknown();
      }
    } catch (error) {
      if (error instanceof ForegroundOutcomeUnknown) throw error;
      this.warn("intent", error);
      return dispatch();
    }
    this.intents.add(fingerprint);

    const approvalsBefore = input.approvals.length;
    const proposalsBefore = input.computerProposals.length;
    let output: AgentToolExecution;
    try {
      output = await dispatch();
    } catch (error) {
      await this.recordDone(fingerprint, {
        name: input.name,
        error: error instanceof Error ? error.message : "Connected tool failed",
      });
      throw error;
    }
    await this.recordDone(fingerprint, {
      name: input.name,
      output,
      approvals: input.approvals.slice(approvalsBefore),
      proposals: input.computerProposals.slice(proposalsBefore),
    });
    return output;
  }

  private replayed(fingerprint: string, input: ToolInput): AgentToolExecution {
    const done = this.done.get(fingerprint)!;
    if ("error" in done) throw new Error(done.error);
    input.approvals.push(...structuredClone(done.approvals));
    input.computerProposals.push(...structuredClone(done.proposals));
    return structuredClone(done.output);
  }

  private async recordDone(fingerprint: string, payload: DonePayload): Promise<void> {
    const safe = sanitize(payload);
    if (bytes(safe) > MAX_OUTPUT_BYTES) return;
    try {
      await this.store.create(this.owner, this.turn, this.event("done", fingerprint, safe));
      this.done.set(fingerprint, safe);
      this.journal.record({ fingerprint, code: "COMPLETED", retryable: false });
    } catch (error) {
      this.warn("done", error);
    }
  }

  private warn(stage: string, error: unknown): void {
    console.warn("[RookAI] foreground replay write failed", {
      stage,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  }
}

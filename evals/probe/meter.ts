/**
 * Spend meter: a hard dollar cap enforced per model request, at the router
 * boundary, so no request can leave without a reservation and none is
 * unmetered (no meter installed means no call).
 *
 * The ChatGPT path reports tokens, not dollars, so cost is computed at rates
 * the operator supplies (a rate snapshot they verified). With a subscription
 * the dollar figure is an API-equivalent budget; plan usage limits are a
 * separate, unobservable constraint.
 *
 * Conservative by construction:
 * - Before a request, reserve its worst case (twice the estimated input plus
 *   a large output, twice again for the SDK retry we cannot see). The request
 *   only runs if spent + reserve stays under `headroom` x cap.
 * - After it, charge actual usage x 1.1. Missing usage is charged from an
 *   estimate and counted. Unknown cached tokens are charged as uncached.
 *   A failed request is charged its estimated input (bytes may have left).
 * - A cumulative ledger on disk survives crashes and re-runs: the reserve is
 *   written before the call, so a killed process still counts it.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { InvokeParams, InvokeResult } from "../../server/_core/llm";
import { normalizeTokenUsage } from "../../server/ai/request-accounting";

export const HARD_CAP_USD = 25;
export const DEFAULT_HEADROOM = 0.95;
const CHARGE_FACTOR = 1.1;
const RESERVE_RETRY_FACTOR = 2;
const CHARS_PER_TOKEN_ESTIMATE = 3;
const PRIOR_OUTPUT_TOKENS = 6000;

/** One model request is abandoned after this long. The ChatGPT path has no timeout of its own. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 180_000;

export class RequestTimeout extends Error {
  constructor(ms: number) { super(`A model request ran longer than ${Math.round(ms / 1000)}s and was abandoned.`); this.name = "RequestTimeout"; }
}
export class TrialCancelled extends Error {
  constructor() { super("The trial was cancelled; no further model requests are sent for it."); this.name = "TrialCancelled"; }
}

/**
 * Cancellation handle for one trial. It travels with the trial's async call
 * chain (AsyncLocalStorage), so an abandoned trial that is still unwinding can
 * neither send another model request nor leave one in flight.
 */
export class TrialScope {
  cancelled = false;
  private listeners = new Set<() => void>();
  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    for (const listener of [...this.listeners]) listener();
  }
  onCancel(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
}
export const trialScope = new AsyncLocalStorage<TrialScope>();

export type Rates = { input: number; cachedInput: number; output: number };
export type LedgerState = { spentUsd: number; pendingUsd: number; requests: number };
export interface Ledger { read(): LedgerState; write(state: LedgerState): void }

export class BudgetExceeded extends Error {
  constructor() { super("The probe budget is exhausted."); this.name = "BudgetExceeded"; }
}

export class MemoryLedger implements Ledger {
  constructor(private state: LedgerState = { spentUsd: 0, pendingUsd: 0, requests: 0 }) {}
  read() { return { ...this.state }; }
  write(state: LedgerState) { this.state = { ...state }; }
}

/** JSON file written atomically. A corrupt or unreadable file stops the run rather than resetting spend. */
export class FileLedger implements Ledger {
  constructor(private file: string) {}
  read(): LedgerState {
    if (!existsSync(this.file)) return { spentUsd: 0, pendingUsd: 0, requests: 0 };
    const parsed = JSON.parse(readFileSync(this.file, "utf8")) as Partial<LedgerState>;
    const ok = [parsed.spentUsd, parsed.pendingUsd, parsed.requests].every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0);
    if (!ok) throw new Error("The spend ledger is corrupt. Fix or delete it deliberately; the runner will not guess.");
    return { spentUsd: parsed.spentUsd!, pendingUsd: parsed.pendingUsd!, requests: parsed.requests! };
  }
  write(state: LedgerState) {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, JSON.stringify(state));
    renameSync(temp, this.file);
  }
}

const positive = (name: string, raw: string | undefined, max: number, required: boolean): number | undefined => {
  const text = raw?.trim();
  if (!text) { if (required) throw new Error(`${name} is required.`); return undefined; }
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0 || value > max) throw new Error(`${name} must be a number above 0 and at most ${max}.`);
  return value;
};

/** USD per million tokens, from a rate snapshot the operator verified. Never guessed here. */
export function parseRates(env: Record<string, string | undefined>): Rates {
  const input = positive("ROOK_EVAL_RATE_INPUT_PER_M", env.ROOK_EVAL_RATE_INPUT_PER_M, 1000, true)!;
  const output = positive("ROOK_EVAL_RATE_OUTPUT_PER_M", env.ROOK_EVAL_RATE_OUTPUT_PER_M, 1000, true)!;
  const cachedInput = positive("ROOK_EVAL_RATE_CACHED_PER_M", env.ROOK_EVAL_RATE_CACHED_PER_M, 1000, false) ?? input;
  return { input, cachedInput, output };
}

/** The cap can be lowered, never raised above the hard cap. */
export function parseBudget(env: Record<string, string | undefined>): number {
  return positive("ROOK_EVAL_BUDGET_USD", env.ROOK_EVAL_BUDGET_USD, HARD_CAP_USD, false) ?? HARD_CAP_USD;
}

export type MeterOptions = { capUsd: number; rates: Rates; ledger: Ledger; headroom?: number; requestTimeoutMs?: number };
export type MeterActivity = { inFlight: number; oldestInFlightMs: number; lastCompletionAt: number };
export type Invoke = (params: InvokeParams, request?: import("express").Request) => Promise<{ result: InvokeResult; attemptedProviders: string[]; fellBack: boolean }>;

export class SpendMeter {
  private spent: number;
  private pendingSeed: number;
  private requestCount: number;
  private maxOutput = 0;
  private estimated = 0;
  private hitCap = false;
  private timeoutCount = 0;
  private sequence = 0;
  private inFlight = new Map<number, number>();
  private lastCompletion = 0;
  readonly capUsd: number;
  readonly ceilingUsd: number;
  constructor(private o: MeterOptions) {
    if (!(o.capUsd > 0) || o.capUsd > HARD_CAP_USD) throw new Error(`The cap must be above 0 and at most ${HARD_CAP_USD}.`);
    const prior = o.ledger.read();
    // A crash can leave a reservation behind; it counts.
    this.spent = prior.spentUsd + prior.pendingUsd;
    this.pendingSeed = 0;
    this.requestCount = prior.requests;
    this.capUsd = o.capUsd;
    this.ceilingUsd = o.capUsd * (o.headroom ?? DEFAULT_HEADROOM);
    this.persist(0);
  }
  spentUsd() { return this.spent; }
  remainingUsd() { return Math.max(0, this.ceilingUsd - this.spent); }
  requests() { return this.requestCount; }
  estimatedCharges() { return this.estimated; }
  tripped() { return this.hitCap; }
  /** Model requests abandoned for exceeding the request timeout, cumulative for this meter. */
  timeouts() { return this.timeoutCount; }
  /** What is on the wire right now, for the harness heartbeat. */
  activity(): MeterActivity {
    const now = Date.now();
    const starts = [...this.inFlight.values()];
    return { inFlight: starts.length, oldestInFlightMs: starts.length ? now - Math.min(...starts) : 0, lastCompletionAt: this.lastCompletion };
  }
  /** Tripped flag is per trial: the harness clears it after recording the trial. */
  clearTrip() { this.hitCap = false; }

  private persist(pending: number) {
    this.pendingSeed = pending;
    this.o.ledger.write({ spentUsd: this.spent, pendingUsd: pending, requests: this.requestCount });
  }
  private inputEstimate(params: InvokeParams): number {
    return Math.ceil(JSON.stringify({ messages: params.messages, tools: params.tools ?? [] }).length / CHARS_PER_TOKEN_ESTIMATE);
  }
  private priceOf(uncached: number, cached: number, output: number): number {
    const { input, cachedInput, output: out } = this.o.rates;
    return (uncached * input + cached * cachedInput + output * out) / 1_000_000;
  }
  reserveFor(params: InvokeParams): number {
    const inputTokens = this.inputEstimate(params);
    const outputTokens = Math.max(PRIOR_OUTPUT_TOKENS, Math.ceil(this.maxOutput * 1.5));
    return this.priceOf(inputTokens * 2, 0, outputTokens) * RESERVE_RETRY_FACTOR;
  }
  private chargeFor(params: InvokeParams, result: InvokeResult): number {
    const usage = normalizeTokenUsage(result.usage);
    if (usage.input !== null && usage.output !== null) {
      this.maxOutput = Math.max(this.maxOutput, usage.output);
      const cached = usage.cachedInput ?? 0;
      return this.priceOf(usage.input - cached, cached, usage.output) * CHARGE_FACTOR;
    }
    this.estimated += 1;
    const answer = JSON.stringify(result.choices?.[0]?.message ?? "").length;
    const outputTokens = Math.max(this.maxOutput, Math.ceil(answer / CHARS_PER_TOKEN_ESTIMATE), 1500);
    return this.priceOf(this.inputEstimate(params), 0, outputTokens) * CHARGE_FACTOR;
  }

  /** Rejects when the request outlives its deadline or its trial is cancelled; the abandoned call's eventual result is ignored. */
  private bounded<T>(work: Promise<T>, scope: TrialScope | undefined): Promise<T> {
    const ms = this.o.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    return new Promise<T>((resolve, reject) => {
      let done = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let off: (() => void) | undefined;
      const finish = (settle: () => void) => { if (done) return; done = true; clearTimeout(timer); off?.(); settle(); };
      timer = setTimeout(() => finish(() => reject(new RequestTimeout(ms))), ms);
      off = scope?.onCancel(() => finish(() => reject(new TrialCancelled())));
      work.then((value) => finish(() => resolve(value)), (error) => finish(() => reject(error)));
    });
  }

  /** Wrap the router's invoke. Every model request of the probe goes through here. */
  wrap(invoke: Invoke): Invoke {
    return async (params, request) => {
      const scope = trialScope.getStore();
      if (scope?.cancelled) throw new TrialCancelled();
      const reserve = this.reserveFor(params);
      if (this.spent + reserve > this.ceilingUsd) { this.hitCap = true; throw new BudgetExceeded(); }
      this.requestCount += 1;
      this.persist(reserve);
      const id = (this.sequence += 1);
      this.inFlight.set(id, Date.now());
      try {
        const out = await this.bounded(invoke(params, request), scope);
        this.spent += this.chargeFor(params, out.result);
        this.persist(0);
        return out;
      } catch (error) {
        // An abandoned request may still finish provider-side with unknown usage, so it is charged its full worst-case reserve.
        const abandoned = error instanceof RequestTimeout || error instanceof TrialCancelled;
        if (error instanceof RequestTimeout) this.timeoutCount += 1;
        this.spent += abandoned ? reserve : this.priceOf(this.inputEstimate(params), 0, 0) * CHARGE_FACTOR;
        this.persist(0);
        throw error;
      } finally {
        this.inFlight.delete(id);
        this.lastCompletion = Date.now();
      }
    };
  }
}

/** The installed meter. Empty means the wrapped router refuses every call (fail closed). */
export const meterHolder: { current: SpendMeter | undefined } = { current: undefined };

export const meteredInvoke = (actual: Invoke): Invoke => (params, request) => {
  const meter = meterHolder.current;
  if (!meter) throw new Error("No spend meter is installed; refusing an unmetered model request.");
  return meter.wrap(actual)(params, request);
};

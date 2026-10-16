/**
 * Per-model health: failure telemetry (global, no user data) and a
 * short-lived per-account "unavailable" label so the picker stops offering a
 * model the provider has just rejected.
 *
 * In-memory and per-process by design (no new storage); on serverless each
 * instance learns independently. The clock and logger are injectable.
 */

import type { ProviderFailureKind } from "./provider-error";

export type ModelStats = {
  provider: string;
  model: string;
  attempts: number;
  failures: number;
  consecutiveFailures: number;
  lastKind?: ProviderFailureKind;
  lastStatus?: number;
  lastCode?: string;
  lastAt: string;
};

export type ModelState = { state: "ok" | "unavailable"; reason?: string; at: number; ttlMs?: number };

export type ModelHealthOptions = {
  now?: () => number;
  stateTtlMs?: number;
  maxEntries?: number;
  alertEvery?: number;
  alert?: (event: string, fields: Record<string, unknown>) => void;
};

export class ModelHealth {
  private readonly stats = new Map<string, ModelStats>();
  private readonly states = new Map<string, ModelState>();
  private readonly now: () => number;
  private readonly stateTtlMs: number;
  private readonly maxEntries: number;
  private readonly alertEvery: number;
  private readonly alert: (event: string, fields: Record<string, unknown>) => void;

  constructor(options: ModelHealthOptions = {}) {
    this.now = options.now ?? Date.now;
    this.stateTtlMs = options.stateTtlMs ?? 30 * 60_000;
    this.maxEntries = options.maxEntries ?? 500;
    this.alertEvery = options.alertEvery ?? 3;
    this.alert = options.alert ?? ((event, fields) => console.error(`[RookAI] ${event}`, fields));
  }

  /** Records one attempt. Emits a structured error log at every `alertEvery`th consecutive failure. */
  record(input: { provider: string; model: string; ok: true } | { provider: string; model: string; ok: false; kind: ProviderFailureKind; status?: number; code?: string }): void {
    const key = `${input.provider}\u0000${input.model}`;
    const entry = this.stats.get(key) ?? {
      provider: input.provider, model: input.model, attempts: 0, failures: 0, consecutiveFailures: 0, lastAt: "",
    };
    entry.attempts += 1;
    entry.lastAt = new Date(this.now()).toISOString();
    if (input.ok) {
      entry.consecutiveFailures = 0;
    } else {
      entry.failures += 1;
      entry.consecutiveFailures += 1;
      entry.lastKind = input.kind;
      entry.lastStatus = input.status;
      entry.lastCode = input.code;
      if (entry.consecutiveFailures % this.alertEvery === 0) {
        this.alert("model failing repeatedly", {
          provider: entry.provider, model: entry.model, consecutiveFailures: entry.consecutiveFailures,
          failures: entry.failures, attempts: entry.attempts, kind: input.kind, status: input.status, code: input.code,
        });
      }
    }
    this.stats.delete(key);
    this.stats.set(key, entry);
    while (this.stats.size > this.maxEntries) this.stats.delete(this.stats.keys().next().value as string);
  }

  snapshot(): ModelStats[] {
    return [...this.stats.values()].map((entry) => ({ ...entry })).sort((a, b) => b.consecutiveFailures - a.consecutiveFailures || b.failures - a.failures);
  }

  /** `ttlMs` shortens how long this one verdict is believed (default: the instance TTL). */
  mark(scope: string, model: string, state: "ok" | "unavailable", reason?: string, ttlMs?: number): void {
    const key = `${scope}\u0000${model}`;
    this.states.delete(key);
    this.states.set(key, { state, reason, at: this.now(), ttlMs });
    while (this.states.size > this.maxEntries) this.states.delete(this.states.keys().next().value as string);
  }

  stateOf(scope: string, model: string): ModelState | undefined {
    const key = `${scope}\u0000${model}`;
    const entry = this.states.get(key);
    if (!entry) return undefined;
    if (this.now() - entry.at >= (entry.ttlMs ?? this.stateTtlMs)) {
      this.states.delete(key);
      return undefined;
    }
    return entry;
  }

  reset(): void {
    this.stats.clear();
    this.states.clear();
  }
}

export const modelHealth = new ModelHealth();
export const __resetModelHealthForTests = (): void => modelHealth.reset();

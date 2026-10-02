/**
 * Turn-context seam (Grok `SessionActor` + lifecycle-contributors port, adapted).
 *
 * Rook has no long-lived actor: `prepareAgentTurn` in
 * `server/integrations/excel-agent.ts` already builds every turn from
 * (bot config + recentContext + connectors + memory). This module carries the
 * actor's *invariants* without the runtime:
 * - `resolveRequestedModel`: the model-route step, extracted pure so both
 *   agent paths resolve identically (wired back into `prepareAgentTurn`).
 * - `TurnContributor` registry: small deterministic `contribute()` steps run
 *   in registration order — the mailbox-ordering invariant without mailboxes.
 * - `TurnJournal`: bounded fingerprint/outcome log so a crashed turn can be
 *   *replayed* (replay ⇒ same fingerprints ⇒ dedup ⇒ no double proposals).
 */

export function resolveRequestedModel(model: string | undefined): string {
  const requested = model?.trim().toLowerCase() || "";
  return !requested || ["auto", "openrouter/auto", "openrouter/free"].includes(requested)
    ? "openrouter/free"
    : model!.trim();
}

export type TurnContextSeed = Record<string, unknown>;

export type TurnContributor = {
  name: string;
  contribute: (seed: TurnContextSeed) => TurnContextSeed | Promise<TurnContextSeed>;
};

const contributors: TurnContributor[] = [];

/** Register a turn contributor. Returns an unregister function. */
export function registerTurnContributor(contributor: TurnContributor): () => void {
  contributors.push(contributor);
  return () => {
    const index = contributors.indexOf(contributor);
    if (index >= 0) contributors.splice(index, 1);
  };
}

/** Test-only reset. */
export const __resetTurnContributorsForTests = (): void => {
  contributors.length = 0;
};

/** Contributor names in run order (deterministic). */
export function turnContributorNames(): string[] {
  return contributors.map((entry) => entry.name);
}

/** Run every contributor in registration order, merging patches over the seed. */
export async function applyTurnContributors(
  seed: TurnContextSeed,
): Promise<TurnContextSeed> {
  let merged: TurnContextSeed = { ...seed };
  for (const contributor of [...contributors]) {
    const patch = await contributor.contribute({ ...merged });
    if (patch && typeof patch === "object") merged = { ...merged, ...patch };
  }
  return merged;
}

export type TurnJournalEntry = {
  fingerprint: string;
  code: string;
  retryable: boolean;
};

const MAX_JOURNAL_ENTRIES = 100;

/**
 * Bounded per-turn journal of tool-call outcomes. `hasCompleted` answers
 * replay dedup: a fingerprint recorded with a terminal code must not run
 * again if the turn is replayed after a crash.
 */
export class TurnJournal {
  private entries: TurnJournalEntry[] = [];

  record(entry: TurnJournalEntry): void {
    if (!entry.fingerprint) return;
    this.entries.push(entry);
    if (this.entries.length > MAX_JOURNAL_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_JOURNAL_ENTRIES);
    }
  }

  hasCompleted(fingerprint: string): boolean {
    return this.entries.some((entry) => entry.fingerprint === fingerprint);
  }

  toJSON(): TurnJournalEntry[] {
    return [...this.entries];
  }

  get size(): number {
    return this.entries.length;
  }
}

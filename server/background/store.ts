import { id } from "@instantdb/admin";
import { getDb } from "../db";
import { active, JobError, type Job, type JobStore } from "./model";

/** A unique revision reservation and its job write commit in ONE transaction.
 * This is the Excel action-claim pattern, applied to all owner mutations so
 * scheduling at the 50-job boundary is atomic too. Reservations are immutable.
 */
export class InstantJobStore implements JobStore {
  private async database() {
    const db = await getDb();
    if (!db)
      throw new JobError(
        "STORE_UNAVAILABLE",
        "Background persistence is unavailable.",
        true,
      );
    return db;
  }
  async load(owner: string) {
    const db = await this.database();
    const head = async () => {
      const data = await db.query({
        backgroundRevisions: {
          $: { where: { owner }, order: { revision: "desc" }, limit: 1 },
        },
      });
      return data.backgroundRevisions[0]?.revision ?? 0;
    };
    for (let tries = 0; tries < 8; tries++) {
      const revision = await head();
      const data = await db.query({
        backgroundJobs: { $: { where: { owner } } },
      });
      if (revision === (await head()))
        return {
          revision,
          jobs: data.backgroundJobs.map((row) => row.payload as Job),
        };
    }
    throw new JobError(
      "SCHEDULE_CONFLICT",
      "Background jobs are changing. Retry shortly.",
      true,
    );
  }
  async commit(owner: string, revision: number, job: Job) {
    const db = await this.database();
    const key = `${owner}:${revision + 1}`;
    const reservation = id();
    try {
      await db.transact([
        db.tx.backgroundRevisions[reservation].create({
          key,
          owner,
          revision: revision + 1,
        }),
        db.tx.backgroundJobs[job.id].update({
          owner,
          needsAttention:
            active(job.state) || Boolean(job.alert && !job.alert.sent),
          payload: job,
        }),
      ]);
      return true;
    } catch (error) {
      // A committed competing reservation proves contention. Other failures
      // (including an ambiguous response to our own commit) must surface.
      const data = await db.query({
        backgroundRevisions: { $: { where: { key }, limit: 1 } },
      });
      if (data.backgroundRevisions.length)
        return data.backgroundRevisions[0].id === reservation;
      throw error;
    }
  }
  async owners() {
    const db = await this.database();
    const data = await db.query({
      backgroundJobs: {
        $: {
          where: {
            needsAttention: true,
          },
        },
      },
    });
    return [...new Set(data.backgroundJobs.map((row) => row.owner))];
  }
}

/** Hermetic durable boundary: reuse one store across simulated runtime deaths. */
export class MemoryJobStore implements JobStore {
  private data = new Map<string, { revision: number; jobs: Job[] }>();
  async load(owner: string) {
    return structuredClone(this.data.get(owner) ?? { revision: 0, jobs: [] });
  }
  async commit(owner: string, revision: number, job: Job) {
    const current = this.data.get(owner) ?? { revision: 0, jobs: [] };
    if (current.revision !== revision) return false;
    this.data.set(owner, {
      revision: revision + 1,
      jobs: [
        ...current.jobs.filter((j) => j.id !== job.id),
        structuredClone(job),
      ],
    });
    return true;
  }
  async owners() {
    return [...this.data.keys()];
  }
}

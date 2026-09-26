import { createHash } from "node:crypto";
import { toolCallFingerprint } from "../ai/agent-reliability";
import type {
  AgentToolExecution,
  executeAgentTool,
} from "../integrations/agent-tool-executor";
import { TOOL_REGISTRY } from "../integrations/agent-tool-executor";
import {
  ACTIVE_CAP,
  APPROVAL_TTL,
  GRANT_TTL,
  JOB_TTL,
  LEASE_TTL,
  RUN_BUDGET,
  active,
  assertLease,
  assertNoSecrets,
  audit,
  bounded,
  completed,
  JobError,
  sanitize,
  transition,
  type Checkpoint,
  type Job,
  type JobStore,
  type ToolOutcome,
} from "./model";

type ToolInput = Parameters<typeof executeAgentTool>[0];
export type DurableTurn = {
  checkpoint?: Checkpoint;
  guard(): Promise<void>;
  save(checkpoint: Checkpoint): Promise<void>;
  execute(
    input: ToolInput,
    dispatch: () => Promise<AgentToolExecution>,
  ): Promise<AgentToolExecution>;
};
export type RuntimeDeps = {
  store: JobStore;
  now(): number;
  id(): string;
  holder: string;
  run(job: Job, turn: DurableTurn): Promise<unknown>;
  resolve(
    job: Job,
    tool: ToolOutcome,
    guard: () => Promise<void>,
  ): Promise<AgentToolExecution>;
  notify(job: Job): Promise<boolean>;
};
export type ScheduleInput = {
  bot: Job["bot"];
  prompt: string;
  at?: number;
  intervalMs?: number;
};

export class BackgroundRuntime {
  constructor(readonly deps: RuntimeDeps) {}
  private async mutate<T>(
    owner: string,
    fn: (jobs: Job[], now: number) => { job: Job; value: T } | undefined,
  ): Promise<T | undefined> {
    for (let n = 0; n < 12; n++) {
      const { jobs, revision } = await this.deps.store.load(owner);
      const changed = fn(jobs, this.deps.now());
      if (!changed) return undefined;
      bounded(changed.job.attempt, 512 * 1024);
      if (await this.deps.store.commit(owner, revision, changed.job))
        return changed.value;
    }
    throw new JobError(
      "SCHEDULE_CONFLICT",
      "Another runtime updated this job. Retry shortly.",
      true,
    );
  }
  private find(jobs: Job[], id: string) {
    const job = jobs.find((j) => j.id === id);
    if (!job)
      throw new JobError("NOT_FOUND", "That background job does not exist.");
    return job;
  }
  async schedule(owner: string, input: ScheduleInput): Promise<Job> {
    assertNoSecrets(input);
    if (!input.prompt.trim() || input.prompt.length > 4000)
      throw new JobError(
        "INVALID_SCHEDULE",
        "Supply a standalone prompt up to 4000 characters.",
      );
    if (
      input.intervalMs !== undefined &&
      (!Number.isSafeInteger(input.intervalMs) || input.intervalMs < 60_000)
    )
      throw new JobError(
        "INVALID_SCHEDULE",
        "Recurring jobs need an interval of at least 60 seconds.",
      );
    if (/^(chatgpt|opencode):/.test((input.bot.model ?? "").trim().toLowerCase()))
      throw new JobError(
        "UNSUPPORTED_MODEL",
        "Choose a server model with the shared approval-gated tool dispatcher.",
      );
    const id = this.deps.id();
    return (await this.mutate(owner, (jobs, now) => {
      if (jobs.filter((j) => active(j.state)).length >= ACTIVE_CAP)
        throw new JobError(
          "ACTIVE_JOB_CAP",
          "You already have 50 active jobs. Cancel one before scheduling another.",
        );
      const at = input.at ?? now;
      if (!Number.isSafeInteger(at) || at < now || at >= now + JOB_TTL)
        throw new JobError(
          "INVALID_SCHEDULE",
          "Schedule within the next seven days.",
        );
      const job: Job = {
        id,
        owner,
        bot: input.bot,
        prompt: input.prompt.trim(),
        intervalMs: input.intervalMs,
        state: "queued",
        createdAt: now,
        updatedAt: now,
        nextFireAt: at,
        expiresAt: now + JOB_TTL,
        fence: 0,
        attempt: {
          id: `${id}:1`,
          firing: 1,
          startedAt: 0,
          spentMs: 0,
          tools: [],
        },
        journal: [],
      };
      audit(
        job,
        now,
        "header",
        `Scheduled detached job for Bot ${job.bot.id}; expiry ${job.expiresAt}`,
      );
      return { job, value: job };
    }))!;
  }
  async list(owner: string) {
    return (await this.deps.store.load(owner)).jobs;
  }
  async inspect(owner: string, id: string) {
    return this.find(await this.list(owner), id);
  }
  async status(owner: string) {
    const jobs = (await this.list(owner)).filter((j) => active(j.state));
    return {
      jobs: jobs.length,
      awaitingApproval: jobs.filter((j) => j.state === "awaiting_approval")
        .length,
    };
  }
  async cancel(owner: string, id: string) {
    return this.mutate(owner, (jobs, now) => {
      const job = this.find(jobs, id);
      if (!active(job.state)) return { job, value: job };
      transition(
        job,
        "cancelled",
        now,
        "Cancelled by owner; no further steps will start.",
      );
      delete job.alert;
      return { job, value: job };
    });
  }
  async decide(
    owner: string,
    id: string,
    approvalId: string,
    decision: "approve" | "deny",
    reason = "Declined by owner",
  ) {
    return this.mutate(owner, (jobs, now) => {
      const job = this.find(jobs, id);
      const entry = job.attempt.tools.find(
        (t) => t.approval?.id === approvalId,
      );
      if (
        job.state !== "awaiting_approval" ||
        !entry?.approval ||
        entry.approval.decidedAt !== undefined
      )
        throw new JobError(
          "SCHEDULE_CONFLICT",
          "This approval is no longer pending.",
        );
      if (now >= Math.min(job.expiresAt, entry.approval.expiresAt)) {
        transition(job, "expired", now, "APPROVAL_EXPIRED");
        job.error = {
          code: "APPROVAL_EXPIRED",
          retryable: false,
          message: "This approval expired.",
        };
      } else if (decision === "deny") {
        transition(job, "failed", now, sanitize(reason));
        job.error = {
          code: "APPROVAL_DENIED",
          retryable: false,
          message: sanitize(reason),
        };
      } else {
        entry.approval.decidedAt = now;
        entry.approval.grantUntil = Math.min(now + GRANT_TTL, job.expiresAt);
        transition(
          job,
          "running",
          now,
          "Owner granted one use of the exact pending action.",
        );
        job.nextFireAt = now;
      }
      delete job.alert;
      return { job, value: job };
    });
  }
  async claim(owner: string, id: string) {
    return this.mutate(owner, (jobs, now) => {
      const job = this.find(jobs, id);
      if (
        now >= job.expiresAt ||
        job.nextFireAt > now ||
        !["queued", "running"].includes(job.state)
      )
        return;
      if (job.lease && job.lease.until > now) return;
      if (job.lease)
        job.attempt.spentMs += Math.max(
          0,
          job.lease.until - job.lease.acquiredAt,
        );
      if (job.state === "queued")
        transition(job, "running", now, "Firing claimed.");
      else
        audit(
          job,
          now,
          "recovery",
          "Resuming the same attempt after approval or stale lease.",
        );
      job.fence++;
      job.lease = {
        holder: this.deps.holder,
        until: now + LEASE_TTL,
        acquiredAt: now,
      };
      if (!job.attempt.startedAt) job.attempt.startedAt = now;
      audit(job, now, "lease", `Claimed fence ${job.fence}`);
      return { job, value: job };
    });
  }
  private async fenced(
    owner: string,
    id: string,
    fence: number,
    fn: (job: Job, now: number) => void,
  ) {
    return this.mutate(owner, (jobs, now) => {
      const job = this.find(jobs, id);
      assertLease(job, fence, this.deps.holder, now);
      fn(job, now);
      return { job, value: job };
    });
  }
  async heartbeat(job: Job) {
    return this.fenced(job.owner, job.id, job.fence, (current, now) => {
      current.lease!.until = now + LEASE_TTL;
    });
  }
  async fire(owner: string, id: string) {
    const job = await this.claim(owner, id);
    if (!job) return;
    const started = this.deps.now();
    let stopped = false;
    const guard = async () => {
      if (stopped)
        throw new JobError("STALE_FENCE", "This firing has stopped.");
      const current = await this.inspect(owner, id);
      assertLease(current, job.fence, this.deps.holder, this.deps.now());
      if (current.attempt.spentMs + this.deps.now() - started >= RUN_BUDGET)
        throw new JobError(
          "RUN_BUDGET",
          "This background attempt reached its time budget.",
        );
    };
    const write = (fn: (job: Job, now: number) => void) =>
      this.fenced(owner, id, job.fence, fn);
    const turn: DurableTurn = {
      checkpoint: job.attempt.checkpoint,
      guard,
      save: async (checkpoint) => {
        await guard();
        // Tool arguments must survive exactly; secret-bearing arguments are
        // refused before persistence or execution instead of rewritten.
        for (const call of checkpoint.response.choices[0]?.message.tool_calls ??
          [])
          assertNoSecrets(call.function.arguments);
        await write((j, now) => {
          j.attempt.checkpoint = bounded(sanitize(checkpoint), 256 * 1024);
          audit(j, now, "round", `Checkpoint ${checkpoint.round}`);
        });
      },
      execute: async (input, dispatch) => {
        await guard();
        const fingerprint = createHash("sha256")
          .update(toolCallFingerprint(input.name, input.rawArgs))
          .digest("hex");
        input.prepareBackgroundApproval = (name, args, summary) => {
          assertNoSecrets(args);
          if (name === "computer_propose_task")
            throw new JobError(
              "MANUAL_ACTION_REQUIRED",
              "This task needs the Computer panel; no executable background command was supplied.",
            );
          return {
            traceStep: {
              kind: "tool",
              title: "Approval needed",
              detail: sanitize(summary),
            },
            resultPayload: {
              status: "approval_required",
              approval_id: `${job.attempt.id}:${fingerprint.slice(0, 24)}`,
              summary: sanitize(summary),
              background_action: { name, args },
              origin: {
                botId: job.bot.id,
                taskId: job.id,
                attemptId: job.attempt.id,
              },
            },
          };
        };
        let current = await this.inspect(owner, id);
        const cached = completed(current, fingerprint);
        if (cached?.output) return cached.output;
        let entry = current.attempt.tools.find(
          (t) => t.fingerprint === fingerprint,
        );
        if (
          (entry?.phase === "intent" &&
            TOOL_REGISTRY[input.name]?.risk !== "read-only") ||
          entry?.phase === "executing"
        )
          throw new JobError(
            "OUTCOME_UNKNOWN",
            "The server stopped during a tool step. Its outcome needs review; it was not repeated.",
          );
        if (entry?.phase === "approval") {
          if (
            !entry.approval?.grantUntil ||
            entry.approval.grantUntil <= this.deps.now()
          )
            throw new JobError(
              "APPROVAL_EXPIRED",
              "The one-time approval grant expired.",
            );
          await write((j, now) => {
            j.attempt.tools.find((t) => t.fingerprint === fingerprint)!.phase =
              "executing";
            audit(j, now, "grant", `Consumed grant ${entry!.approval!.id}`);
          });
          const approvedEntry = entry;
          const grantGuard = async () => {
            await guard();
            if (this.deps.now() >= approvedEntry.approval!.grantUntil!)
              throw new JobError(
                "APPROVAL_EXPIRED",
                "The one-time grant expired before execution.",
              );
          };
          const output = bounded(
            sanitize(await this.deps.resolve(current, entry, grantGuard)),
          );
          await guard();
          await write((j, now) => {
            Object.assign(
              j.attempt.tools.find((t) => t.fingerprint === fingerprint)!,
              { phase: "completed", output },
            );
            audit(
              j,
              now,
              "tool",
              `${fingerprint}: completed after approval ${JSON.stringify(output)}`,
            );
          });
          return output;
        }
        assertNoSecrets(input.rawArgs);
        await write((j, now) => {
          if (j.attempt.tools.length >= 80)
            throw new JobError(
              "JOURNAL_LIMIT",
              "This attempt reached its tool limit.",
            );
          if (!j.attempt.tools.some((t) => t.fingerprint === fingerprint))
            j.attempt.tools.push({
              fingerprint,
              name: input.name,
              arguments: bounded(input.rawArgs),
              phase: "intent",
            });
          audit(j, now, "tool", `${fingerprint}: ${input.name} intent`);
        });
        const output = bounded(sanitize(await dispatch()));
        await guard();
        const payload = output.resultPayload as {
          status?: string;
          summary?: string;
          approval_id?: string;
          action_id?: string;
          command_id?: string;
          proposal_id?: string;
        };
        if (payload?.status === "approval_required") {
          const approvalId =
            payload.approval_id ??
            payload.action_id ??
            payload.command_id ??
            payload.proposal_id;
          if (!approvalId)
            throw new JobError(
              "INVALID_APPROVAL",
              "The tool did not provide an approval identifier.",
            );
          await write((j, now) => {
            const tool = j.attempt.tools.find(
              (t) => t.fingerprint === fingerprint,
            )!;
            Object.assign(tool, {
              phase: "approval",
              output,
              approval: {
                id: approvalId,
                expiresAt: Math.min(now + APPROVAL_TTL, j.expiresAt),
              },
            });
            j.attempt.spentMs += now - started;
            transition(
              j,
              "awaiting_approval",
              now,
              `${input.name}: ${payload.summary ?? "Owner approval needed"}`,
            );
            j.alert = {
              id: approvalId,
              kind: "approval",
              body: `${payload.summary ?? input.name}. Why: this changes connected data or runs an action. Review the exact action before approving. Expires ${new Date(tool.approval!.expiresAt).toISOString()}.`,
            };
          });
          throw new JobError("PARKED", "Waiting for owner approval.");
        }
        await write((j, now) => {
          Object.assign(
            j.attempt.tools.find((t) => t.fingerprint === fingerprint)!,
            { phase: "completed", output },
          );
          audit(
            j,
            now,
            "tool",
            `${fingerprint}: completed ${JSON.stringify(output)}`,
          );
        });
        return output;
      },
    };
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const heartbeat = setInterval(() => {
      void this.heartbeat(job).catch(() => {
        stopped = true;
      });
    }, LEASE_TTL / 3);
    try {
      const result = bounded(
        sanitize(
          await Promise.race([
            this.deps.run(job, turn),
            new Promise<never>((_, reject) => {
              deadline = setTimeout(
                () => {
                  stopped = true;
                  reject(
                    new JobError(
                      "RUN_BUDGET",
                      "This background attempt reached its time budget.",
                    ),
                  );
                },
                Math.max(1, RUN_BUDGET - job.attempt.spentMs),
              );
            }),
          ]),
        ),
      );
      await guard();
      await write((j, now) => {
        j.result = result;
        j.attempt.spentMs += now - started;
        audit(
          j,
          now,
          "result",
          `Attempt ${j.attempt.id} completed: ${JSON.stringify(result)}`,
        );
        j.alert = {
          id: j.attempt.id,
          kind: "completion",
          body: "Your background job has a result ready.",
        };
        if (j.intervalMs) {
          transition(
            j,
            "queued",
            now,
            "Recurring firing complete; missed intervals are coalesced.",
          );
          j.nextFireAt +=
            (Math.floor((now - j.nextFireAt) / j.intervalMs) + 1) *
            j.intervalMs;
          j.attempt = {
            id: `${j.id}:${j.attempt.firing + 1}`,
            firing: j.attempt.firing + 1,
            startedAt: 0,
            spentMs: 0,
            tools: [],
          };
        } else transition(j, "done", now, "Result ready.");
      });
    } catch (error) {
      if (
        error instanceof JobError &&
        ["PARKED", "STALE_FENCE"].includes(error.code)
      )
        return;
      await write((j, now) => {
        const code = error instanceof JobError ? error.code : "FAILED";
        transition(
          j,
          code === "APPROVAL_EXPIRED" || code === "JOB_EXPIRED"
            ? "expired"
            : "failed",
          now,
          code,
        );
        j.error = {
          code,
          retryable: error instanceof JobError && error.retryable,
          message: sanitize(
            error instanceof Error ? error.message : "Background job failed.",
          ),
        };
        j.alert = {
          id: `${j.attempt.id}:failure`,
          kind: "completion",
          body: `Your background job stopped: ${code}. Review its journal.`,
        };
      }).catch((e) => {
        if (!(
          e instanceof JobError &&
          ["STALE_FENCE", "JOB_EXPIRED"].includes(e.code)
        ))
          throw e;
      });
    } finally {
      stopped = true;
      clearInterval(heartbeat);
      if (deadline) clearTimeout(deadline);
    }
  }
  async reconcile() {
    for (const owner of await this.deps.store.owners()) {
      for (const snapshot of await this.list(owner)) {
        await this.mutate(owner, (jobs, now) => {
          const job = this.find(jobs, snapshot.id);
          if (!active(job.state)) return;
          const pending = job.attempt.tools.find(
            (t) => t.phase === "approval",
          )?.approval;
          const expired =
            now >= job.expiresAt ||
            (job.state === "awaiting_approval" &&
              pending &&
              now >= pending.expiresAt);
          if (!expired) return;
          transition(
            job,
            "expired",
            now,
            "Job or approval expired during reconciliation.",
          );
          job.error = {
            code: pending ? "APPROVAL_EXPIRED" : "JOB_EXPIRED",
            retryable: false,
            message: "The job or approval expired.",
          };
          job.alert = {
            id: `${job.attempt.id}:expired`,
            kind: "completion",
            body: "Your background job expired. Review its journal.",
          };
          return { job, value: true };
        });
      }
    }
  }
  async deliverAlerts() {
    for (const owner of await this.deps.store.owners())
      for (const job of await this.list(owner)) {
        if (!job.alert || job.alert.sent) continue;
        const claimed = await this.mutate(owner, (jobs, now) => {
          const current = this.find(jobs, job.id);
          if (
            current.alert?.id !== job.alert!.id ||
            current.alert.sent ||
            (current.alert.nextTryAt ?? 0) > now
          )
            return;
          current.alert.nextTryAt = now + 60_000;
          return { job: current, value: current };
        });
        if (!claimed) continue;
        if (await this.deps.notify(claimed))
          await this.mutate(owner, (jobs) => {
            const current = this.find(jobs, job.id);
            if (current.alert?.id !== job.alert!.id) return;
            current.alert.sent = true;
            return { job: current, value: true };
          });
      }
  }
}

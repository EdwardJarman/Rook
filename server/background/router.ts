import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { backgroundRuntime } from "./service";
import { JobError } from "./model";
import type { BackgroundRuntime } from "./runtime";

// Typed domain errors survive tRPC serialization, including retryability.
async function outcome<T>(run: () => Promise<T>) {
  try {
    return { ok: true as const, value: await run() };
  } catch (error) {
    if (error instanceof JobError)
      return {
        ok: false as const,
        error: {
          code: error.code,
          retryable: error.retryable,
          message: error.message,
        },
      };
    throw error;
  }
}
const jobId = z.object({ id: z.string().uuid() });
export function createBackgroundRouter(runtime: BackgroundRuntime) {
  return router({
    schedule: protectedProcedure
      .input(
        z.object({
          bot: z.object({
            id: z.string().min(1).max(128),
            name: z.string().min(1).max(80),
            role: z.string().max(120),
            purpose: z.string().max(500),
            model: z.string().max(180).optional(),
          }),
          prompt: z.string().min(1).max(4000),
          at: z.number().int().optional(),
          intervalMs: z.number().int().min(60_000).optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        outcome(() => runtime.schedule(ctx.user.id, input)),
      ),
    list: protectedProcedure.query(({ ctx }) =>
      outcome(async () =>
        (await runtime.list(ctx.user.id)).map(
          ({ attempt, journal, ...job }) => job,
        ),
      ),
    ),
    status: protectedProcedure.query(({ ctx }) =>
      outcome(() => runtime.status(ctx.user.id)),
    ),
    cancel: protectedProcedure
      .input(jobId)
      .mutation(({ ctx, input }) =>
        outcome(() => runtime.cancel(ctx.user.id, input.id)),
      ),
    inspect: protectedProcedure
      .input(jobId)
      .query(({ ctx, input }) =>
        outcome(() => runtime.inspect(ctx.user.id, input.id)),
      ),
    approve: protectedProcedure
      .input(
        jobId.extend({
          approvalId: z.string().min(1).max(128),
          decision: z.enum(["approve", "deny"]),
          reason: z.string().max(500).optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        outcome(() =>
          runtime.decide(
            ctx.user.id,
            input.id,
            input.approvalId,
            input.decision,
            input.reason,
          ),
        ),
      ),
  });
}
export const backgroundRouter = createBackgroundRouter(backgroundRuntime);

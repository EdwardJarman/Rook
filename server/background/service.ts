import { randomUUID } from "node:crypto";
import * as db from "../db";
import { runRookAgent } from "../integrations/excel-agent";
import {
  executeValidatedExcelWrite,
  EXCEL_WRITE_TOOL_NAMES,
  type ExcelToolName,
} from "../integrations/excel-tools";
import { prepareComputerCommandProposal } from "../integrations/cloud-tools";
import { executeCloudCommand } from "../integrations/cloud-computer";
import { isCloudNodeId } from "../../shared/node-relay";
import {
  checkToolPolicy,
  loadToolPolicyFromEnv,
} from "../integrations/tool-policy";
import { sendExpoPushAlert } from "../push-alerts";
import { BackgroundRuntime } from "./runtime";
import { InstantJobStore } from "./store";
import { JobError, type Job, type ToolOutcome } from "./model";
import type { AgentToolExecution } from "../integrations/agent-tool-executor";

async function resolve(
  job: Job,
  tool: ToolOutcome,
  guard: () => Promise<void>,
): Promise<AgentToolExecution> {
  const payload = {
    ...(tool.output!.resultPayload as {
      action_id?: string;
      command_id?: string;
      summary?: string;
      background_action?: { name: string; args: Record<string, unknown> };
    }),
  };
  const done = (result: unknown): AgentToolExecution => ({
    traceStep: { kind: "tool", title: "Approved action completed" },
    resultPayload: { status: "completed", result },
  });
  const action = payload.background_action;
  if (action) {
    const policy = checkToolPolicy(action.args, loadToolPolicyFromEnv());
    if (!policy.allowed) throw new JobError(policy.code, policy.reason);
    await guard();
    if (EXCEL_WRITE_TOOL_NAMES.has(action.name as ExcelToolName)) {
      payload.action_id = randomUUID();
      await db.createExcelPendingAction({
        id: payload.action_id,
        userId: job.owner,
        botClientId: job.bot.id,
        taskClientId: job.id,
        toolName: action.name,
        arguments: action.args,
        summary: payload.summary ?? action.name,
        state: "pending",
        expiresAt: new Date(tool.approval!.grantUntil!),
      });
    } else if (
      action.name === "computer_run_command" ||
      action.name === "computer_write_file"
    ) {
      const prepared = await prepareComputerCommandProposal({
        userId: job.owner,
        botId: job.bot.id,
        name: action.name,
        args: action.args,
      });
      payload.command_id = prepared.commandId;
    } else
      throw new JobError(
        "MANUAL_ACTION_REQUIRED",
        "This proposal needs the Computer panel; it has no executable command.",
      );
  }
  if (payload.action_id) {
    const existing = await db.getExcelPendingAction(
      job.owner,
      payload.action_id,
    );
    if (!existing || existing.expiresAt.getTime() <= Date.now())
      throw new JobError("APPROVAL_EXPIRED", "The Excel action expired.");
    const policy = checkToolPolicy(existing.arguments, loadToolPolicyFromEnv());
    if (!policy.allowed) throw new JobError(policy.code, policy.reason);
    const action = await db.claimExcelPendingAction(
      job.owner,
      payload.action_id,
    );
    if (!action)
      throw new JobError(
        "OUTCOME_UNKNOWN",
        "The Excel action was already claimed. It was not repeated.",
      );
    try {
      await guard();
      const result = await executeValidatedExcelWrite(
        job.owner,
        action.toolName as ExcelToolName,
        action.arguments,
      );
      await db.finishExcelPendingAction(job.owner, payload.action_id, {
        state: "executed",
        result,
      });
      return done(result);
    } catch (error) {
      await db.finishExcelPendingAction(job.owner, payload.action_id, {
        state: "failed",
        result: { code: "OUTCOME_UNKNOWN" },
      });
      throw error;
    }
  }
  if (payload.command_id) {
    const command = await db.getNodeCommandById(payload.command_id);
    if (!command || command.userId !== job.owner)
      throw new JobError("NOT_FOUND", "The command is unavailable.");
    const envelopeExpiry =
      typeof command.envelope.deadline === "number"
        ? command.envelope.deadline
        : command.expiresAt.getTime();
    if (Math.min(command.expiresAt.getTime(), envelopeExpiry) <= Date.now())
      throw new JobError(
        "APPROVAL_EXPIRED",
        "The command expired before approval.",
      );
    const policy = checkToolPolicy(
      (command.envelope.action ?? {}) as Record<string, unknown>,
      loadToolPolicyFromEnv(),
    );
    if (!policy.allowed) throw new JobError(policy.code, policy.reason);
    if (command.state !== "awaiting_approval")
      throw new JobError(
        "OUTCOME_UNKNOWN",
        "The command was already handled outside this job.",
      );
    await guard();
    await db.decideNodeCommand(job.owner, payload.command_id, "approved");
    if (isCloudNodeId(command.nodeId)) {
      await guard();
      const result = await executeCloudCommand(payload.command_id);
      if (!result.ok)
        throw new JobError(
          "TOOL_FAILED",
          result.message ?? "The cloud command failed.",
        );
      return done(result.result);
    }
    // The existing relay delivers the one-time granted command to Rook Node.
    for (let i = 0; i < 50; i++) {
      const current = await db.getNodeCommandById(payload.command_id);
      if (current?.state === "completed") {
        const report = current.result as {
          ok?: boolean;
          result?: unknown;
          message?: string;
        };
        if (!report?.ok)
          throw new JobError(
            "TOOL_FAILED",
            report?.message ?? "The computer command failed.",
          );
        return done(report.result);
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new JobError(
      "OUTCOME_UNKNOWN",
      "The computer has not reported a result. Check its command record; it will not be submitted again.",
    );
  }
  throw new JobError(
    "MANUAL_ACTION_REQUIRED",
    "This computer proposal needs the Computer panel. No executable command was supplied.",
  );
}

export const backgroundRuntime = new BackgroundRuntime({
  store: new InstantJobStore(),
  now: Date.now,
  id: randomUUID,
  holder: randomUUID(),
  run: async (job, durableTurn) => {
    const result = await runRookAgent({
      userId: job.owner,
      botId: job.bot.id,
      taskId: job.id,
      botName: job.bot.name,
      botRole: job.bot.role,
      botPurpose: job.bot.purpose,
      model: job.bot.model,
      message: job.prompt,
      recentContext: [],
      durableTurn,
    });
    if ("error" in result && result.error)
      throw new JobError("AGENT_FAILED", result.error);
    return { text: result.text, files: result.files, model: result.model };
  },
  resolve,
  notify: async (job) => {
    if (!job.alert) return true;
    const preferences = await db.getNotificationPreferences(job.owner);
    const enabled =
      job.alert.kind === "approval"
        ? preferences?.approvalEnabled !== false
        : preferences?.completionEnabled !== false;
    if (!enabled) return true;
    const devices = (await db.getPushDevicesForUser(job.owner)).filter((d) =>
      job.alert!.kind === "approval" ? d.approvalEnabled : d.completionEnabled,
    );
    const results = await Promise.all(
      devices.map((d) =>
        sendExpoPushAlert(
          {
            expoPushToken: d.expoPushToken,
            kind: job.alert!.kind,
            title:
              job.alert!.kind === "approval"
                ? `${job.bot.name} needs your approval`
                : `${job.bot.name}: background result`,
            body: job.alert!.body.slice(0, 500),
            url: `/background-job?id=${encodeURIComponent(job.id)}`,
          },
          AbortSignal.timeout(10_000),
        ),
      ),
    );
    return results.every((result) => result.accepted);
  },
});

/** Start only in the persistent Node server, never during router import or in a
 * short-lived serverless request. The store is authoritative across processes. */
export function startBackgroundRuntime(runtime = backgroundRuntime) {
  const inFlight = new Map<string, Promise<void>>();
  let stopped = false;
  let ticking = false;
  const tick = async () => {
    if (stopped || ticking) return;
    ticking = true;
    try {
      await runtime.reconcile();
      await runtime.deliverAlerts();
      for (const owner of await runtime.deps.store.owners())
        for (const job of await runtime.list(owner)) {
          if (inFlight.size >= 4) break;
          if (
            inFlight.has(job.id) ||
            !["queued", "running"].includes(job.state) ||
            job.nextFireAt > runtime.deps.now() ||
            (job.lease && job.lease.until > runtime.deps.now())
          )
            continue;
          const promise = runtime
            .fire(owner, job.id)
            .catch(() =>
              console.warn(
                "[background] firing failed; persisted state will be reconciled",
              ),
            )
            .finally(() => {
              inFlight.delete(job.id);
            });
          inFlight.set(job.id, promise);
        }
    } catch {
      console.warn(
        "[background] persistence unavailable; retrying on next tick",
      );
    } finally {
      ticking = false;
    }
  };
  const timer = setInterval(() => void tick(), 5000);
  (timer as unknown as { unref?: () => void }).unref?.();
  void tick();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

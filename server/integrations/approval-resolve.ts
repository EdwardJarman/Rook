/**
 * The single implementation of "approve this pending action", shared by the
 * user's explicit tap (tRPC `excel.resolveAction`) and a permission-level
 * auto-approval, so both paths claim, expire, execute and record identically.
 */

import * as db from "../db";
import { executeValidatedExcelWrite, type ExcelToolName } from "./excel-tools";
import { executeCloudCommand } from "./cloud-computer";
import { isCloudNodeId } from "../../shared/node-relay";

export async function resolveExcelPendingAction(
  userId: string,
  actionId: string,
  decision: "approve" | "decline",
) {
  const action = await db.claimExcelPendingAction(userId, actionId);
  if (!action) throw new Error("This Excel action is already being handled or is no longer pending");
  if (action.expiresAt.getTime() <= Date.now()) {
    await db.finishExcelPendingAction(userId, action.id, { state: "expired" });
    throw new Error("This Excel approval expired. Ask the Bot to prepare it again");
  }
  if (decision === "decline") {
    await db.finishExcelPendingAction(userId, action.id, { state: "declined" });
    return {
      executed: false,
      declined: true,
      summary: action.summary,
      botId: action.botClientId,
      taskId: action.taskClientId,
    };
  }
  let result: unknown;
  try {
    result = await executeValidatedExcelWrite(
      userId,
      action.toolName as ExcelToolName,
      action.arguments as Record<string, unknown>,
    );
    await db.finishExcelPendingAction(userId, action.id, { state: "executed", result });
  } catch (error) {
    await db.finishExcelPendingAction(userId, action.id, {
      state: "failed",
      result: { message: error instanceof Error ? error.message : "Excel write failed" },
    });
    throw error;
  }
  return {
    executed: true,
    declined: false,
    summary: action.summary,
    result,
    botId: action.botClientId,
    taskId: action.taskClientId,
  };
}

/**
 * Approve a queued computer command now. Cloud commands run inline; commands
 * for a paired device are released to the existing relay and report back later.
 */
export async function approveAndRunCommand(userId: string, commandId: string) {
  const record = await db.decideNodeCommand(userId, commandId, "approved");
  if (!record) throw new Error("The command is no longer available.");
  if (isCloudNodeId(record.nodeId)) {
    const outcome = await executeCloudCommand(commandId);
    if (!outcome.ok) throw new Error(outcome.message ?? "The cloud command failed.");
    return { dispatched: false as const, result: outcome.result };
  }
  return { dispatched: true as const };
}

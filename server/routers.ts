import { z } from "zod";

import { normalizeWorkroomSnapshot } from "../shared/workroom-snapshot";
import {
  buildCommandEnvelope,
  generateCommandId,
  isSensitiveCapability,
} from "../shared/node-relay";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { systemRouter } from "./_core/systemRouter";
import { getAiBackendStatus, listAiModels } from "./ai";
import { transcribeOpenRouterAudio } from "./ai/openrouter";
import { deleteChatGPTSession } from "./ai/chatgpt";
import * as db from "./db";
import { runRookAgent } from "./integrations/excel-agent";
import { executeValidatedExcelWrite, type ExcelToolName } from "./integrations/excel-tools";
import {
  createMicrosoftAuthorizationUrl,
  disconnectMicrosoftAccount,
  listExcelTables,
  listExcelWorkbooks,
  listExcelWorksheets,
  microsoftConnectionStatus,
  readExcelRange,
  setPrimaryMicrosoftAccount,
} from "./integrations/microsoft-excel";
import { sendExpoPushAlert } from "./push-alerts";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(() => ({ success: true } as const)),
  }),
  workroom: router({
    reply: protectedProcedure.input(z.object({
      botId: z.string().min(1).max(128),
      taskId: z.string().min(1).max(128),
      botName: z.string().min(1).max(80),
      botRole: z.string().min(1).max(120),
      botPurpose: z.string().min(1).max(500),
      model: z.string().min(1).max(180).optional(),
      message: z.string().min(1).max(4000),
      userTimeZone: z.string().min(1).max(80).optional(),
      connectors: z.array(z.enum(["microsoft-excel"])).max(4).optional(),
      recentContext: z.array(z.object({
        author: z.enum(["user", "bot", "system"]),
        body: z.string().max(2000),
      })).max(8),
    })).mutation(async ({ ctx, input }) => {
      const result = await runRookAgent({ userId: ctx.user.id, request: ctx.req, ...input });
      const preferences = await db.getNotificationPreferences(ctx.user.id);
      const needsApproval = result.approvals.length > 0;
      const notificationEnabled = needsApproval
        ? preferences?.approvalEnabled !== false
        : preferences?.completionEnabled !== false;
      const devices = notificationEnabled ? await db.getPushDevicesForUser(ctx.user.id) : [];
      const deliveries = await Promise.all(
        devices
          .filter((device) => needsApproval ? device.approvalEnabled : device.completionEnabled)
          .map((device) => sendExpoPushAlert({
            expoPushToken: device.expoPushToken,
            kind: needsApproval ? "approval" : "completion",
            title: needsApproval ? `${input.botName} prepared an Excel change` : `${input.botName} completed a task`,
            body: result.text.slice(0, 170),
            url: needsApproval ? "/activity" : "/",
          })),
      );
      return {
        ...result,
        pushDelivery: {
          accepted: deliveries.some((delivery) => delivery.accepted),
          recipients: deliveries.filter((delivery) => delivery.accepted).length,
        },
      };
    }),
  }),
  ai: router({
    status: protectedProcedure
      .input(z.object({ provider: z.enum(["openrouter", "orcarouter", "tokenrouter"]).default("openrouter") }))
      .query(({ input }) => getAiBackendStatus(input.provider)),
    models: protectedProcedure.query(async ({ ctx }) => ({
      provider: "multi" as const,
      models: await listAiModels(ctx.req),
    })),
  }),
  voice: router({
    transcribe: protectedProcedure
      .input(z.object({
        data: z.string().min(16).max(12_000_000),
        format: z.enum(["wav", "mp3", "aac", "ogg", "flac", "m4a", "webm"]),
      }))
      .mutation(async ({ input }) => ({ text: await transcribeOpenRouterAudio(input) })),
  }),
  excel: router({
    status: protectedProcedure.query(({ ctx }) => microsoftConnectionStatus(ctx.user.id)),
    authorizationUrl: protectedProcedure
      .input(z.object({ returnTo: z.string().url().max(500).optional() }))
      .mutation(({ ctx, input }) => createMicrosoftAuthorizationUrl(ctx.user.id, input.returnTo)),
    disconnect: protectedProcedure.mutation(({ ctx }) => db.deleteMicrosoftConnection(ctx.user.id)),
    disconnectAccount: protectedProcedure
      .input(z.object({ accountId: z.string().min(1).max(80) }))
      .mutation(({ ctx, input }) => disconnectMicrosoftAccount(ctx.user.id, input.accountId)),
    setPrimaryAccount: protectedProcedure
      .input(z.object({ accountId: z.string().min(1).max(80) }))
      .mutation(async ({ ctx, input }) => {
        await setPrimaryMicrosoftAccount(ctx.user.id, input.accountId);
        return { ok: true };
      }),
    workbooks: protectedProcedure
      .input(z.object({ accountId: z.string().min(1).max(80).optional() }).optional())
      .query(({ ctx, input }) => listExcelWorkbooks(ctx.user.id, input?.accountId)),
    workbookStructure: protectedProcedure
      .input(z.object({
        driveId: z.string().min(1).max(255),
        itemId: z.string().min(1).max(255),
        accountId: z.string().min(1).max(80).optional(),
      }))
      .query(async ({ ctx, input }) => {
        const [worksheets, tables] = await Promise.all([
          listExcelWorksheets(ctx.user.id, input.driveId, input.itemId, input.accountId),
          listExcelTables(ctx.user.id, input.driveId, input.itemId, input.accountId),
        ]);
        return { worksheets, tables };
      }),
    readRange: protectedProcedure
      .input(z.object({
        driveId: z.string().min(1).max(255),
        itemId: z.string().min(1).max(255),
        worksheet: z.string().min(1).max(31),
        address: z.string().min(2).max(40),
        accountId: z.string().min(1).max(80).optional(),
      }))
      .query(({ ctx, input }) => readExcelRange(ctx.user.id, input)),
    pendingActions: protectedProcedure.query(async ({ ctx }) =>
      (await db.listPendingExcelActions(ctx.user.id)).map((action) => ({
        id: action.id,
        botClientId: action.botClientId,
        taskClientId: action.taskClientId,
        summary: action.summary,
        expiresAt: action.expiresAt.toISOString(),
        createdAt: action.createdAt.toISOString(),
      })),
    ),
    resolveAction: protectedProcedure
      .input(z.object({ actionId: z.string().min(1).max(96), decision: z.enum(["approve", "decline"]) }))
      .mutation(async ({ ctx, input }) => {
        const action = await db.claimExcelPendingAction(ctx.user.id, input.actionId);
        if (!action) throw new Error("This Excel action is already being handled or is no longer pending");
        if (action.expiresAt.getTime() <= Date.now()) {
          await db.finishExcelPendingAction(ctx.user.id, action.id, { state: "expired" });
          throw new Error("This Excel approval expired. Ask the Bot to prepare it again");
        }
        if (input.decision === "decline") {
          await db.finishExcelPendingAction(ctx.user.id, action.id, { state: "declined" });
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
            ctx.user.id,
            action.toolName as ExcelToolName,
            action.arguments as Record<string, unknown>,
          );
          await db.finishExcelPendingAction(ctx.user.id, action.id, { state: "executed", result });
        } catch (error) {
          await db.finishExcelPendingAction(ctx.user.id, action.id, {
            state: "failed",
            result: {
              message: error instanceof Error ? error.message : "Excel write failed",
            },
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
      }),
  }),
  notifications: router({
    register: protectedProcedure.input(z.object({
      installationId: z.string().min(12).max(96),
      expoPushToken: z.string().min(12).max(255),
      approvalEnabled: z.boolean(),
      completionEnabled: z.boolean(),
    })).mutation(({ ctx, input }) => db.upsertPushDevice(ctx.user.id, input).then((registered) => ({ registered }))),
    deliver: protectedProcedure.input(z.object({
      kind: z.enum(["approval", "completion"]),
      title: z.string().min(1).max(120),
      body: z.string().min(1).max(500),
      url: z.string().min(1).max(160),
    })).mutation(async ({ ctx, input }) => {
      const preferences = await db.getNotificationPreferences(ctx.user.id);
      const enabled = input.kind === "approval" ? preferences?.approvalEnabled !== false : preferences?.completionEnabled !== false;
      if (!enabled) return { accepted: false, recipients: 0 };
      const devices = await db.getPushDevicesForUser(ctx.user.id);
      const deliveries = await Promise.all(
        devices
          .filter((device) => input.kind === "approval" ? device.approvalEnabled : device.completionEnabled)
          .map((device) => sendExpoPushAlert({ expoPushToken: device.expoPushToken, ...input })),
      );
      return {
        accepted: deliveries.some((delivery) => delivery.accepted),
        recipients: deliveries.filter((delivery) => delivery.accepted).length,
      };
    }),
  }),
  cloud: router({
    // `accountScope` deliberately becomes part of the client query key. The
    // server still derives authorization exclusively from `ctx.user.id`, so a
    // cached workroom can never cross from one Clerk account to another.
    load: protectedProcedure
      .input(z.object({ accountScope: z.string().min(1).max(128) }).optional())
      .query(async ({ ctx }) => {
        const record = await db.getWorkroomSnapshot(ctx.user.id);
        return { snapshot: record?.snapshot ?? null, updatedAt: record?.updatedAt?.toISOString() ?? null };
      }),
    save: protectedProcedure.input(z.object({ snapshot: z.record(z.string(), z.unknown()) })).mutation(async ({ ctx, input }) => {
      const snapshot = normalizeWorkroomSnapshot(input.snapshot);
      return { saved: await db.saveWorkroomState(ctx.user.id, snapshot) };
    }),
  }),
  records: router({ list: protectedProcedure.query(({ ctx }) => db.listNormalizedWorkroomRecords(ctx.user.id)) }),
  preferences: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      const stored = await db.getNotificationPreferences(ctx.user.id);
      return { approval: stored?.approvalEnabled ?? true, completion: stored?.completionEnabled ?? true };
    }),
    save: protectedProcedure
      .input(z.object({ approval: z.boolean(), completion: z.boolean() }))
      .mutation(({ ctx, input }) => db.upsertNotificationPreferences(ctx.user.id, {
        approvalEnabled: input.approval,
        completionEnabled: input.completion,
      })),
  }),
  accountData: router({
    export: protectedProcedure.query(({ ctx }) => db.exportAccountWorkroomData(ctx.user.id)),
    delete: protectedProcedure
      .input(z.object({ confirmation: z.literal("DELETE") }))
      .mutation(async ({ ctx }) => {
        await deleteChatGPTSession(ctx.req);
        return db.deleteAccountWorkroomData(ctx.user.id);
      }),
  }),
  nodes: router({
    list: protectedProcedure.query(({ ctx }) => db.listRookNodesForUser(ctx.user.id)),
    createPairing: protectedProcedure.mutation(async ({ ctx }) => {
      const created = await db.createPairingToken(ctx.user.id);
      if (!created) throw new Error("Pairing is temporarily unavailable.");
      return { token: created.token, expiresAt: created.expiresAt.toISOString() };
    }),
    issueDesktopPairingCode: protectedProcedure
      .input(z.object({ requestId: z.string().regex(/^rkd-[a-f0-9]{48}$/i) }))
      .mutation(async ({ ctx, input }) => {
        const issued = await db.issueDesktopPairingCode(ctx.user.id, input.requestId.toLowerCase());
        if (!issued) throw new Error("This desktop connection has expired or is unavailable. Start again from Rook Node.");
        return { code: issued.code, expiresAt: issued.expiresAt.toISOString(), name: issued.name };
      }),
    rename: protectedProcedure.input(z.object({
      nodeId: z.string().min(4).max(80),
      name: z.string().min(1).max(80),
    })).mutation(({ ctx, input }) => db.renameRookNode(ctx.user.id, input.nodeId, input.name)),
    remove: protectedProcedure.input(z.object({
      nodeId: z.string().min(4).max(80),
    })).mutation(({ ctx, input }) => db.revokeRookNode(ctx.user.id, input.nodeId)),
    commands: protectedProcedure.query(({ ctx }) => db.listRecentNodeCommands(ctx.user.id)),
    requestCommand: protectedProcedure.input(z.object({
      nodeId: z.string().min(4).max(80),
      botId: z.string().min(1).max(128),
      pageId: z.string().min(1).max(128),
      pageRevision: z.number().int().nonnegative(),
      seq: z.number().int().positive(),
      capability: z.string().min(1).max(40),
      action: z.record(z.string(), z.unknown()),
      summary: z.string().min(1).max(300),
    })).mutation(async ({ ctx, input }) => {
      const envelope = buildCommandEnvelope({
        userId: ctx.user.id,
        botId: input.botId,
        pageId: input.pageId,
        pageRevision: input.pageRevision,
        capability: input.capability,
        action: input.action,
        seq: input.seq,
      });
      const record = await db.enqueueNodeCommand({
        commandId: generateCommandId(),
        userId: ctx.user.id,
        nodeId: input.nodeId,
        summary: input.summary,
        capability: input.capability,
        envelope,
        requiresApproval: isSensitiveCapability(input.capability),
      });
      if (!record) throw new Error("That computer is not available.");
      const needsApproval = record.state === "awaiting_approval";
      if (needsApproval) await notifyNodeApprovalRequest(ctx.user.id, input.summary);
      return {
        commandId: record.commandId,
        state: record.state,
        requiresApproval: needsApproval,
      };
    }),
    decideCommand: protectedProcedure.input(z.object({
      commandId: z.string().min(4).max(80),
      decision: z.enum(["approved", "declined"]),
    })).mutation(({ ctx, input }) =>
      db.decideNodeCommand(ctx.user.id, input.commandId, input.decision).then((record) => ({
        decided: Boolean(record?.state === "pending" || (record?.state === "declined" && input.decision === "declined")),
      })),
    ),
  }),
});

/** Pushes an "approval needed" alert to the owner's devices. */
async function notifyNodeApprovalRequest(userId: string, summary: string): Promise<void> {
  try {
    const preferences = await db.getNotificationPreferences(userId);
    if (preferences?.approvalEnabled === false) return;
    const devices = await db.getPushDevicesForUser(userId);
    await Promise.all(
      devices
        .filter((device) => device.approvalEnabled)
        .map((device) => sendExpoPushAlert({
          expoPushToken: device.expoPushToken,
          kind: "approval",
          title: "Rook Node needs your approval",
          body: summary.slice(0, 170),
          url: "/activity",
        })),
    );
  } catch {
    // Push delivery must never block the command path.
  }
}

export type AppRouter = typeof appRouter;

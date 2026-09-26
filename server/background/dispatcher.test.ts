import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../db", () => ({ createExcelPendingAction: vi.fn() }));
import * as db from "../db";
import { executeAgentTool } from "../integrations/agent-tool-executor";
import { registerHook, __resetHooksForTests } from "../ai/hooks";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  __resetHooksForTests();
});
const input = () => ({
  userId: "owner",
  botId: "bot",
  taskId: "job",
  name: "excel_create_workbook",
  rawArgs: '{"name":"Report"}',
  excelConnected: true,
  githubConnected: false,
  computerOnline: false,
  approvals: [],
  computerProposals: [],
});
const proposal = () =>
  vi.fn((name: string, args: Record<string, unknown>, summary: string) => ({
    traceStep: { kind: "tool" as const, title: summary },
    resultPayload: { status: "approval_required", name, args },
  }));

describe("shared dispatcher background proposals", () => {
  it("validates and parks without creating an executable foreground action", async () => {
    const prepareBackgroundApproval = proposal();
    const result = await executeAgentTool({
      ...input(),
      prepareBackgroundApproval,
    });
    expect(result.resultPayload).toMatchObject({
      status: "approval_required",
      args: { name: "Report" },
    });
    expect(db.createExcelPendingAction).not.toHaveBeenCalled();
    await expect(
      executeAgentTool({
        ...input(),
        rawArgs: "{}",
        prepareBackgroundApproval,
      }),
    ).rejects.toThrow();
    expect(prepareBackgroundApproval).toHaveBeenCalledTimes(1);
  });
  it("reviews the validated arguments after hook rewriting", async () => {
    registerHook(
      {
        name: "rewrite",
        run: async () => ({
          decision: "allow",
          updatedInput: { name: "Revised" },
        }),
      },
      "PreToolUse",
    );
    const prepareBackgroundApproval = proposal();
    await executeAgentTool({ ...input(), prepareBackgroundApproval });
    expect(prepareBackgroundApproval.mock.calls[0][1]).toEqual({
      name: "Revised",
    });
  });
  it("preserves policy and hook denies before the proposal sink", async () => {
    const prepareBackgroundApproval = proposal();
    vi.stubEnv("ROOK_TOOL_DENY_COMMANDS", "blocked");
    const denied = await executeAgentTool({
      ...input(),
      rawArgs: '{"name":"Report","command":"blocked"}',
      prepareBackgroundApproval,
    });
    expect(denied.resultPayload).toMatchObject({ code: "POLICY_DENIED" });
    registerHook(
      {
        name: "deny",
        run: async () => ({ decision: "deny", reason: "Stopped" }),
      },
      "PreToolUse",
    );
    const hooked = await executeAgentTool({
      ...input(),
      prepareBackgroundApproval,
    });
    expect(hooked.resultPayload).toMatchObject({ code: "HOOK_DENIED" });
    expect(prepareBackgroundApproval).not.toHaveBeenCalled();
  });
});

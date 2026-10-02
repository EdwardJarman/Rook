import { describe, expect, it } from "vitest";

import {
  executeAgentTool,
  retryableForCode,
  toolTimeoutError,
} from "../server/integrations/agent-tool-executor";
import type { ComputerProposal } from "../server/integrations/computer-tools";
import type { ExcelAgentApproval } from "../server/integrations/excel-agent";

const base: {
  userId: string;
  botId: string;
  taskId: string;
  rawArgs: string;
  excelConnected: boolean;
  githubConnected: boolean;
  computerOnline: boolean;
  approvals: ExcelAgentApproval[];
  computerProposals: ComputerProposal[];
} = {
  userId: "user-1",
  botId: "bot-1",
  taskId: "task-1",
  rawArgs: "{}",
  excelConnected: false,
  githubConnected: false,
  computerOnline: false,
  approvals: [],
  computerProposals: [],
};

describe("grok tool error codes (machine-readable failures)", () => {
  it("marks only transient codes retryable", () => {
    expect(retryableForCode("TIMEOUT")).toBe(true);
    expect(retryableForCode("WORKSPACE_UNAVAILABLE")).toBe(true);
    expect(retryableForCode("POLICY_DENIED")).toBe(false);
    expect(retryableForCode("NOT_PREPARED")).toBe(false);
    expect(retryableForCode("UNKNOWN_TOOL")).toBe(false);
    expect(retryableForCode("FAILED")).toBe(false);
    expect(retryableForCode("APPROVAL_REQUIRED")).toBe(false);
  });

  it("timeout errors carry code without changing the message", () => {
    const error = toolTimeoutError("GitHub tool github_read_file");
    expect(error.message).toBe("GitHub tool github_read_file timed out");
    expect(error.code).toBe("TIMEOUT");
    expect(error.retryable).toBe(true);
  });

  it("unknown tools report UNKNOWN_TOOL and must not retry", async () => {
    const turn = await executeAgentTool({ ...base, name: "nope" });
    const payload = turn.resultPayload as Record<string, unknown>;
    expect(payload.status).toBe("error");
    expect(payload.code).toBe("UNKNOWN_TOOL");
    expect(payload.retryable).toBe(false);
  });

  it("proposal caps report NOT_PREPARED and must not retry", async () => {
    const turn = await executeAgentTool({
      ...base,
      name: "computer_propose_task",
      rawArgs: JSON.stringify({ title: "Valid test task" }),
      computerProposals: [
        { proposalId: "p1", title: "First" },
        { proposalId: "p2", title: "Second" },
      ],
    });
    const payload = turn.resultPayload as Record<string, unknown>;
    expect(payload.status).toBe("not_prepared");
    expect(payload.code).toBe("NOT_PREPARED");
    expect(payload.retryable).toBe(false);
  });
});

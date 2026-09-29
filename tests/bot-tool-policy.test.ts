import { expect, it, vi } from "vitest";
vi.mock("../server/db", () => ({ listRookNodesForUser: vi.fn(async () => []) }));
import { executeAgentTool } from "../server/integrations/agent-tool-executor";
import { prepareAgentTurn } from "../server/integrations/excel-agent";

const input = { userId: "owner", botId: "bot", taskId: "task", botName: "Scout", botRole: "Helper", botPurpose: "Help", message: "hello", recentContext: [] };
it("omits denied tools while retaining the order and availability of other tools", async () => {
  const unrestricted = await prepareAgentTurn(input, "a");
  const restricted = await prepareAgentTurn({ ...input, disallowedTools: ["computer_status"] }, "b");
  expect(restricted.tools).toEqual(unrestricted.tools?.filter((t) => t.function.name !== "computer_status"));
  expect(restricted.messages[1].content).toContain("computer_status");
  await expect(prepareAgentTurn({ ...input, model: "opencode:default", disallowedTools: ["computer_status"] }, "c")).rejects.toThrow("cannot enforce");
});
it("denies before parsing, hooks and external side effects, even with connected capabilities", async () => {
  const proposals: never[] = []; const approvals: never[] = []; const background = vi.fn();
  const result = await executeAgentTool({ ...input, name: "computer_write_file", rawArgs: "not JSON",
    disallowedTools: ["computer_write_file"], excelConnected: true, githubConnected: true, computerOnline: true,
    approvals, computerProposals: proposals, prepareBackgroundApproval: background });
  expect(result.resultPayload).toMatchObject({ status: "denied", code: "POLICY_DENIED", retryable: false });
  expect(background).not.toHaveBeenCalled(); expect(proposals).toEqual([]); expect(approvals).toEqual([]);
});

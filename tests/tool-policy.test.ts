import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { executeAgentTool } from "../server/integrations/agent-tool-executor";
import {
  checkToolPolicy,
  isDeniedCommand,
  isDeniedPath,
  loadToolPolicyFromEnv,
  sniffPolicyHints,
} from "../server/integrations/tool-policy";
import type { ComputerProposal } from "../server/integrations/computer-tools";
import type { ExcelAgentApproval } from "../server/integrations/excel-agent";

describe("grok deny policy (deny wins, empty by default)", () => {
  it("matches commands by whole-word prefix or glob", () => {
    expect(isDeniedCommand("rm -rf /tmp/x", ["rm -rf *"])).toBe(true);
    expect(isDeniedCommand("rm -rfx", ["rm -rf *"])).toBe(false);
    expect(isDeniedCommand("git status", ["rm -rf *"])).toBe(false);
    expect(isDeniedCommand("sudo rm -rf /", ["sudo *"])).toBe(true);
    expect(isDeniedCommand("  rm   -rf  /x  ", ["rm -rf *"])).toBe(true);
  });

  it("matches paths with ** globs and normalizes traversal", () => {
    expect(isDeniedPath("/repo/.env", ["**/.env"])).toBe(true);
    expect(isDeniedPath("/repo/sub/.env", ["**/.env"])).toBe(true);
    expect(isDeniedPath("/repo/.env.example", ["**/.env"])).toBe(false);
    expect(isDeniedPath("/repo/../.env", ["**/.env"])).toBe(true);
    expect(isDeniedPath("/data/secret.txt", ["/data"])).toBe(true);
    expect(isDeniedPath("/other/x", ["/data"])).toBe(false);
  });

  it("loads comma lists from env, empty by default", () => {
    expect(loadToolPolicyFromEnv({} as unknown as NodeJS.ProcessEnv)).toEqual({
      deniedCommands: [],
      deniedPaths: [],
    });
    expect(
      loadToolPolicyFromEnv({
        ROOK_TOOL_DENY_COMMANDS: "rm -rf *, sudo *",
        ROOK_TOOL_DENY_PATHS: "**/.env",
      } as unknown as NodeJS.ProcessEnv),
    ).toEqual({ deniedCommands: ["rm -rf *", "sudo *"], deniedPaths: ["**/.env"] });
  });

  it("sniffs hints generically and never denies on guesses", () => {
    expect(sniffPolicyHints(JSON.stringify({ command: "ls" }))).toEqual({ command: "ls" });
    expect(sniffPolicyHints("not json")).toEqual({});
    expect(
      checkToolPolicy({ command: 42 }, { deniedCommands: ["*"], deniedPaths: [] }),
    ).toEqual({ allowed: true });
    expect(
      checkToolPolicy(
        { command: "rm -rf /x" },
        { deniedCommands: ["rm -rf *"], deniedPaths: [] },
      ),
    ).toMatchObject({ allowed: false, code: "POLICY_DENIED" });
  });

  describe("wired into the dispatcher", () => {
    const savedCommands = process.env.ROOK_TOOL_DENY_COMMANDS;
    const savedPaths = process.env.ROOK_TOOL_DENY_PATHS;
    beforeEach(() => {
      process.env.ROOK_TOOL_DENY_COMMANDS = "rm -rf *";
      process.env.ROOK_TOOL_DENY_PATHS = "**/.env";
    });
    afterEach(() => {
      if (savedCommands === undefined) delete process.env.ROOK_TOOL_DENY_COMMANDS;
      else process.env.ROOK_TOOL_DENY_COMMANDS = savedCommands;
      if (savedPaths === undefined) delete process.env.ROOK_TOOL_DENY_PATHS;
      else process.env.ROOK_TOOL_DENY_PATHS = savedPaths;
    });

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

    it("denies before family dispatch (proposal tools included)", async () => {
      const turn = await executeAgentTool({
        ...base,
        name: "computer_propose_task",
        rawArgs: JSON.stringify({ title: "Valid test task", command: "rm -rf /tmp/x" }),
      });
      const payload = turn.resultPayload as Record<string, unknown>;
      expect(payload.status).toBe("denied");
      expect(payload.code).toBe("POLICY_DENIED");
      expect(payload.retryable).toBe(false);
    });

    it("allows clean calls through (unknown-tool path intact)", async () => {
      const turn = await executeAgentTool({ ...base, name: "nope" });
      expect((turn.resultPayload as Record<string, unknown>).code).toBe("UNKNOWN_TOOL");
    });
  });
});

import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetHooksForTests,
  registerHook,
  runLifecycleHook,
  runPostToolUse,
  runPreToolUse,
} from "../server/ai/hooks";
import { executeAgentTool } from "../server/integrations/agent-tool-executor";
import type { ComputerProposal } from "../server/integrations/computer-tools";
import type { ExcelAgentApproval } from "../server/integrations/excel-agent";

beforeEach(() => {
  __resetHooksForTests();
});

describe("grok hooks (exit-2 denies, crash fails open)", () => {
  it("empty registry is a pass-through", async () => {
    const pre = await runPreToolUse({ event: "PreToolUse", toolName: "read_skill", args: {} });
    expect(pre.verdict).toEqual({ decision: "allow" });
    expect(pre.updatedArgs).toBeUndefined();
    const post = await runPostToolUse({ event: "PostToolUse", toolName: "read_skill", output: "ok" });
    expect(post.output).toBe("ok");
    expect(post.notes).toEqual([]);
    expect(await runLifecycleHook("Stop")).toEqual([]);
  });

  it("first deny wins and discards rewrites", async () => {
    registerHook(
      { name: "rewriter", run: async () => ({ decision: "allow", updatedInput: { a: 1 } }) },
      "PreToolUse",
    );
    registerHook({ name: "guard", run: async () => ({ decision: "deny", reason: "nope" }) },
      "PreToolUse",
    );
    const pre = await runPreToolUse({ event: "PreToolUse", toolName: "x", args: {} });
    expect(pre.verdict).toEqual({ decision: "deny", reason: "nope" });
    expect(pre.updatedArgs).toBeUndefined();
    expect(pre.notes.join(" ")).toContain("guard denied");
  });

  it("rewrites merge last-wins and crashes fail open", async () => {
    registerHook(
      { name: "one", run: async () => ({ decision: "allow", updatedInput: { a: 1, b: 1 } }) },
      "PreToolUse",
    );
    registerHook(
      {
        name: "crasher",
        run: async () => {
          throw new Error("boom");
        },
      },
      "PreToolUse",
    );
    registerHook(
      { name: "two", run: async () => ({ decision: "allow", updatedInput: { b: 2 } }) },
      "PreToolUse",
    );
    const pre = await runPreToolUse({ event: "PreToolUse", toolName: "x", args: { z: 0 } });
    expect(pre.verdict).toEqual({ decision: "allow" });
    expect(pre.updatedArgs).toEqual({ z: 0, a: 1, b: 2 });
    expect(pre.notes.join(" ")).toContain("failed open");
  });

  it("post-tooluse replaces output last-wins, record keeps original elsewhere", async () => {
    registerHook(
      { name: "redactor", run: async () => ({ updatedOutput: "[redacted]", note: "hid secret" }) },
      "PostToolUse",
    );
    const post = await runPostToolUse({ event: "PostToolUse", toolName: "x", output: "sk-123" });
    expect(post.output).toBe("[redacted]");
    expect(post.notes.join(" ")).toContain("replaced");
    expect(post.notes.join(" ")).toContain("hid secret");
  });

  it("lifecycle hooks collect notes and never block", async () => {
    registerHook({ name: "audit", run: async () => ({ note: "turn ended" }) }, "Stop");
    expect(await runLifecycleHook("Stop")).toEqual(["hook audit: turn ended"]);
  });

  it("wired deny blocks dispatch with HOOK_DENIED", async () => {
    registerHook({ name: "guard", run: async () => ({ decision: "deny", reason: "hook says no" }) },
      "PreToolUse",
    );
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
    const turn = await executeAgentTool({ ...base, name: "nope" });
    const payload = turn.resultPayload as Record<string, unknown>;
    expect(payload.status).toBe("denied");
    expect(payload.code).toBe("HOOK_DENIED");
    expect(payload.retryable).toBe(false);
    expect(payload.message).toBe("hook says no");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../server/ai/fallback-router", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../server/ai/fallback-router")>();
  return { ...original, invokeAiResilient: vi.fn() };
});

import { invokeAiResilient } from "../server/ai/fallback-router";
import { runRookAgent } from "../server/integrations/excel-agent";
import {
  MAX_OUTPUT_CONTINUATIONS,
  OUTPUT_LIMIT_TAIL,
  isMaxTokensError,
  maxTokensFor,
} from "../server/ai/agent-reliability";
import { executeAgentTool } from "../server/integrations/agent-tool-executor";
import * as db from "../server/db";

const baseInput = {
  userId: "user-1",
  botId: "bot-1",
  taskId: "task-1",
  botName: "Scout",
  botRole: "coder",
  botPurpose: "Write code.",
  model: "openrouter/free",
  message: "```ts\nconst x: number = 1;\n```\nWrite the whole module with full docs.",
  recentContext: [],
};

const textRound = (text: string, finish: "stop" | "length" = "stop") => ({
  result: {
    id: "gen-1",
    created: 1,
    model: "openrouter/free",
    choices: [
      {
        index: 0,
        message: { role: "assistant" as const, content: text },
        finish_reason: finish as "stop" | "length",
      },
    ],
  },
  attemptedProviders: ["openrouter"],
  fellBack: false,
});

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // Hermetic turns: keep capability probes off the network (see
  // server/ai/skills.test.ts). Targeted spy so the createExcelPendingAction
  // spy below keeps working on the real module.
  vi.spyOn(db, "listRookNodesForUser").mockResolvedValue([]);
});

describe("output budgets favor complete answers", () => {
  it("gives code work real room", () => {
    expect(maxTokensFor("hi")).toBe(2000);
    expect(maxTokensFor("x".repeat(500))).toBe(3500);
    expect(maxTokensFor("```ts\nconst x = 1;\n``` fix it")).toBe(6000);
  });

  it("gives creation intent code-sized budgets", () => {
    expect(maxTokensFor("please create a flappy bird game")).toBe(6000);
    expect(maxTokensFor("build me a website for my bakery")).toBe(6000);
    expect(maxTokensFor("what time is it?")).toBe(2000);
  });
});

describe("auto-continue on length truncation", () => {
  it("stitches segments into one complete answer with no tail marker", async () => {
    vi.mocked(invokeAiResilient)
      .mockResolvedValueOnce(textRound("Part one of the module.", "length"))
      .mockResolvedValueOnce(textRound("Part two ends it."));
    const result = await runRookAgent(baseInput);
    expect(result.text).toBe("Part one of the module.\nPart two ends it.");
    expect(result.text).not.toContain("cut off");
    expect(vi.mocked(invokeAiResilient)).toHaveBeenCalledTimes(2);
    expect(
      result.trace.some((step) => step.title === "Kept writing past the output limit"),
    ).toBe(true);
  });

  it("stops after the cap with a short marker, never an endless loop", async () => {
    vi.mocked(invokeAiResilient).mockImplementation(async () => textRound("more text here. ", "length"));
    const result = await runRookAgent(baseInput);
    expect(vi.mocked(invokeAiResilient)).toHaveBeenCalledTimes(1 + MAX_OUTPUT_CONTINUATIONS);
    expect(result.text).toContain(OUTPUT_LIMIT_TAIL.trim().slice(0, 20));
  });
});

describe("max_tokens downgrade", () => {
  it("classifies provider budget rejections", () => {
    expect(isMaxTokensError(new Error("max_tokens is too large: limit is 2048"))).toBe(true);
    expect(isMaxTokensError(new Error("Free AI capacity is temporarily full."))).toBe(false);
  });

  it("halves the budget once and retries instead of failing", async () => {
    vi.mocked(invokeAiResilient)
      .mockRejectedValueOnce(new Error("max_tokens is too large for this model"))
      .mockImplementationOnce(async (params) => textRound("Recovered short."));
    const result = await runRookAgent(baseInput);
    expect(result.text).toBe("Recovered short.");
    const calls = vi.mocked(invokeAiResilient).mock.calls;
    expect(calls).toHaveLength(2);
    const firstBudget = (calls[0][0] as { maxTokens: number }).maxTokens;
    const secondBudget = (calls[1][0] as { maxTokens: number }).maxTokens;
    expect(secondBudget).toBeLessThan(firstBudget);
  });
});

describe("trace step details (visible chain of events)", () => {
  it("names the computer proposal in its step", async () => {
    const executed = await executeAgentTool({
      userId: "u",
      botId: "b",
      taskId: "t",
      name: "computer_propose_task",
      rawArgs: JSON.stringify({ title: "Open the portal now" }),
      excelConnected: false,
      githubConnected: false,
      computerOnline: false,
      approvals: [],
      computerProposals: [],
    });
    expect(executed.traceStep).toMatchObject({
      kind: "tool",
      title: "Proposed a computer task for approval",
      detail: "Open the portal now",
    });
  });

  it("names the exact Excel range being written", async () => {
    vi.spyOn(db, "createExcelPendingAction").mockResolvedValue(undefined as never);
    const executed = await executeAgentTool({
      userId: "u",
      botId: "b",
      taskId: "t",
      name: "excel_update_range",
      rawArgs: JSON.stringify({
        drive_id: "d",
        item_id: "i",
        workbook_name: "Budget",
        worksheet: "Sheet1",
        address: "A1:B2",
        values: [["x"]],
      }),
      excelConnected: true,
      githubConnected: false,
      computerOnline: false,
      approvals: [],
      computerProposals: [],
    });
    expect(executed.traceStep.detail).toContain("Sheet1!A1:B2");
  });
});

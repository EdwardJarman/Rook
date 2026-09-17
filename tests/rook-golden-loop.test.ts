/**
 * Golden multi-turn loop tests (eval-set seed, per ADK guidance).
 *
 * These pin END-TO-END turn behavior with a mocked provider boundary:
 * tool dispatch → execution → continuation → final text + telemetry.
 * They fail if the loop regresses (dropped tool results, lost approvals,
 * dishonest fallback flags) and pass without any network, DB, or keys.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../server/ai/fallback-router", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../server/ai/fallback-router")>();
  return { ...original, invokeAiResilient: vi.fn() };
});

import { invokeAiResilient } from "../server/ai/fallback-router";
import { runRookAgent } from "../server/integrations/excel-agent";
import { __resetTelemetryForTests, recentTurns } from "../server/ai/telemetry";

const baseInput = {
  userId: "user-1",
  botId: "bot-1",
  taskId: "task-1",
  botName: "Scout",
  botRole: "researcher",
  botPurpose: "Track launches.",
  model: "openrouter/free",
  message: "Say hello briefly.",
  recentContext: [],
};

const textRound = (text: string, model = "openrouter/free") => ({
  result: {
    id: "gen-1",
    created: 1,
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant" as const, content: text },
        finish_reason: "stop" as const,
      },
    ],
  },
  attemptedProviders: ["openrouter"],
  fellBack: false,
});

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  __resetTelemetryForTests();
});

describe("golden loop: plain answer", () => {
  it("passes provider text through and records telemetry", async () => {
    vi.mocked(invokeAiResilient).mockResolvedValueOnce(textRound("Hello there."));
    const result = await runRookAgent(baseInput);

    expect(result.text).toBe("Hello there.");
    expect(result.model).toBe("openrouter/free");
    expect(result.fellBack).toBe(false);
    expect(result.usedTools).toEqual([]);
    expect(result.trace.length).toBeGreaterThan(0);
    expect(result.computerProposals).toEqual([]);
    const [turn] = recentTurns(1);
    expect(turn?.requestId).toBe(result.requestId);
    expect(turn?.error).toBeUndefined();
  });
});

describe("golden loop: computer proposal flow", () => {
  it("records the proposal, traces it, and finishes honestly", async () => {
    vi.mocked(invokeAiResilient)
      .mockImplementationOnce(async () => ({
        result: {
          id: "gen-1",
          created: 1,
          model: "openrouter/free",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant" as const,
                content: "",
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function" as const,
                    function: {
                      name: "computer_propose_task",
                      arguments: JSON.stringify({
                        title: "Open the portal and export the June statement",
                        url: "https://portal.example.com",
                      }),
                    },
                  },
                ],
              },
              finish_reason: "tool_calls" as const,
            },
          ],
        },
        attemptedProviders: ["openrouter"],
        fellBack: false,
      }))
      .mockImplementationOnce(async () => textRound("Proposed below."));

    const result = await runRookAgent({
      ...baseInput,
      message: "Open the portal and export June.",
    });

    expect(result.text).toBe("Proposed below.");
    expect(result.usedTools).toEqual(["computer_propose_task"]);
    expect(result.computerProposals).toHaveLength(1);
    expect(result.computerProposals[0]).toMatchObject({
      title: "Open the portal and export the June statement",
      url: "https://portal.example.com",
    });
    expect(
      result.trace.some((step) => step.title === "Proposed a computer task for approval"),
    ).toBe(true);
    expect(result.approvals).toEqual([]);
  });
});

describe("golden loop: fallback transparency", () => {
  it("reports fellBack when the provider boundary resolved elsewhere", async () => {
    vi.mocked(invokeAiResilient).mockResolvedValueOnce({
      ...textRound("Recovered via fallback.", "openrouter/free"),
      attemptedProviders: ["openrouter", "orcarouter"],
      fellBack: true,
    });
    const result = await runRookAgent({ ...baseInput, model: "orcarouter:deepseek/x" });

    expect(result.text).toBe("Recovered via fallback.");
    expect(result.fellBack).toBe(true);
    expect(result.attemptedProviders).toEqual(["openrouter", "orcarouter"]);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../db", () => ({ listRookNodesForUser: vi.fn(async () => []) }));
vi.mock("../ai/fallback-router", () => ({ invokeAiResilient: vi.fn() }));
vi.mock("../ai/telemetry", () => ({ recordTurn: vi.fn() }));
vi.mock("../integrations/agent-tool-executor", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../integrations/agent-tool-executor")
    >();
  return {
    ...actual,
    executeAgentTool: vi.fn(async () => ({
      traceStep: { kind: "tool", title: "Read" },
      resultPayload: { status: "completed", value: 42 },
    })),
  };
});
import { runRookAgent } from "../integrations/excel-agent";
import { invokeAiResilient } from "../ai/fallback-router";
import { executeAgentTool } from "../integrations/agent-tool-executor";
import type { Checkpoint } from "./model";
import type { InvokeResult } from "../_core/llm";

const input = {
  userId: "owner",
  botId: "bot",
  taskId: "job",
  botName: "Bot",
  botRole: "Analyst",
  botPurpose: "Work",
  message: "Read the saved file",
  recentContext: [],
};
const answer = (
  content: string,
  calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>,
): InvokeResult => ({
  id: "response",
  created: 1,
  model: "openrouter/free",
  choices: [
    {
      index: 0,
      finish_reason: calls ? "tool_calls" : "stop",
      message: {
        role: "assistant",
        content,
        ...(calls ? { tool_calls: calls } : {}),
      },
    },
  ],
});
beforeEach(() => vi.clearAllMocks());
describe("shared foreground turn durable seam", () => {
  it("retains earlier answer segments and continuation budget after a crash", async () => {
    const first = answer("First segment.");
    first.choices[0].finish_reason = "length";
    vi.mocked(invokeAiResilient)
      .mockResolvedValueOnce({
        result: first,
        fellBack: false,
        attemptedProviders: [],
      })
      .mockResolvedValueOnce({
        result: answer("Second segment."),
        fellBack: false,
        attemptedProviders: [],
      });
    let checkpoint: Checkpoint | undefined;
    await expect(
      runRookAgent({
        ...input,
        durableTurn: {
          guard: async () => {},
          execute: async (_input, dispatch) => dispatch(),
          save: async (value) => {
            checkpoint = structuredClone(value);
            if (value.round === 1)
              throw new Error("crash after answer checkpoint");
          },
        },
      }),
    ).rejects.toThrow("crash after answer checkpoint");
    expect(checkpoint?.continuation).toEqual({
      text: "First segment.",
      used: 1,
    });
    const result = await runRookAgent({
      ...input,
      durableTurn: {
        checkpoint,
        guard: async () => {},
        save: async () => {},
        execute: async (_input, dispatch) => dispatch(),
      },
    });
    expect(result.text).toBe("First segment.\nSecond segment.");
    expect(invokeAiResilient).toHaveBeenCalledTimes(2);
  });
  it("resumes the exact saved model response instead of regenerating tool calls", async () => {
    const calls = [
      {
        id: "call-1",
        type: "function" as const,
        function: {
          name: "github_read_file",
          arguments: '{"repo":"a/b","path":"README.md"}',
        },
      },
    ];
    vi.mocked(invokeAiResilient).mockResolvedValueOnce({
      result: answer("", calls),
      fellBack: false,
      attemptedProviders: [],
    });
    let checkpoint: Checkpoint | undefined;
    await expect(
      runRookAgent({
        ...input,
        durableTurn: {
          guard: async () => {},
          save: async (value) => {
            checkpoint = structuredClone(value);
          },
          execute: async () => {
            throw new Error("simulated crash before tool");
          },
        },
      }),
    ).rejects.toThrow("simulated crash");
    expect(checkpoint?.response.choices[0].message.tool_calls?.[0].id).toBe(
      "call-1",
    );
    vi.mocked(invokeAiResilient).mockResolvedValueOnce({
      result: answer("42"),
      fellBack: false,
      attemptedProviders: [],
    });
    const result = await runRookAgent({
      ...input,
      durableTurn: {
        checkpoint,
        guard: async () => {},
        save: async () => {},
        execute: async (_input, dispatch) => dispatch(),
      },
    });
    expect(result.text).toBe("42");
    expect(executeAgentTool).toHaveBeenCalledTimes(1);
    expect(invokeAiResilient).toHaveBeenCalledTimes(2);
    const lastRequest = vi.mocked(invokeAiResilient).mock.calls.at(-1)![0];
    expect(
      lastRequest.messages.some(
        (message) =>
          message.role === "tool" && message.tool_call_id === "call-1",
      ),
    ).toBe(true);
  });
});

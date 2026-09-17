import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../server/ai/openai-stream", async (importOriginal) => {
  const original = await importOriginal<typeof import("../server/ai/openai-stream")>();
  return {
    ...original,
    invokeAiStream: vi.fn(),
    supportsModelStream: () => true,
  };
});

import { invokeAiStream } from "../server/ai/openai-stream";
import { runRookAgentStream } from "../server/ai/agent-stream";

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

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("streamed agent turn", () => {
  it("emits tokens live and returns the same shape as a normal turn", async () => {
    vi.mocked(invokeAiStream).mockImplementationOnce(async (_params, opts) => {
      opts?.onToken?.("Hello ");
      opts?.onToken?.("there.");
      return {
        text: "Hello there.",
        toolCalls: [],
        model: "test/stream-model",
        finishReason: "stop",
      };
    });
    const events: Array<{ type: string; delta?: string }> = [];
    const result = await runRookAgentStream(baseInput, (event) => {
      events.push(event as { type: string; delta?: string });
    });

    expect(result.text).toBe("Hello there.");
    expect(result.streamed).toBe(true);
    expect(result.model).toBe("test/stream-model");
    expect(events.filter((event) => event.type === "token").map((event) => event.delta).join("")).toBe(
      "Hello there.",
    );
    expect(events.some((event) => event.type === "trace")).toBe(true);
    expect(result.trace.length).toBeGreaterThan(0);
    expect(result.computerProposals).toEqual([]);
    expect(result.suggestedMemories).toEqual([]);
  });

  it("runs tools mid-stream and continues the loop", async () => {
    const db = await import("../server/db");
    vi.spyOn(db, "listRookNodesForUser").mockResolvedValue([
      {
        id: "1",
        nodeId: "node-1",
        userId: "user-1",
        name: "Desk",
        status: "online",
        version: "1",
        lastSeenAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    vi.mocked(invokeAiStream)
      .mockImplementationOnce(async () => ({
        text: "",
        toolCalls: [
          { id: "call_1", type: "function", function: { name: "computer_status", arguments: "{}" } },
        ],
        model: "test/stream-model",
        finishReason: "tool_calls",
      }))
      .mockImplementationOnce(async (_params, opts) => {
        opts?.onToken?.("Your computer is online.");
        return {
          text: "Your computer is online.",
          toolCalls: [],
          model: "test/stream-model",
          finishReason: "stop",
        };
      });

    const kinds: string[] = [];
    const result = await runRookAgentStream(
      { ...baseInput, message: "Is my computer online right now? Check it." },
      (event) => kinds.push(event.type),
    );

    expect(result.text).toBe("Your computer is online.");
    expect(result.usedTools).toEqual(["computer_status"]);
    expect(kinds).toContain("token");
    expect(kinds.filter((kind) => kind === "trace").length).toBeGreaterThanOrEqual(3);
  });

  it("auto-continues length-truncated streams into one answer", async () => {
    vi.mocked(invokeAiStream)
      .mockImplementationOnce(async (_params, opts) => {
        opts?.onToken?.("Part one. ");
        return {
          text: "Part one. ",
          toolCalls: [],
          model: "test/stream-model",
          finishReason: "length",
        };
      })
      .mockImplementationOnce(async (_params, opts) => {
        opts?.onToken?.("Part two.");
        return {
          text: "Part two.",
          toolCalls: [],
          model: "test/stream-model",
          finishReason: "stop",
        };
      });

    const deltas: string[] = [];
    const result = await runRookAgentStream(baseInput, (event) => {
      if (event.type === "token") deltas.push(event.delta);
    });

    expect(result.text).toContain("Part one.");
    expect(result.text).toContain("Part two.");
    expect(result.text).not.toContain("cut off");
    expect(deltas.join("")).toContain("Part one. ");
    expect(deltas.join("")).toContain("Part two.");
  });
});

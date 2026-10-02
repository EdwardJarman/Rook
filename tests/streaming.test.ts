import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  streamChatCompletion,
  streamTimeoutsFor,
  supportsModelStream,
} from "../server/ai/openai-stream";
import { serializeStreamEvent } from "../server/agent-stream-route";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const sseResponse = (chunks: string[], status = 200) => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { "Content-Type": "text/event-stream" },
  });
};

describe("SSE chat completion parser", () => {
  it("accumulates text deltas and tool calls across chunk boundaries", async () => {
    // Deliberately split mid-JSON to prove boundary handling.
    const chunks = [
      'data: {"model":"test/model","choices":[{"delta":{"role":"assistant","content":"Hel',
      'lo"},"index":0}]}\n\ndata: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"computer_status","arguments":""}}]},"index":0}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{}"}}]}},"index":0}]}\n\ndata: [DONE]\n\n',
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(chunks)));
    const seen: string[] = [];
    const round = await streamChatCompletion({
      url: "https://example.test/chat",
      headers: {},
      payload: { model: "m", messages: [] },
      onToken: (delta) => seen.push(delta),
    });
    expect(round.text).toBe("Hello");
    expect(seen).toEqual(["Hello"]);
    expect(round.toolCalls).toEqual([
      { id: "call_1", type: "function", function: { name: "computer_status", arguments: "{}" } },
    ]);
    expect(round.model).toBe("test/model");
  });

  it("accepts a provider that ignores stream:true with one JSON body", async () => {
    const body = JSON.stringify({
      model: "plain/model",
      choices: [
        {
          message: { role: "assistant", content: "Whole answer." },
          finish_reason: "stop",
        },
      ],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(body, { status: 200, headers: { "Content-Type": "application/json" } }),
      ),
    );
    const seen: string[] = [];
    const round = await streamChatCompletion({
      url: "https://example.test/chat",
      headers: {},
      payload: {},
      onToken: (delta) => seen.push(delta),
    });
    expect(round.text).toBe("Whole answer.");
    expect(seen).toEqual(["Whole answer."]);
  });

  it("throws status-coded errors the fallback router can classify", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: "Busy." } }), {
          status: 429,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    await expect(
      streamChatCompletion({ url: "https://example.test/chat", headers: {}, payload: {} }),
    ).rejects.toThrow(/429/);
  });

  it("throws mid-stream error events instead of returning partial silence", async () => {
    const chunks = ['data: {"error":{"message":"Upstream exploded"}}\n\n'];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(chunks)));
    await expect(
      streamChatCompletion({ url: "https://example.test/chat", headers: {}, payload: {} }),
    ).rejects.toThrow(/Upstream exploded/);
  });
});

describe("stream timeouts (slow models live long, dead ones die fast)", () => {
  it("scales the overall budget with requested output, bounded both sides", () => {
    expect(streamTimeoutsFor(6000).overallMs).toBe(600_000);
    expect(streamTimeoutsFor(2000).overallMs).toBe(300_000);
    expect(streamTimeoutsFor(100).overallMs).toBe(120_000);
    expect(streamTimeoutsFor(undefined).overallMs).toBeGreaterThanOrEqual(120_000);
    expect(streamTimeoutsFor(6000).idleMs).toBe(45_000);
  });

  it("aborts a stream that goes silent mid-answer", async () => {
    // Like a real fetch body, the mock stream errors when aborted —
    // otherwise reader.read() could never settle.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'),
            );
            init?.signal?.addEventListener("abort", () => {
              try {
                controller.error(new DOMException("This operation was aborted.", "AbortError"));
              } catch {
                /* already closed */
              }
            });
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }),
    );
    await expect(
      streamChatCompletion({
        url: "https://example.test/chat",
        headers: {},
        payload: { model: "m", messages: [] },
        idleTimeoutMs: 60,
        timeoutMs: 10_000,
      }),
    ).rejects.toThrow(/stalled/);
  });

  it("still enforces the overall timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            init?.signal?.addEventListener("abort", () => {
              try {
                controller.error(new DOMException("This operation was aborted.", "AbortError"));
              } catch {
                /* already closed */
              }
            });
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }),
    );
    await expect(
      streamChatCompletion({
        url: "https://example.test/chat",
        headers: {},
        payload: { model: "m", messages: [] },
        idleTimeoutMs: 10_000,
        timeoutMs: 60,
      }),
    ).rejects.toThrow(/timed out/);
  });
});

describe("stream model support", () => {
  it("streams shared routes but not the ChatGPT proxy", () => {
    expect(supportsModelStream("openrouter/free")).toBe(true);
    expect(supportsModelStream("orcarouter:deepseek/x")).toBe(true);
    expect(supportsModelStream("chatgpt:gpt-5")).toBe(false);
  });
});

describe("stream event serialization", () => {
  it("maps internal events to client kinds without leaking internals", () => {
    expect(serializeStreamEvent({ type: "token", delta: "hi" })).toEqual({
      kind: "token",
      delta: "hi",
    });
    expect(
      serializeStreamEvent({ type: "trace", step: { kind: "tool", title: "X" } }),
    ).toEqual({ kind: "trace", step: { kind: "tool", title: "X" } });
    expect(
      serializeStreamEvent({ type: "approval", approval: { actionId: "a" } }),
    ).toEqual({ kind: "approval", approval: { actionId: "a" } });
    expect(
      serializeStreamEvent({ type: "proposal", proposal: { proposalId: "p" } }),
    ).toEqual({ kind: "proposal", proposal: { proposalId: "p" } });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

import { streamAgentReply, supportsAgentStream } from "../lib/agent-stream";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const sseResponse = (payloads: Array<Record<string, unknown>>, status = 200) => {
  const encoder = new TextEncoder();
  const body = payloads.map((payload) => `data: ${JSON.stringify(payload)}\n\n`).join("");
  // Split mid-stream to prove the client handles chunk boundaries.
  const midpoint = Math.floor(body.length / 2);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(body.slice(0, midpoint)));
      controller.enqueue(encoder.encode(body.slice(midpoint)));
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { "Content-Type": "text/event-stream" },
  });
};

const doneResult = {
  text: "Live answer.",
  model: "m",
  approvals: [],
  computerProposals: [],
  suggestedMemories: [],
  trace: [],
};

describe("agent stream client", () => {
  it("resolves the done result and forwards tokens + tool flags", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          { kind: "trace", step: { kind: "context", title: "Read the room context" } },
          { kind: "token", delta: "Live " },
          { kind: "trace", step: { kind: "tool", title: "Checked the shared computer" } },
          { kind: "token", delta: "answer." },
          { kind: "done", result: doneResult },
        ]),
      ),
    );
    const tokens: string[] = [];
    let toolActivity = false;
    const result = await streamAgentReply({
      baseUrl: "https://api.test",
      body: { message: "hi" },
      getToken: async () => "token-1",
      callbacks: {
        onToken: (delta) => tokens.push(delta),
        onToolActivity: () => {
          toolActivity = true;
        },
      },
    });
    expect(result.text).toBe("Live answer.");
    expect(tokens.join("")).toBe("Live answer.");
    expect(toolActivity).toBe(true);
    const [url, init] = (fetch as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock
      .calls[0];
    expect(url).toBe("https://api.test/api/agent/stream");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token-1");
  });

  it("throws on mid-stream error events so callers fall back", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          { kind: "token", delta: "Partial…" },
          { kind: "error", message: "The live reply failed." },
        ]),
      ),
    );
    await expect(
      streamAgentReply({ baseUrl: "https://api.test", body: {}, getToken: async () => null }),
    ).rejects.toThrow(/live reply failed/);
  });

  it("throws on non-200 so callers use the mutation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 404 })));
    await expect(
      streamAgentReply({ baseUrl: "https://api.test", body: {}, getToken: async () => null }),
    ).rejects.toThrow(/404/);
  });

  it("reports support honestly", () => {
    expect(supportsAgentStream()).toBe(true);
  });
});

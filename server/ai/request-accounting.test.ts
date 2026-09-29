import { afterEach, describe, expect, it, vi } from "vitest";
import {
  accountingTaskKey, fetchModelCompletion, measureRequestSources, normalizeTokenUsage,
  priceTokenUsage, readModelJson, requestAccountingSnapshot, setAccountingSections,
  startModelRequest, summarizeUsage, withRequestAccounting,
} from "./request-accounting";
import { streamChatCompletion } from "./openai-stream";
import { __resetTelemetryForTests, recentTurns, recordTurn, recordInterruptedTurn, taskUsageStats } from "./telemetry";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); __resetTelemetryForTests(); });
const payload = { model: "model-a", messages: [{ role: "user", content: "private message" }] };
const usage = { prompt_tokens: 100, completion_tokens: 20,
  prompt_tokens_details: { cached_tokens: 80, cache_write_tokens: 5 },
  completion_tokens_details: { reasoning_tokens: 12 }, cost: 0.002 };
const metadata = { provider: "test", model: "model-a", payload };
const turn = { requestId: "r", at: "2026-09-28T00:00:00Z", latencyMs: 10, model: "model-a",
  requestedModel: "model-a", fellBack: false, providers: ["test"], tools: [], approvals: 0,
  computerProposals: 0, webSearched: false, codeTask: false };

describe("billing usage", () => {
  it("keeps absence unknown and distinguishes explicitly reported zero", () => {
    expect(normalizeTokenUsage().input).toBeNull();
    expect(normalizeTokenUsage({ prompt_tokens: 0, completion_tokens: 0, cost: 0 })).toMatchObject({
      input: 0, output: 0, providerCostUsd: 0, cachedInput: null, uncachedInput: null,
    });
    expect(normalizeTokenUsage({ prompt_tokens: 10, prompt_tokens_details: { cached_tokens: 0 } }).uncachedInput).toBe(10);
  });

  it("uses disjoint input billing buckets and does not count reasoning twice", () => {
    const measured = normalizeTokenUsage(usage);
    expect(measured).toEqual({ input: 100, output: 20, cachedInput: 80, uncachedInput: 20,
      cacheWriteInput: 5, reasoningOutput: 12, providerCostUsd: 0.002 });
    expect(priceTokenUsage(measured, { uncachedInput: 2, cachedInput: 0.2, output: 8, cacheWriteInput: 3 }))
      .toBeCloseTo((15 * 2 + 80 * 0.2 + 5 * 3 + 20 * 8) / 1e6);
    expect(priceTokenUsage(normalizeTokenUsage(), { uncachedInput: 2, cachedInput: 0.2, output: 8 })).toBeNull();
  });

  it("rejects invalid provider counts instead of silently clamping a bill", () => {
    expect(normalizeTokenUsage({ prompt_tokens: 5, completion_tokens: -1,
      prompt_tokens_details: { cached_tokens: 6 }, cost: NaN })).toMatchObject({
      input: 5, output: null, cachedInput: null, uncachedInput: null, providerCostUsd: null,
    });
  });
});

describe("physical request accounting", () => {
  it("retains parked attempt usage, redacts thrown errors, and never double-records a turn", () => {
    withRequestAccounting("opaque", () => {
      const span = startModelRequest(metadata);
      span.usage(usage); span.end("completed");
      recordInterruptedTurn("parked", "model-a", 10, { code: "PARKED", message: "private" }, () => 20);
      recordInterruptedTurn("duplicate", "model-a", 10, new Error("private"), () => 20);
    });
    expect(recentTurns()).toHaveLength(1);
    expect(recentTurns()[0]).toMatchObject({ interrupted: true, latencyMs: 10, usage: { known: { input: 100 } } });
    expect(recentTurns()[0].error).toBeUndefined();
    expect(JSON.stringify(recentTurns())).not.toContain("private");
  });
  it("records failed attempts and successful usage without request contents", async () => {
    let now = 100;
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error("private network error"))
      .mockResolvedValueOnce(new Response("capacity", { status: 429 }))
      .mockResolvedValueOnce(Response.json({ model: "resolved", usage }));
    vi.stubGlobal("fetch", fetcher);
    await withRequestAccounting("opaque", async () => {
      await expect(fetchModelCompletion("https://provider.test", {}, metadata)).rejects.toThrow("network");
      await fetchModelCompletion("https://provider.test", {}, metadata);
      const response = await fetchModelCompletion("https://provider.test", {}, metadata);
      now += 15;
      await readModelJson(response);
      recordTurn(turn);
    }, () => now);
    const record = recentTurns()[0];
    expect(record.modelRequests?.map((r) => r.status)).toEqual(["failed", "failed", "completed"]);
    expect(record.modelRequests?.[2]).toMatchObject({ resolvedModel: "resolved", latencyMs: 15 });
    expect(record.usage).toMatchObject({ requests: 3, known: { input: 100 }, unknown: { input: 2 } });
    expect(JSON.stringify(record)).not.toMatch(/private|provider\.test/);
  });

  it("marks malformed JSON as failed rather than dropping the request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad json")));
    await withRequestAccounting(undefined, async () => {
      const response = await fetchModelCompletion("https://provider.test", {}, metadata);
      await expect(readModelJson(response)).rejects.toThrow();
      expect(requestAccountingSnapshot()?.modelRequests[0].status).toBe("failed");
    });
  });

  it("isolates concurrent turns and groups only the same owner/Bot/task", async () => {
    const keys = [accountingTaskKey("owner", "bot", "task"), accountingTaskKey("other", "bot", "task")];
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[0]).toBe(accountingTaskKey("owner", "bot", "task"));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await Promise.all([
      withRequestAccounting(keys[0], async () => {
        const span = startModelRequest(metadata);
        await gate;
        span.usage(usage); span.end("completed"); recordTurn(turn);
      }),
      withRequestAccounting(keys[1], async () => {
        const span = startModelRequest(metadata);
        span.end("failed"); recordTurn(turn); release();
      }),
    ]);
    withRequestAccounting(keys[0], () => { recordTurn(turn); });
    expect(recentTurns().every((r) => (r.modelRequests?.length ?? 0) <= 1)).toBe(true);
    expect(taskUsageStats().map((t) => t.turns).sort()).toEqual([1, 2]);
    expect(requestAccountingSnapshot()).toBeUndefined();
  });

  it("attributes assembly blocks without retaining contents or double counting", () => {
    const request = { messages: [{ role: "system", content: 'rules\nSkill: "quoted"\nledger' },
      { role: "user", content: "old" }, { role: "assistant", content: "history" },
      { role: "user", content: "current" }, { role: "tool", content: "tool output" }], tools: [{ name: "read" }] };
    const sources = measureRequestSources(request, [
      { source: "skills", text: 'Skill: "quoted"' }, { source: "ledger", text: "ledger" },
    ]);
    expect(sources.skills).toBe(JSON.stringify('Skill: "quoted"').length - 2);
    expect(sources.ledger).toBe(6);
    expect(sources.history).toBeGreaterThan(0);
    expect(sources.toolResults).toBeGreaterThan(0);
    expect(Object.values(sources).reduce((sum, n) => sum + n, 0)).toBe(JSON.stringify(request).length);
    withRequestAccounting(undefined, () => {
      setAccountingSections([{ source: "ledger", text: "secret ledger" }]);
      startModelRequest(metadata).end("completed");
      expect(JSON.stringify(requestAccountingSnapshot())).not.toContain("secret ledger");
    });
  });
});

describe("streamed usage", () => {
  const response = (events: unknown[]) => new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n",
    { headers: { "Content-Type": "text/event-stream" } });
  const request = { url: "https://provider.test", headers: {}, payload };

  it("accepts a usage-only final chunk and replaces cumulative usage", async () => {
    const fetcher = vi.fn().mockResolvedValue(response([
      { model: "resolved", choices: [{ delta: { content: "Hello" } }], usage: { prompt_tokens: 100, completion_tokens: 1 } },
      { choices: [], usage },
    ]));
    vi.stubGlobal("fetch", fetcher);
    await withRequestAccounting(undefined, async () => {
      const result = await streamChatCompletion(request);
      expect(result.usage).toEqual(usage);
      const records = requestAccountingSnapshot()!.modelRequests;
      expect(records[0].firstTokenMs).not.toBeNull();
      expect(summarizeUsage(records).known.output).toBe(20);
      expect(JSON.parse(fetcher.mock.calls[0][1].body).stream).toBe(true);
      expect(JSON.parse(fetcher.mock.calls[0][1].body)).not.toHaveProperty("stream_options");
    });
  });

  it("accounts separately for a rejected reasoning request and its retry", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json({ error: { message: "reasoning unsupported" } }, { status: 400 }))
      .mockResolvedValueOnce(response([{ choices: [], usage }])));
    await withRequestAccounting(undefined, async () => {
      await streamChatCompletion({ ...request, payload: { ...payload, reasoning: { effort: "high" } } });
      const records = requestAccountingSnapshot()!.modelRequests;
      expect(records.map((r) => r.status)).toEqual(["failed", "completed"]);
      expect(summarizeUsage(records).unknown.input).toBe(1);
    });
  });

  it("retains reported usage when an upstream stream later fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response([
      { choices: [{ delta: { content: "partial" } }], usage }, { error: { message: "stream interrupted" } },
    ])));
    await withRequestAccounting(undefined, async () => {
      await expect(streamChatCompletion(request)).rejects.toThrow("interrupted");
      expect(requestAccountingSnapshot()!.modelRequests[0]).toMatchObject({ status: "failed", usage: { input: 100 } });
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../server/db", () => ({ listRookNodesForUser: vi.fn(async () => []) }));
vi.mock("../server/ai/fallback-router", async (importOriginal) => {
  const original = await importOriginal<typeof import("../server/ai/fallback-router")>();
  return { ...original, invokeAiResilient: vi.fn() };
});

import { friendlyAgentError, classifyRetryDecision, canRetryAgentRound } from "../server/ai/agent-reliability";
import { runRookAgentStream } from "../server/ai/agent-stream";
import { invokeAiResilient } from "../server/ai/fallback-router";
import { ModelHealth } from "../server/ai/model-health";
import {
  classifyProviderFailure,
  describeErrorForLog,
  parseProviderBody,
  ProviderError,
  redactAndTruncate,
  toProviderError,
} from "../server/ai/provider-error";
import { defaultModelForProvider } from "../lib/ai-provider";

const dead = (extra: Partial<ConstructorParameters<typeof ProviderError>[0]> = {}) =>
  new ProviderError({
    layer: "chatgpt-responses", provider: "chatgpt", model: "gpt-5.5", kind: "model-unavailable",
    status: 404, code: "model_not_found", providerMessage: "The requested model 'gpt-5.5' does not exist.", ...extra,
  });

describe("provider body parsing", () => {
  it("reads the proxy envelope around an upstream error object", () => {
    const body = JSON.stringify({ error: "responses_request_failed", status: 404, detail: JSON.stringify({ error: { message: "nope", code: "model_not_found" } }) });
    expect(parseProviderBody(body)).toEqual({ status: 404, code: "model_not_found", message: "nope" });
  });

  it("reads a bare {detail} upstream body and plain-text detail", () => {
    const wrapped = JSON.stringify({ error: "responses_request_failed", status: 400, detail: JSON.stringify({ detail: "The 'gpt-5' model is not supported when using Codex with a ChatGPT account." }) });
    expect(parseProviderBody(wrapped).message).toMatch(/not supported when using Codex/);
    expect(parseProviderBody(JSON.stringify({ error: "responses_request_failed", status: 502, detail: "bad gateway" })).message).toBe("bad gateway");
    expect(parseProviderBody("not json at all").message).toBe("not json at all");
  });

  it("classifies by code first, then status", () => {
    expect(classifyProviderFailure({ status: 404, code: "model_not_found", message: "x" })).toBe("model-unavailable");
    expect(classifyProviderFailure({ status: 400, message: "The 'gpt-5' model is not supported when using Codex with a ChatGPT account." })).toBe("model-unavailable");
    expect(classifyProviderFailure({ status: 502, code: "token_refresh_failed", message: "x" })).toBe("auth");
    expect(classifyProviderFailure({ status: 401, message: "x" })).toBe("auth");
    expect(classifyProviderFailure({ status: 429, message: "x" })).toBe("rate-limit");
    expect(classifyProviderFailure({ status: 500, message: "x" })).toBe("transient");
    expect(classifyProviderFailure({ status: 400, message: "bad schema" })).toBe("bad-request");
    expect(classifyProviderFailure({ message: "???" })).toBe("unknown");
  });

  it("unwraps AI SDK retry errors and records the empty-output case honestly", () => {
    const apiCall = Object.assign(new Error(""), { name: "AI_APICallError", statusCode: 429, responseBody: JSON.stringify({ error: "responses_request_failed", status: 429, detail: "slow down" }) });
    const retry = Object.assign(new Error("Failed after 2 attempts. Last error: AI_APICallError"), { name: "AI_RetryError", lastError: apiCall, errors: [apiCall] });
    expect(toProviderError(retry, { layer: "l", provider: "chatgpt" }).info).toMatchObject({ kind: "rate-limit", status: 429, providerMessage: "slow down" });
    const empty = Object.assign(new Error("No output generated. Check the stream for errors."), { name: "AI_NoOutputGeneratedError" });
    expect(toProviderError(empty, { layer: "l", provider: "chatgpt" }).kind).toBe("empty");
  });

  it("redacts credentials and bounds length", () => {
    const text = redactAndTruncate(`Bearer abc.def-ghi eyJhbGciOiJI.eyJzdWIiOiIx.sig sk-abcdefghijklmnop ${"x".repeat(500)}`);
    expect(text).not.toMatch(/abc\.def|eyJhbG|sk-abcdef/);
    expect(text.length).toBeLessThanOrEqual(300);
  });

  it("log description names the layer; plain errors are labelled unclassified", () => {
    expect(describeErrorForLog(dead())).toMatchObject({ layer: "chatgpt-responses", kind: "model-unavailable", status: 404, code: "model_not_found", model: "gpt-5.5" });
    expect(describeErrorForLog(new Error("boom"))).toMatchObject({ layer: "unclassified", message: "boom" });
  });
});

describe("user-facing message", () => {
  it("is specific for every typed failure and keeps the shrug for truly unknown errors", () => {
    expect(friendlyAgentError(dead())).toMatch(/can't run gpt-5\.5.*does not exist/);
    expect(friendlyAgentError(dead({ kind: "auth", status: 401, code: "not_authenticated", providerMessage: "not_authenticated" }))).toMatch(/reconnect/i);
    expect(friendlyAgentError(dead({ kind: "bad-request", status: 400, providerMessage: "Invalid schema" }))).toMatch(/\(400\): Invalid schema/);
    expect(friendlyAgentError(dead({ kind: "rate-limit" }))).toMatch(/capacity|moment|seconds/i);
    expect(friendlyAgentError(new Error("something odd"))).toMatch(/couldn't produce a usable answer/);
  });

  it("typed failures drive retry classification, not message wording", () => {
    expect(classifyRetryDecision(dead())).toBe("fatal");
    expect(canRetryAgentRound(dead({ kind: "transient", status: 503 }))).toBe(true);
    expect(classifyRetryDecision(dead({ kind: "auth" }))).toBe("emit");
    expect(canRetryAgentRound(dead({ kind: "bad-request", providerMessage: "mentions 429 and timeout" }))).toBe(false);
  });
});

describe("ModelHealth", () => {
  it("alerts every third consecutive failure and resets on success", () => {
    const alert = vi.fn();
    const health = new ModelHealth({ alert, now: () => 0 });
    const fail = () => health.record({ provider: "chatgpt", model: "m", ok: false, kind: "model-unavailable", status: 404 });
    fail(); fail();
    expect(alert).not.toHaveBeenCalled();
    fail();
    expect(alert).toHaveBeenCalledTimes(1);
    health.record({ provider: "chatgpt", model: "m", ok: true });
    fail(); fail();
    expect(alert).toHaveBeenCalledTimes(1);
    expect(health.snapshot()[0]).toMatchObject({ failures: 5, consecutiveFailures: 2, attempts: 6 });
  });

  it("expires per-account unavailable labels on the injected clock and scopes them by account", () => {
    let now = 1_000;
    const health = new ModelHealth({ now: () => now, stateTtlMs: 60_000 });
    health.mark("acct-a", "gpt-5.5", "unavailable", "gone");
    expect(health.stateOf("acct-a", "gpt-5.5")).toMatchObject({ state: "unavailable", reason: "gone" });
    expect(health.stateOf("acct-b", "gpt-5.5")).toBeUndefined();
    now += 60_000;
    expect(health.stateOf("acct-a", "gpt-5.5")).toBeUndefined();
  });

  it("stays bounded", () => {
    const health = new ModelHealth({ maxEntries: 3 });
    for (let i = 0; i < 10; i += 1) {
      health.record({ provider: "p", model: `m${i}`, ok: true });
      health.mark("s", `m${i}`, "ok");
    }
    expect(health.snapshot()).toHaveLength(3);
  });
});

describe("picker defaults never choose an unavailable model", () => {
  it("skips unavailable ChatGPT models when picking a default", () => {
    const models = [
      { id: "chatgpt:gpt-5.5", name: "Gpt 5.5", provider: "ChatGPT", automatic: false, unavailable: true },
      { id: "chatgpt:codex-auto-review", name: "Codex Auto Review", provider: "ChatGPT", automatic: false },
    ];
    expect(defaultModelForProvider(models, "chatgpt")?.id).toBe("chatgpt:codex-auto-review");
    expect(defaultModelForProvider(models.slice(0, 1), "chatgpt")).toBeUndefined();
  });
});

describe("streamed 'hey' turn with a dead ChatGPT slug", () => {
  const input = {
    userId: "user-1", botId: "bot-1", taskId: "task-1", botName: "Scout", botRole: "researcher",
    botPurpose: "Track launches.", model: "chatgpt:gpt-5.5", message: "hey", recentContext: [],
  };
  beforeEach(() => {
    vi.mocked(invokeAiResilient).mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("surfaces the precise reason instead of the shrug, and logs the layer", async () => {
    vi.mocked(invokeAiResilient).mockRejectedValue(dead());
    const result = await runRookAgentStream(input, () => undefined);
    expect(result.text).toMatch(/can't run gpt-5\.5/);
    expect(result.text).not.toMatch(/usable answer/);
    expect(console.warn).toHaveBeenCalledWith(
      "[RookAI] streamed turn failed",
      expect.objectContaining({ layer: "chatgpt-responses", kind: "model-unavailable", status: 404, requestedModel: "chatgpt:gpt-5.5" }),
    );
  });

  it("shows a fallback as a visible trace step", async () => {
    vi.mocked(invokeAiResilient).mockResolvedValue({
      result: { id: "or", created: 1, model: "openrouter/free", choices: [{ index: 0, message: { role: "assistant", content: "Hey!" }, finish_reason: "stop" }] },
      attemptedProviders: ["chatgpt", "openrouter"],
      fellBack: true,
      fallbackReason: "ChatGPT doesn't offer gpt-5.5 on this account",
    });
    const events: Array<{ type: string; step?: { title: string } }> = [];
    const result = await runRookAgentStream(input, (event) => events.push(event as never));
    expect(result.text).toBe("Hey!");
    expect(result.fellBack).toBe(true);
    expect(events.some((event) => event.type === "trace" && event.step?.title === "Answered with a backup model")).toBe(true);
  });
});

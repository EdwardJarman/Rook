/**
 * Failure matrix for the ChatGPT path, hermetic: the real AI SDK and the real
 * `invokeChatGPT` / router / agent loop run against a fake proxy fetch that
 * returns exactly the bodies the Codex proxy handler emits
 * (`{ error: "responses_request_failed", status, detail }`).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../server/db", () => ({ listRookNodesForUser: vi.fn(async () => []) }));
vi.mock("@clerk/backend", () => ({
  verifyToken: vi.fn(async () => ({ sub: "user_1" })),
  createClerkClient: vi.fn(() => ({})),
}));

const proxy = vi.hoisted(() => ({
  slugs: ["gpt-5.5", "codex-auto-review"] as string[],
  fetch: undefined as undefined | ((input: unknown, init?: RequestInit) => Promise<Response>),
  sentModels: [] as string[],
}));

vi.mock("@opencoredev/loginwithchatgpt-server", () => ({
  sign: vi.fn(async () => "signed"),
  decryptJson: vi.fn(),
  createChatGPTHandler: vi.fn(() => ({
    handler: vi.fn(),
    proxyFetch: () => async (input: unknown, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as { model?: string }) : {};
      if (body.model) proxy.sentModels.push(body.model);
      return proxy.fetch!(input, init);
    },
    getModels: async () => proxy.slugs,
  })),
}));

vi.mock("../server/ai/openrouter", async (importOriginal) => {
  const original = await importOriginal<typeof import("../server/ai/openrouter")>();
  return { ...original, invokeOpenRouter: vi.fn(), isOpenRouterConfigured: vi.fn(() => true) };
});

import { friendlyAgentError } from "../server/ai/agent-reliability";
import { invokeChatGPT, listChatGPTModels, probeChatGPTModels } from "../server/ai/chatgpt";
import { __resetFallbackBreakerForTests, invokeAiResilient, shouldFallBack } from "../server/ai/fallback-router";
import { __resetModelHealthForTests, modelHealth } from "../server/ai/model-health";
import { invokeOpenRouter, isOpenRouterConfigured } from "../server/ai/openrouter";
import { ProviderError } from "../server/ai/provider-error";
import { __resetTelemetryForTests } from "../server/ai/telemetry";
import { runRookAgent } from "../server/integrations/excel-agent";

const request = {
  protocol: "https",
  header: (name: string) =>
    name.toLowerCase() === "authorization" ? "Bearer header.payload.signature" : name.toLowerCase() === "host" ? "rook.test" : undefined,
} as never;

const json = (status: number, body: unknown) =>
  // retry-after-ms makes the AI SDK's single retry near-instant (deterministic, no real backoff wait).
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "retry-after-ms": "1" } });
const upstream = (status: number, detail: unknown) =>
  json(status, { error: "responses_request_failed", status, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });

const MODEL_NOT_FOUND = upstream(404, {
  error: { message: "The requested model 'gpt-5.5' does not exist.", type: "invalid_request_error", param: "model", code: "model_not_found" },
});
const NOT_SUPPORTED = upstream(400, { detail: "The 'gpt-5' model is not supported when using Codex with a ChatGPT account." });

const sse = (text: string) => {
  const events = [
    { type: "response.created", response: { id: "resp_1", created_at: 1, model: "m", output: [] } },
    { type: "response.output_item.added", output_index: 0, item: { type: "message", id: "msg_1", role: "assistant", status: "in_progress", content: [] } },
    { type: "response.output_text.delta", item_id: "msg_1", output_index: 0, content_index: 0, delta: text },
    { type: "response.output_item.done", output_index: 0, item: { type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] } },
    { type: "response.completed", response: { incomplete_details: null, usage: { input_tokens: 1, output_tokens: 1, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } },
  ];
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
};

const respondWith = (make: () => Response) => {
  proxy.fetch = async () => make();
};

const hey = { model: "chatgpt:gpt-5.5", messages: [{ role: "user" as const, content: "hey" }] };

const failureOf = async (run: () => Promise<unknown>): Promise<ProviderError> => {
  const error = await run().then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ProviderError);
  return error as ProviderError;
};

beforeAll(async () => {
  // Concurrent first-time dynamic imports of a mocked module can race and resolve the real one.
  await import("@opencoredev/loginwithchatgpt-server");
  await import("@opencoredev/loginwithchatgpt-ai");
  await import("ai");
});

beforeEach(() => {
  vi.stubEnv("CLERK_SECRET_KEY", "sk_test_matrix");
  vi.stubEnv("OPENROUTER_API_KEY", "or-test");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.mocked(invokeOpenRouter).mockReset();
  vi.mocked(isOpenRouterConfigured).mockReturnValue(true);
  proxy.slugs = ["gpt-5.5", "codex-auto-review"];
  proxy.sentModels.length = 0;
  __resetModelHealthForTests();
  __resetFallbackBreakerForTests();
  __resetTelemetryForTests();
});

describe("invokeChatGPT: provider failures keep their identity", () => {
  it("good model: answers and sends the exact slug", async () => {
    respondWith(() => sse("Hey!"));
    const result = await invokeChatGPT(hey, request);
    expect(result.choices[0]?.message.content).toBe("Hey!");
    expect(proxy.sentModels).toEqual(["gpt-5.5"]);
  });

  it("dead slug (404 model_not_found) is typed, not 'No output generated'", async () => {
    respondWith(() => MODEL_NOT_FOUND.clone());
    const failure = await failureOf(() => invokeChatGPT(hey, request));
    expect(failure.info).toMatchObject({ kind: "model-unavailable", status: 404, code: "model_not_found", provider: "chatgpt", model: "gpt-5.5", layer: "chatgpt-responses" });
    expect(failure.info.providerMessage).toContain("does not exist");
    expect(failure.message).not.toMatch(/No output generated/);
  });

  it("'not supported when using Codex with a ChatGPT account' (400) is a dead model", async () => {
    respondWith(() => NOT_SUPPORTED.clone());
    const failure = await failureOf(() => invokeChatGPT({ ...hey, model: "chatgpt:gpt-5" }, request));
    expect(failure.info).toMatchObject({ kind: "model-unavailable", status: 400, model: "gpt-5" });
    expect(failure.info.providerMessage).toContain("not supported when using Codex");
  });

  it("expired session (401 not_authenticated) is auth", async () => {
    respondWith(() => json(401, { error: "not_authenticated" }));
    const failure = await failureOf(() => invokeChatGPT(hey, request));
    expect(failure.info).toMatchObject({ kind: "auth", status: 401 });
  });

  it("refresh failure (502 token_refresh_failed) is auth, not transient", async () => {
    respondWith(() => json(502, { error: "token_refresh_failed", message: "refresh failed" }));
    const failure = await failureOf(() => invokeChatGPT(hey, request));
    expect(failure.kind).toBe("auth");
  });

  it("429 is rate-limit and 503 is transient", async () => {
    respondWith(() => upstream(429, { error: { message: "slow down", code: "rate_limit_exceeded" } }));
    expect((await failureOf(() => invokeChatGPT(hey, request))).kind).toBe("rate-limit");
    respondWith(() => upstream(503, "upstream busy"));
    expect((await failureOf(() => invokeChatGPT(hey, request))).kind).toBe("transient");
  });

  it("never leaks bearer tokens into the typed error", async () => {
    respondWith(() => upstream(400, "bad Bearer abc.def.ghi-secret token"));
    const failure = await failureOf(() => invokeChatGPT(hey, request));
    expect(failure.info.providerMessage).not.toContain("ghi-secret");
  });
});

describe("model labelling: a rejected model stops being offered", () => {
  it("lists every slug as available until the provider rejects one", async () => {
    const before = await listChatGPTModels(request, { verify: false });
    expect(before.map((model) => [model.id, Boolean(model.unavailable)])).toEqual([
      ["chatgpt:gpt-5.5", false],
      ["chatgpt:codex-auto-review", false],
    ]);
    respondWith(() => MODEL_NOT_FOUND.clone());
    await failureOf(() => invokeChatGPT(hey, request));
    const after = await listChatGPTModels(request, { verify: false });
    expect(after.find((model) => model.id === "chatgpt:gpt-5.5")).toMatchObject({ unavailable: true, usageLabel: "Unavailable on your account" });
    expect(after.find((model) => model.id === "chatgpt:codex-auto-review")?.unavailable).toBeUndefined();
  });

  it("a later success clears the label", async () => {
    respondWith(() => MODEL_NOT_FOUND.clone());
    await failureOf(() => invokeChatGPT(hey, request));
    respondWith(() => sse("back"));
    await invokeChatGPT(hey, request);
    const models = await listChatGPTModels(request, { verify: false });
    expect(models.every((model) => !model.unavailable)).toBe(true);
  });

  it("verified listing probes each slug and labels only definitive rejections", async () => {
    proxy.fetch = async (_input, init) => {
      const model = (JSON.parse(String(init?.body)) as { model: string }).model;
      return model === "gpt-5.5" ? MODEL_NOT_FOUND.clone() : sse("OK");
    };
    const models = await listChatGPTModels(request, { verify: true, concurrency: 1 });
    expect(models.map((model) => [model.id, Boolean(model.unavailable)])).toEqual([
      ["chatgpt:gpt-5.5", true],
      ["chatgpt:codex-auto-review", false],
    ]);
    const sentBefore = proxy.sentModels.length; 
    await listChatGPTModels(request, { verify: true, concurrency: 1 });
    expect(proxy.sentModels.length).toBe(sentBefore);
  });

  it("an auth or rate-limit failure while probing does not mark a model dead", async () => {
    respondWith(() => json(401, { error: "not_authenticated" }));
    const results = await probeChatGPTModels(request, ["gpt-5.5"], { scope: "scope-x" });
    expect(results).toEqual([expect.objectContaining({ slug: "gpt-5.5", status: "unknown", kind: "auth" })]);
    expect(modelHealth.stateOf("scope-x", "gpt-5.5")).toBeUndefined();
  });

  it("a failed listing is logged with its layer and returns no models", async () => {
    vi.mocked((await import("@clerk/backend")).verifyToken).mockRejectedValueOnce(new Error("jwks unreachable"));
    expect(await listChatGPTModels(request, { verify: false })).toEqual([]);
    expect(console.warn).toHaveBeenCalledWith("[ChatGPT models] listing failed", expect.objectContaining({ layer: "chatgpt-models" }));
  });
});

describe("router: fallback is attempted, reported and verified", () => {
  const openRouterAnswer = (text: string) => ({
    id: "or-1",
    created: 1,
    model: "openrouter/free",
    choices: [{ index: 0, message: { role: "assistant" as const, content: text }, finish_reason: "stop" as const }],
  });

  it("dead slug → OpenRouter answers, flagged as a fallback with the reason", async () => {
    respondWith(() => MODEL_NOT_FOUND.clone());
    vi.mocked(invokeOpenRouter).mockResolvedValueOnce(openRouterAnswer("Hey!"));
    const outcome = await invokeAiResilient(hey, request);
    expect(outcome.fellBack).toBe(true);
    expect(outcome.attemptedProviders).toEqual(["chatgpt", "openrouter"]);
    expect(outcome.fallbackReason).toMatch(/doesn't offer gpt-5\.5/);
    expect(outcome.result.choices[0]?.message.content).toBe("Hey!");
    expect(console.warn).toHaveBeenCalledWith("[RookAI] fallback answered", expect.objectContaining({ answeredBy: "openrouter/free" }));
  });

  it("expired session → OpenRouter fallback, as documented", async () => {
    respondWith(() => json(401, { error: "not_authenticated" }));
    vi.mocked(invokeOpenRouter).mockResolvedValueOnce(openRouterAnswer("still here"));
    const outcome = await invokeAiResilient(hey, request);
    expect(outcome.fellBack).toBe(true);
    expect(outcome.fallbackReason).toMatch(/reconnected/);
  });

  it("transient ChatGPT failure now shows up as a recorded fallback, not a hidden one", async () => {
    respondWith(() => upstream(503, "busy"));
    vi.mocked(invokeOpenRouter).mockResolvedValueOnce(openRouterAnswer("ok"));
    const outcome = await invokeAiResilient(hey, request);
    expect(outcome.attemptedProviders).toEqual(["chatgpt", "openrouter"]);
    expect(outcome.fellBack).toBe(true);
  });

  it("dead slug with no fallback configured → the precise error surfaces", async () => {
    vi.mocked(isOpenRouterConfigured).mockReturnValue(false);
    respondWith(() => MODEL_NOT_FOUND.clone());
    const failure = await failureOf(() => invokeAiResilient(hey, request));
    expect(failure.info).toMatchObject({ kind: "model-unavailable", status: 404, code: "model_not_found" });
    expect(invokeOpenRouter).not.toHaveBeenCalled();
  });

  it("fallback failure keeps the original error and records the second one", async () => {
    respondWith(() => MODEL_NOT_FOUND.clone());
    vi.mocked(invokeOpenRouter).mockRejectedValueOnce(new Error("Rook's OpenRouter connection needs attention."));
    const failure = await failureOf(() => invokeAiResilient(hey, request));
    expect(failure.info.kind).toBe("model-unavailable");
    expect(failure.fallbackFailure).toMatchObject({ provider: "openrouter", kind: "auth" });
    const line = friendlyAgentError(failure);
    expect(line).toContain("gpt-5.5");
    expect(line).toContain("backup");
  });

  it("an unrelated 400 is not silently swapped to another provider", async () => {
    respondWith(() => upstream(400, { error: { message: "Invalid schema for function 'x'", code: "invalid_function_parameters" } }));
    const failure = await failureOf(() => invokeAiResilient(hey, request));
    expect(failure.kind).toBe("bad-request");
    expect(invokeOpenRouter).not.toHaveBeenCalled();
  });

  it("failures are counted per model for telemetry and page after repeats", async () => {
    respondWith(() => MODEL_NOT_FOUND.clone());
    vi.mocked(invokeOpenRouter).mockResolvedValue(openRouterAnswer("ok"));
    for (let i = 0; i < 3; i += 1) await invokeAiResilient(hey, request);
    const stat = modelHealth.snapshot().find((entry) => entry.model === "chatgpt:gpt-5.5");
    expect(stat).toMatchObject({ provider: "chatgpt", failures: 3, consecutiveFailures: 3, lastKind: "model-unavailable", lastStatus: 404, lastCode: "model_not_found" });
    expect(console.error).toHaveBeenCalledWith("[RookAI] model failing repeatedly", expect.objectContaining({ model: "chatgpt:gpt-5.5", consecutiveFailures: 3 }));
  });

  it("shouldFallBack never lets a shared-provider auth error fall through", () => {
    expect(shouldFallBack(new Error("Rook's OpenRouter connection needs attention."), "openrouter")).toBe(false);
  });
});

describe("the 'hey' turn end to end", () => {
  const input = {
    userId: "user-1", botId: "bot-1", taskId: "task-1", botName: "Scout", botRole: "researcher",
    botPurpose: "Track launches.", model: "chatgpt:gpt-5.5", message: "hey", recentContext: [], request,
  };

  it("dead slug + OpenRouter up: the user gets an answer and a visible note", async () => {
    respondWith(() => MODEL_NOT_FOUND.clone());
    vi.mocked(invokeOpenRouter).mockResolvedValueOnce({
      id: "or", created: 1, model: "openrouter/free",
      choices: [{ index: 0, message: { role: "assistant", content: "Hey! How can I help?" }, finish_reason: "stop" }],
    });
    const result = await runRookAgent(input as never);
    expect(result.text).toBe("Hey! How can I help?");
    expect(result.fellBack).toBe(true);
    expect(result.trace.some((step) => step.title === "Answered with a backup model" && /gpt-5\.5/.test(step.detail ?? ""))).toBe(true);
  });

  it("dead slug + no fallback: the reply names the model and the provider's reason, never the shrug", async () => {
    vi.mocked(isOpenRouterConfigured).mockReturnValue(false);
    respondWith(() => MODEL_NOT_FOUND.clone());
    const result = await runRookAgent(input as never);
    expect(result.text).toContain("gpt-5.5");
    expect(result.text).toContain("does not exist");
    expect(result.text).not.toMatch(/couldn't produce a usable answer/);
  });

  it("expired session + no fallback: tells the user to reconnect", async () => {
    vi.mocked(isOpenRouterConfigured).mockReturnValue(false);
    respondWith(() => json(401, { error: "not_authenticated" }));
    const result = await runRookAgent(input as never);
    expect(result.text).toMatch(/reconnect/i);
  });
});

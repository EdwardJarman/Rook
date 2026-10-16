/**
 * Failure matrix for the OpenCode path, hermetic: the real `invokeOpenCode`,
 * stream branch, router and agent loops run over real HTTP against a fake
 * `opencode serve` that replays the exact bodies a live v1.18.34 server
 * produced (captured while diagnosing "hi" → "I couldn't produce a usable
 * answer"). Mirrors tests/chatgpt-failure-matrix.test.ts.
 */
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../server/db", () => ({ listRookNodesForUser: vi.fn(async () => []) }));
vi.mock("../server/ai/openrouter", async (importOriginal) => {
  const original = await importOriginal<typeof import("../server/ai/openrouter")>();
  return { ...original, invokeOpenRouter: vi.fn(), isOpenRouterConfigured: vi.fn(() => true) };
});

import { friendlyAgentError } from "../server/ai/agent-reliability";
import { runRookAgentStream } from "../server/ai/agent-stream";
import { __resetFallbackBreakerForTests, invokeAiResilient, shouldFallBack } from "../server/ai/fallback-router";
import { __resetModelHealthForTests, modelHealth } from "../server/ai/model-health";
import { invokeAiStream } from "../server/ai/openai-stream";
import { __resetOpenCodeForTests, invokeOpenCode, listOpenCodeModelsLive } from "../server/ai/opencode";
import { invokeOpenRouter, isOpenRouterConfigured } from "../server/ai/openrouter";
import { ProviderError } from "../server/ai/provider-error";
import { __resetTelemetryForTests } from "../server/ai/telemetry";
import { runRookAgent } from "../server/integrations/excel-agent";

type Event = { type: string; data: Record<string, unknown> };
type Fake = {
  /** Models `/api/model` reports; null → endpoint 404s (old server). */
  served: Array<{ id: string; status?: string; enabled?: boolean }> | null;
  history: () => Event[];
  messages: Record<string, unknown>;
  permission: unknown[];
  active: string[];
  createStatus?: { status: number; body: unknown };
  /** Basic-auth password the server insists on. */
  password?: string;
  sessionsCreated: Array<{ providerID: string; id: string }>;
};

const fake: Fake = { served: [], history: () => [], messages: {}, permission: [], active: [], sessionsCreated: [] };
let server: Server;
let base = "";

const ALL_SERVED = [
  "big-pickle",
  "muse-spark-1.3-contributor-free",
  "muse-spark-1.2-contributor-free",
  "ling-3.0-flash-fin-free",
  "mimo-v2.5-free",
  "nemotron-3-ultra-free",
  "nemotron-3.5-lightning-free",
].map((id) => ({ id, status: "active", enabled: true }));

const send = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? "";
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      if (fake.password && req.headers.authorization !== `Basic ${Buffer.from(`opencode:${fake.password}`).toString("base64")}`) {
        return send(res, 401, { _tag: "UnauthorizedError", message: "Authentication required" });
      }
      if (url === "/api/model") {
        if (!fake.served) return send(res, 404, { message: "not found" });
        return send(res, 200, { data: fake.served.map((model) => ({ ...model, providerID: "opencode" })) });
      }
      if (url === "/api/event") return send(res, 404, { message: "no event stream" });
      if (req.method === "POST" && url === "/api/session") {
        if (fake.createStatus) return send(res, fake.createStatus.status, fake.createStatus.body);
        fake.sessionsCreated.push((JSON.parse(raw) as { model: { providerID: string; id: string } }).model);
        return send(res, 200, { data: { id: "ses_1" } });
      }
      if (req.method === "POST" && url === "/api/session/ses_1/prompt") return send(res, 200, { data: { id: "msg_1" } });
      if (url === "/api/session/ses_1/history") return send(res, 200, { data: fake.history(), hasMore: false });
      if (url === "/api/session/ses_1/permission") return send(res, 200, { data: fake.permission });
      if (url === "/api/session/active") {
        return send(res, 200, { data: Object.fromEntries(fake.active.map((id) => [id, { type: "running" }])) });
      }
      const message = /^\/api\/session\/ses_1\/message\/(.+)$/.exec(url);
      if (message && fake.messages[message[1]!]) return send(res, 200, { data: fake.messages[message[1]!] });
      return send(res, 404, { message: `no route ${url}` });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const started = (id: string): Event => ({ type: "session.next.step.started", data: { assistantMessageID: id, agent: "build" } });
const ended = (id: string, finish: string): Event => ({ type: "session.next.step.ended", data: { assistantMessageID: id, finish } });
const failed = (id: string, message: string): Event => ({
  type: "session.next.step.failed",
  data: { assistantMessageID: id, error: { type: "unknown", message } },
});
const prompted: Event[] = [
  { type: "session.next.prompt.admitted", data: {} },
  { type: "session.next.prompted", data: {} },
];
const reply = (text: string, finish = "stop") => ({
  time: { completed: 2 },
  content: [{ type: "reasoning", text: "thinking" }, ...(text ? [{ type: "text", text }] : [])],
  finish,
  tokens: { input: 10, output: text ? 5 : 0 },
});

// Captured verbatim from a live server for model ling-3.0-flash-fin-free:
const ENDPOINT_UNAVAILABLE =
  'Provider request failed with HTTP 400: {"error":{"type":"server_error","message":"Error from provider (Console): Upstream request failed: Endpoint is unavailable."}}';

const hi = { model: "opencode:muse-spark-1.3-contributor-free", messages: [{ role: "user" as const, content: "hi" }] };
const failureOf = async (run: () => Promise<unknown>): Promise<ProviderError> => {
  const error = await run().then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ProviderError);
  return error as ProviderError;
};
const happyHistory = (): Event[] => [...prompted, started("a1"), ended("a1", "stop")];

beforeEach(() => {
  vi.stubEnv("OPENCODE_BASE_URL", base);
  vi.stubEnv("OPENCODE_MANAGED", "0");
  vi.stubEnv("OPENCODE_POLL_INTERVAL_MS", "10");
  vi.stubEnv("OPENCODE_STALL_AFTER_MS", "60000");
  vi.stubEnv("OPENCODE_TURN_TIMEOUT_MS", "20000");
  vi.stubEnv("OPENROUTER_API_KEY", "or-test");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.mocked(invokeOpenRouter).mockReset();
  vi.mocked(isOpenRouterConfigured).mockReturnValue(true);
  Object.assign(fake, {
    served: ALL_SERVED,
    history: happyHistory,
    messages: { a1: reply("Hi! What can I help you with?") },
    permission: [],
    active: [],
    createStatus: undefined,
    password: undefined,
    sessionsCreated: [],
  });
  __resetOpenCodeForTests();
  __resetModelHealthForTests();
  __resetFallbackBreakerForTests();
  __resetTelemetryForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("invokeOpenCode: working models are unchanged", () => {
  it("answers hi and sends the exact provider/model to the server", async () => {
    const result = await invokeOpenCode(hi);
    expect(result.choices[0]?.message.content).toBe("Hi! What can I help you with?");
    expect(fake.sessionsCreated).toEqual([{ providerID: "opencode", id: "muse-spark-1.3-contributor-free" }]);
  });

  it("a tool-first model (step 1 = tool call, step 2 = the reply) answers from the final step, never step 1's partial", async () => {
    // Real Muse Spark 1.3 shape. The gap before step 2 starts outlasts the quiet-poll window.
    fake.messages = { a1: reply("Let me look around first.", "tool-calls"), a2: reply("Your workspace is empty.") };
    let polls = 0;
    fake.history = () => {
      polls += 1;
      return polls < 12
        ? [...prompted, started("a1"), ended("a1", "tool-calls")]
        : [...prompted, started("a1"), ended("a1", "tool-calls"), started("a2"), ended("a2", "stop")];
    };
    const result = await invokeOpenCode(hi);
    expect(result.choices[0]?.message.content).toBe("Your workspace is empty.");
  });
});

describe("invokeOpenCode: provider failures keep their identity", () => {
  it("a failed first step (HTTP 400 'Endpoint is unavailable') is typed at once — not a budget-long wait", async () => {
    fake.history = () => [...prompted, started("a1"), failed("a1", ENDPOINT_UNAVAILABLE)];
    const began = Date.now();
    const failure = await failureOf(() => invokeOpenCode({ ...hi, model: "opencode:ling-3.0-flash-fin-free" }));
    expect(Date.now() - began).toBeLessThan(5_000);
    expect(failure.info).toMatchObject({
      layer: "opencode-upstream",
      provider: "opencode",
      model: "opencode:ling-3.0-flash-fin-free",
      kind: "transient",
      status: 400,
      code: "server_error",
    });
    expect(failure.info.providerMessage).toContain("Endpoint is unavailable");
  });

  it("a malformed gateway stream (seen live on Big Pickle) is transient and says so", async () => {
    fake.history = () => [...prompted, started("a1"), failed("a1", "Invalid opencode/openai-compatible-chat stream event.")];
    const failure = await failureOf(() => invokeOpenCode({ ...hi, model: "opencode:big-pickle" }));
    expect(failure.info).toMatchObject({ layer: "opencode-upstream", kind: "transient", code: "invalid_stream_event" });
    expect(failure.info.providerMessage).toContain("Invalid opencode/openai-compatible-chat stream event");
    expect(shouldFallBack(failure, "opencode")).toBe(true);
  });

  it("a step that fails after a successful tool step surfaces the provider reason, not 'unknown error'", async () => {
    fake.history = () => [...prompted, started("a1"), ended("a1", "tool-calls"), started("a2"), failed("a2", ENDPOINT_UNAVAILABLE)];
    const failure = await failureOf(() => invokeOpenCode(hi));
    expect(failure.info.providerMessage).toContain("Endpoint is unavailable");
    expect(failure.message).not.toMatch(/unknown error/);
  });

  it("a completed message with finish=error carries its error through", async () => {
    fake.history = () => [...prompted, started("a1"), ended("a1", "error")];
    fake.messages = {
      a1: { time: { completed: 2 }, content: [], finish: "error", error: { type: "unknown", message: "Provider request failed with HTTP 429: rate limit reached" } },
    };
    const failure = await failureOf(() => invokeOpenCode(hi));
    expect(failure.info).toMatchObject({ kind: "rate-limit", status: 429, layer: "opencode-upstream" });
  });

  it("an upstream 'model not found' is a dead model", async () => {
    fake.history = () => [
      ...prompted,
      started("a1"),
      failed("a1", 'Provider request failed with HTTP 404: {"error":{"message":"The model `muse-spark-1.3-contributor-free` does not exist","code":"model_not_found"}}'),
    ];
    const failure = await failureOf(() => invokeOpenCode(hi));
    expect(failure.info).toMatchObject({ kind: "model-unavailable", status: 404 });
    expect(modelHealth.stateOf(base, "muse-spark-1.3-contributor-free")).toMatchObject({ state: "unavailable" });
  });

  it("an empty final reply is typed 'empty' and says how it finished", async () => {
    fake.messages = { a1: reply("", "stop") };
    const failure = await failureOf(() => invokeOpenCode(hi));
    expect(failure.info).toMatchObject({ kind: "empty", layer: "opencode-turn", code: "stop" });
    expect(failure.info.providerMessage).toMatch(/empty reply \(finish: stop/);
  });

  it("a model the server doesn't serve is caught before a session is created (the server would hang silently)", async () => {
    fake.served = ALL_SERVED.filter((model) => model.id !== "muse-spark-1.3-contributor-free");
    const failure = await failureOf(() => invokeOpenCode(hi));
    expect(failure.info).toMatchObject({ kind: "model-unavailable", layer: "opencode-catalog", code: "model_not_served" });
    expect(failure.info.providerMessage).toContain("muse-spark-1.3-contributor-free");
    expect(fake.sessionsCreated).toEqual([]);
  });

  it("a disabled model is unavailable too", async () => {
    fake.served = ALL_SERVED.map((model) => (model.id === "muse-spark-1.3-contributor-free" ? { ...model, enabled: false } : model));
    expect((await failureOf(() => invokeOpenCode(hi))).info.kind).toBe("model-unavailable");
  });

  it("a deprecated model that the server still serves is NOT blocked", async () => {
    fake.served = ALL_SERVED.map((model) => ({ ...model, status: "deprecated" }));
    expect((await invokeOpenCode(hi)).choices[0]?.message.content).toBeTruthy();
  });

  it("an old server without /api/model is not blocked (unknown is not unavailable)", async () => {
    fake.served = null;
    expect((await invokeOpenCode(hi)).choices[0]?.message.content).toBeTruthy();
  });

  it("a prompt the server accepted but never started: idle session → 'never started', not a 20-minute wait", async () => {
    vi.stubEnv("OPENCODE_STALL_AFTER_MS", "30");
    fake.served = null;
    fake.history = () => prompted;
    const failure = await failureOf(() => invokeOpenCode(hi));
    expect(failure.info).toMatchObject({ kind: "empty", layer: "opencode-turn", code: "never_started" });
  });

  it("a turn that stops after a tool call with no reply is reported as such", async () => {
    vi.stubEnv("OPENCODE_STALL_AFTER_MS", "30");
    fake.history = () => [...prompted, started("a1"), ended("a1", "tool-calls")];
    const failure = await failureOf(() => invokeOpenCode(hi));
    expect(failure.info).toMatchObject({ kind: "empty", code: "stopped_early" });
  });

  it("a permission stall is typed 'permission' with the real request named", async () => {
    vi.stubEnv("OPENCODE_STALL_AFTER_MS", "30");
    fake.history = () => [...prompted, started("a1")];
    fake.permission = [{ permission: "external_directory", title: "Access outside the project" }];
    fake.active = ["ses_1"];
    const failure = await failureOf(() => invokeOpenCode(hi));
    expect(failure.info).toMatchObject({ kind: "permission", layer: "opencode-turn", code: "permission_pending" });
    expect(failure.info.providerMessage).toContain("Access outside the project");
  });

  it("a slow-but-running turn that outlasts the budget is typed 'timeout' (and not retried)", async () => {
    vi.stubEnv("OPENCODE_TURN_TIMEOUT_MS", "400");
    fake.history = () => [...prompted, started("a1")];
    fake.active = ["ses_1"];
    const failure = await failureOf(() => invokeOpenCode(hi));
    expect(failure.info).toMatchObject({ kind: "timeout", code: "turn_budget" });
    expect(shouldFallBack(failure, "opencode")).toBe(false);
  });

  it("wrong server password (401) is auth, naming the credentials", async () => {
    fake.password = "right";
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "wrong");
    fake.served = null;
    const failure = await failureOf(() => invokeOpenCode(hi));
    expect(failure.info).toMatchObject({ kind: "auth", status: 401, code: "UnauthorizedError", layer: "opencode-session" });
    expect(friendlyAgentError(failure)).toMatch(/OPENCODE_SERVER_PASSWORD/);
  });

  it("an unreachable server is transient with the connection error code", async () => {
    const dead = createServer();
    await new Promise<void>((resolve) => dead.listen(0, "127.0.0.1", resolve));
    const deadBase = `http://127.0.0.1:${(dead.address() as AddressInfo).port}`;
    await new Promise<void>((resolve) => dead.close(() => resolve()));
    vi.stubEnv("OPENCODE_BASE_URL", deadBase);
    const failure = await failureOf(() => invokeOpenCode(hi));
    expect(failure.info).toMatchObject({ kind: "transient", layer: "opencode-server", code: "ECONNREFUSED" });
    expect(failure.info.providerMessage).toMatch(/unreachable/);
  });

  it("no base URL and no managed server is a config problem with setup guidance", async () => {
    vi.stubEnv("OPENCODE_BASE_URL", "");
    const failure = await failureOf(() => invokeOpenCode(hi));
    expect(failure.info).toMatchObject({ layer: "opencode-config", kind: "auth", code: "not_configured" });
    expect(friendlyAgentError(failure)).toMatch(/OPENCODE_BASE_URL/);
  });

  it.each([
    [503, { message: "busy" }, "transient"],
    [429, { message: "slow down" }, "rate-limit"],
    [400, { _tag: "InvalidRequestError", message: "Invalid request body" }, "bad-request"],
    [400, { _tag: "InvalidRequestError", message: "Invalid model" }, "model-unavailable"],
  ] as const)("session create %i → %s", async (status, body, kind) => {
    fake.served = null;
    fake.createStatus = { status, body };
    const failure = await failureOf(() => invokeOpenCode(hi));
    expect(failure.info).toMatchObject({ kind, status, layer: "opencode-session" });
  });

  it("never leaks bearer tokens or API keys from a provider body", async () => {
    fake.history = () => [
      ...prompted,
      started("a1"),
      failed("a1", 'Provider request failed with HTTP 401: {"error":{"message":"bad key Bearer abc.def.ghi sk-abcdefghijklmnop1234"}}'),
    ];
    const failure = await failureOf(() => invokeOpenCode(hi));
    expect(JSON.stringify(failure.info)).not.toMatch(/sk-abcdefghijklmnop|Bearer abc/);
    expect(failure.info.kind).toBe("auth");
  });
});

describe("model labelling: the catalog tells the truth", () => {
  it("every curated model is offered when the server serves them all", async () => {
    const models = await listOpenCodeModelsLive();
    expect(models).toHaveLength(7);
    expect(models.every((model) => !model.unavailable)).toBe(true);
  });

  it("a catalog id the server doesn't serve is listed unavailable with the real reason", async () => {
    fake.served = ALL_SERVED.filter((model) => model.id !== "muse-spark-1.3-contributor-free");
    const models = await listOpenCodeModelsLive();
    const dead = models.find((model) => model.id === "opencode:muse-spark-1.3-contributor-free");
    expect(dead).toMatchObject({ unavailable: true, usageLabel: "Unavailable on this server" });
    expect(dead?.unavailableReason).toContain("doesn't serve muse-spark-1.3-contributor-free");
    expect(models.filter((model) => model.unavailable)).toHaveLength(1);
  });

  it("an unreachable or old server never hides models (unknown is not unavailable)", async () => {
    fake.served = null;
    expect((await listOpenCodeModelsLive()).some((model) => model.unavailable)).toBe(false);
  });

  it("a gateway that reports a model's endpoint down labels it (briefly), without turning the failure into a dead-model error", async () => {
    fake.history = () => [...prompted, started("a1"), failed("a1", ENDPOINT_UNAVAILABLE)];
    const failure = await failureOf(() => invokeOpenCode({ ...hi, model: "opencode:ling-3.0-flash-fin-free" }));
    expect(failure.kind).toBe("transient");
    const dead = (await listOpenCodeModelsLive()).find((model) => model.id === "opencode:ling-3.0-flash-fin-free");
    expect(dead).toMatchObject({ unavailable: true });
    expect(dead?.unavailableReason).toContain("Endpoint is unavailable");
    expect(modelHealth.stateOf(base, "ling-3.0-flash-fin-free")?.ttlMs).toBe(5 * 60_000);
  });

  it("a rejected model is labelled after its failing turn, and a later success clears it", async () => {
    fake.history = () => [
      ...prompted,
      started("a1"),
      failed("a1", 'Provider request failed with HTTP 404: {"error":{"message":"model not found","code":"model_not_found"}}'),
    ];
    await failureOf(() => invokeOpenCode(hi));
    const labelled = (await listOpenCodeModelsLive()).find((model) => model.id === hi.model);
    expect(labelled).toMatchObject({ unavailable: true });
    expect(labelled?.unavailableReason).toContain("model not found");
    fake.history = happyHistory;
    await invokeOpenCode(hi);
    expect((await listOpenCodeModelsLive()).find((model) => model.id === hi.model)?.unavailable).toBeUndefined();
  });
});

describe("router: fallback is attempted, reported and verified", () => {
  const openRouterAnswer = (text: string) => ({
    id: "or-1",
    created: 1,
    model: "openrouter/free",
    choices: [{ index: 0, message: { role: "assistant" as const, content: text }, finish_reason: "stop" as const }],
  });

  it("dead model → OpenRouter answers, flagged with the reason", async () => {
    fake.served = ALL_SERVED.filter((model) => model.id !== "muse-spark-1.3-contributor-free");
    vi.mocked(invokeOpenRouter).mockResolvedValueOnce(openRouterAnswer("Hey!"));
    const outcome = await invokeAiResilient(hi);
    expect(outcome.fellBack).toBe(true);
    expect(outcome.attemptedProviders).toEqual(["opencode", "openrouter"]);
    expect(outcome.fallbackReason).toMatch(/OpenCode/);
    expect(outcome.result.choices[0]?.message.content).toBe("Hey!");
  });

  it("upstream outage (step failed, HTTP 400 server_error) falls back", async () => {
    fake.history = () => [...prompted, started("a1"), failed("a1", ENDPOINT_UNAVAILABLE)];
    vi.mocked(invokeOpenRouter).mockResolvedValueOnce(openRouterAnswer("ok"));
    expect((await invokeAiResilient({ ...hi, model: "opencode:ling-3.0-flash-fin-free" })).fellBack).toBe(true);
  });

  it("empty reply falls back", async () => {
    fake.messages = { a1: reply("") };
    vi.mocked(invokeOpenRouter).mockResolvedValueOnce(openRouterAnswer("ok"));
    expect((await invokeAiResilient(hi)).fellBack).toBe(true);
  });

  it("permission stalls, bad credentials and timeouts are NOT silently swapped to another provider", async () => {
    vi.stubEnv("OPENCODE_STALL_AFTER_MS", "30");
    fake.history = () => [...prompted, started("a1")];
    fake.permission = [{ title: "Run `rm -rf /tmp/x`" }];
    expect((await failureOf(() => invokeAiResilient(hi))).kind).toBe("permission");
    fake.permission = [];
    fake.active = ["ses_1"];
    vi.stubEnv("OPENCODE_STALL_AFTER_MS", "60000");
    vi.stubEnv("OPENCODE_TURN_TIMEOUT_MS", "300");
    expect((await failureOf(() => invokeAiResilient(hi))).kind).toBe("timeout");
    fake.password = "right";
    fake.served = null;
    expect((await failureOf(() => invokeAiResilient(hi))).kind).toBe("auth");
    expect(invokeOpenRouter).not.toHaveBeenCalled();
  });

  it("failures are counted per model for telemetry and page after repeats", async () => {
    fake.served = ALL_SERVED.filter((model) => model.id !== "muse-spark-1.3-contributor-free");
    vi.mocked(invokeOpenRouter).mockResolvedValue(openRouterAnswer("ok"));
    for (let i = 0; i < 3; i += 1) await invokeAiResilient(hi);
    const stat = modelHealth.snapshot().find((entry) => entry.model === "opencode:muse-spark-1.3-contributor-free");
    expect(stat).toMatchObject({ provider: "opencode", failures: 3, consecutiveFailures: 3, lastKind: "model-unavailable", lastCode: "model_not_served" });
    expect(console.error).toHaveBeenCalledWith("[RookAI] model failing repeatedly", expect.objectContaining({ model: "opencode:muse-spark-1.3-contributor-free" }));
  });

  it("the streaming entry point records per-model telemetry too (it bypasses the router)", async () => {
    await invokeAiStream(hi);
    fake.messages = { a1: reply("") };
    await failureOf(() => invokeAiStream(hi));
    expect(modelHealth.snapshot().find((entry) => entry.model === "opencode:muse-spark-1.3-contributor-free")).toMatchObject({
      attempts: 2,
      failures: 1,
      lastKind: "empty",
    });
  });
});

describe("the 'hi' turn end to end (stream and non-stream)", () => {
  const input = {
    userId: "user-1", botId: "bot-1", taskId: "task-1", botName: "Scout", botRole: "researcher",
    botPurpose: "Track launches.", model: "opencode:ling-3.0-flash-fin-free", message: "hi", recentContext: [],
  };
  const outageHistory = () => [...prompted, started("a1"), failed("a1", ENDPOINT_UNAVAILABLE)];
  const runners = {
    response: () => runRookAgent(input as never),
    stream: () => runRookAgentStream(input as never, () => undefined),
  };

  describe.each(["response", "stream"] as const)("%s", (mode) => {
    const run = runners[mode];

    it("working model: plain answer", async () => {
      expect((await run()).text).toBe("Hi! What can I help you with?");
    });

    it("upstream outage + OpenRouter up: the user gets an answer and a visible note", async () => {
      fake.history = outageHistory;
      vi.mocked(invokeOpenRouter).mockResolvedValue({
        id: "or", created: 1, model: "openrouter/free",
        choices: [{ index: 0, message: { role: "assistant", content: "Hey! How can I help?" }, finish_reason: "stop" }],
      });
      const result = await run();
      expect(result.text).toBe("Hey! How can I help?");
      expect(result.trace.some((step) => step.title === "Answered with a backup model")).toBe(true);
    });

    it("upstream outage + no fallback: names OpenCode, the model and the provider's reason — never the shrug", async () => {
      vi.mocked(isOpenRouterConfigured).mockReturnValue(false);
      fake.history = outageHistory;
      const result = await run();
      expect(result.text).toContain("OpenCode");
      expect(result.text).toContain("ling-3.0-flash-fin-free");
      expect(result.text).toContain("Endpoint is unavailable");
      expect(result.text).not.toMatch(/couldn't produce a usable answer/);
    });

    it("dead model + no fallback: says the server doesn't serve it", async () => {
      vi.mocked(isOpenRouterConfigured).mockReturnValue(false);
      fake.served = ALL_SERVED.filter((model) => model.id !== "ling-3.0-flash-fin-free");
      const result = await run();
      expect(result.text).toContain("doesn't serve ling-3.0-flash-fin-free");
      expect(result.text).not.toMatch(/couldn't produce a usable answer/);
    });

    it("permission stall: tells the user what is waiting on them", async () => {
      vi.stubEnv("OPENCODE_STALL_AFTER_MS", "30");
      fake.history = () => [...prompted, started("a1")];
      fake.permission = [{ title: "Access outside the project" }];
      expect((await run()).text).toMatch(/permission decision \(Access outside the project\)/);
    });

    it("bad server password: tells the operator which setting to fix", async () => {
      fake.password = "right";
      vi.stubEnv("OPENCODE_SERVER_PASSWORD", "wrong");
      expect((await run()).text).toMatch(/OPENCODE_SERVER_PASSWORD/);
    });
  });
});

describe("friendlyAgentError: the generic line is the last resort", () => {
  it("only an untyped error reaches it", () => {
    expect(friendlyAgentError(new Error("something odd"))).toMatch(/couldn't produce a usable answer/);
    const typed = new ProviderError({ layer: "opencode-turn", provider: "opencode", kind: "unknown", providerMessage: "weird" });
    expect(friendlyAgentError(typed)).toContain("weird");
  });
});

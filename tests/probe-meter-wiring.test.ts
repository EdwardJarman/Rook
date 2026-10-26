/** The operator entry wraps the REAL router function with the spend meter. This runs that exact pattern offline. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../server/db", async () => (await import("../evals/probe/mocks")).db());
vi.mock("../server/integrations/microsoft-excel", async (original) => (await import("../evals/probe/mocks")).microsoftExcel(await original()));
vi.mock("../server/integrations/github", async (original) => (await import("../evals/probe/mocks")).github(await original()));
vi.mock("../server/integrations/cloud-computer", async (original) => (await import("../evals/probe/mocks")).cloudComputer(await original()));
vi.mock("../server/integrations/web-research", async () => (await import("../evals/probe/mocks")).webResearch());
vi.mock("../server/ai/fallback-router", async (original) => {
  const actual = await original<typeof import("../server/ai/fallback-router")>();
  const { meteredInvoke } = await import("../evals/probe/meter");
  return { ...actual, invokeAiResilient: meteredInvoke(actual.invokeAiResilient) };
});

import { __resetOpenRouterCachesForTests } from "../server/ai/openrouter";
import { runRookAgent } from "../server/integrations/excel-agent";
import { MemoryLedger, meterHolder, SpendMeter } from "../evals/probe/meter";
import { setWorld } from "../evals/probe/world";

const base = { userId: "eval-user", botId: "eval-bot", taskId: "t", botName: "Scout", botRole: "r", botPurpose: "p", model: "openrouter/free", message: "hey", recentContext: [] as [] };
let chatCalls: number;
beforeEach(() => {
  chatCalls = 0; setWorld({}); meterHolder.current = undefined;
  vi.stubEnv("OPENROUTER_API_KEY", "fixture-only"); __resetOpenRouterCachesForTests();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("/models")) return Response.json({ data: [] });
    chatCalls += 1;
    return Response.json({ id: "x", created: 1, model: "fixture/model", choices: [{ index: 0, message: { role: "assistant", content: "Hey!" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1000, completion_tokens: 20, total_tokens: 1020, prompt_tokens_details: { cached_tokens: 400 } } });
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); meterHolder.current = undefined; });

describe("the metered router wrapper around the real invokeAiResilient", () => {
  it("meters every physical model request of a turn", async () => {
    const meter = new SpendMeter({ capUsd: 5, rates: { input: 1, cachedInput: 0.1, output: 10 }, ledger: new MemoryLedger() });
    meterHolder.current = meter;
    expect((await runRookAgent(base)).text).toBe("Hey!");
    expect(chatCalls).toBe(1); expect(meter.requests()).toBe(1);
    expect(meter.spentUsd()).toBeCloseTo(((600 * 1 + 400 * 0.1 + 20 * 10) / 1_000_000) * 1.1, 12);
  });
  it("makes no provider call at all when no meter is installed", async () => {
    const result = await runRookAgent(base);
    expect(chatCalls).toBe(0); expect(result.text).not.toBe("Hey!"); expect("error" in result && Boolean(result.error)).toBe(true);
  });
  it("makes no provider call once the cap cannot cover a request", async () => {
    const meter = new SpendMeter({ capUsd: 0.01, rates: { input: 1, cachedInput: 0.1, output: 10 }, ledger: new MemoryLedger() });
    meterHolder.current = meter;
    await runRookAgent(base);
    expect(chatCalls).toBe(0); expect(meter.tripped()).toBe(true); expect(meter.spentUsd()).toBe(0);
  });
});

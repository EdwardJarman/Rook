import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetFallbackBreakerForTests,
  __tripFallbackBreakerForTests,
  fallbackCandidates,
  invokeAiResilient,
} from "../server/ai/fallback-router";
import {
  __resetTelemetryForTests,
  recentTurns,
  recordTurn,
  turnStats,
} from "../server/ai/telemetry";
import {
  buildMemoryBlock,
  extractMemoryCandidates,
  mergeMemories,
} from "../server/ai/memory";
import {
  COMPUTER_TOOLS,
  COMPUTER_TOOL_NAMES,
  executeComputerReadTool,
  parseComputerToolArguments,
} from "../server/integrations/computer-tools";
import { executeAgentTool } from "../server/integrations/agent-tool-executor";
import { isTransientAgentError } from "../server/ai/agent-reliability";

beforeEach(() => {
  __resetFallbackBreakerForTests();
  __resetTelemetryForTests();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("fallback router", () => {
  it("keeps the requested model first and never auto-targets ChatGPT", () => {
    const candidates = fallbackCandidates("openrouter/free");
    expect(candidates[0]).toBe("openrouter/free");
    expect(candidates.some((id) => id.startsWith("chatgpt:"))).toBe(false);
  });

  it("still offers the shared route as a ChatGPT fallback", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const candidates = fallbackCandidates("chatgpt:gpt-5");
    expect(candidates[0]).toBe("chatgpt:gpt-5");
    expect(candidates).toContain("openrouter/free");
  });

  it("throws auth errors immediately without failing over", async () => {
    const ai = await import("../server/ai/index");
    vi.spyOn(ai, "invokeAi").mockRejectedValueOnce(
      new Error("Rook's OpenRouter connection needs attention."),
    );
    await expect(
      invokeAiResilient({ model: "openrouter/free", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow(/needs attention/);
    expect(ai.invokeAi).toHaveBeenCalledTimes(1);
  });

  it("fails over to the next provider on transient errors", async () => {
    const ai = await import("../server/ai/index");
    const spy = vi
      .spyOn(ai, "invokeAi")
      .mockRejectedValueOnce(new Error("Free AI capacity is temporarily full."))
      .mockResolvedValueOnce({
        id: "gen-2",
        created: 1,
        model: "orcarouter:deepseek/deepseek-v4-flash-free",
        choices: [
          { index: 0, message: { role: "assistant", content: "Recovered." }, finish_reason: "stop" },
        ],
      });
    vi.stubEnv("ORCAROUTER_API_KEY", "orca-key");
    const { result, fellBack, attemptedProviders } = await invokeAiResilient({
      model: "openrouter/free",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.choices[0]?.message.content).toBe("Recovered.");
    expect(fellBack).toBe(true);
    expect(attemptedProviders).toEqual(["openrouter", "orcarouter"]);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("skips fallback providers in circuit-breaker cooldown", async () => {
    __tripFallbackBreakerForTests("orcarouter");
    const ai = await import("../server/ai/index");
    const spy = vi
      .spyOn(ai, "invokeAi")
      .mockRejectedValueOnce(new Error("Free AI capacity is temporarily full."))
      .mockResolvedValueOnce({
        id: "gen-3",
        created: 1,
        model: "tokenrouter:deepseek/deepseek-v4-pro-0813-free",
        choices: [
          { index: 0, message: { role: "assistant", content: "Via Token." }, finish_reason: "stop" },
        ],
      });
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("ORCAROUTER_API_KEY", "orca-key");
    vi.stubEnv("TOKENROUTER_API_KEY", "token-key");
    // The tripped Orca fallback is skipped; TokenRouter answers instead.
    const { result, fellBack, attemptedProviders } = await invokeAiResilient({
      model: "openrouter/free",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.choices[0]?.message.content).toBe("Via Token.");
    expect(fellBack).toBe(true);
    expect(attemptedProviders).toEqual(["openrouter", "tokenrouter"]);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("transient error classification", () => {
  it("retries wobbles but not auth/config errors", () => {
    expect(isTransientAgentError(new Error("429 rate limit"))).toBe(true);
    expect(isTransientAgentError(new Error("fetch failed"))).toBe(true);
    expect(isTransientAgentError(new Error("timed out"))).toBe(true);
    expect(isTransientAgentError(new Error("needs attention"))).toBe(false);
    expect(isTransientAgentError(new Error("not configured"))).toBe(false);
  });
});

describe("telemetry ring", () => {
  it("keeps the newest turns and summarizes shapes only", () => {
    for (let i = 0; i < 105; i += 1) {
      recordTurn({
        requestId: `r${i}`,
        at: new Date().toISOString(),
        latencyMs: i * 10,
        model: "m",
        requestedModel: "m",
        fellBack: i % 2 === 0,
        providers: ["openrouter"],
        tools: i % 3 === 0 ? ["github_read_file"] : [],
        approvals: 0,
        computerProposals: 0,
        webSearched: false,
        codeTask: false,
      });
    }
    expect(recentTurns(200)).toHaveLength(100);
    expect(recentTurns(1)[0]?.requestId).toBe("r104");
    const stats = turnStats();
    expect(stats.turns).toBe(100);
    expect(stats.topTools[0]).toMatchObject({ tool: "github_read_file" });
    expect(stats.medianLatencyMs).toBeGreaterThan(0);
  });
});

describe("bot memory", () => {
  it("extracts durable facts and preferences, never secrets", () => {
    expect(extractMemoryCandidates("remember that my standup is at 9:30")).toEqual([
      { key: "note", value: "my standup is at 9:30" },
    ]);
    expect(extractMemoryCandidates("I prefer concise bullet summaries")).toEqual([
      { key: "preference", value: "concise bullet summaries" },
    ]);
    expect(extractMemoryCandidates("my api key is abc123, look it up")).toEqual([]);
    expect(extractMemoryCandidates("what time is it?")).toEqual([]);
  });

  it("merges without duplicates and caps length", () => {
    expect(mergeMemories("No preferences saved yet.", [{ key: "note", value: "standup at 9:30" }])).toBe(
      "note: standup at 9:30",
    );
    expect(
      mergeMemories("note: standup at 9:30", [{ key: "note", value: "standup at 9:30" }]),
    ).toBeNull();
    const many = Array.from({ length: 30 }, (_, i) => ({ key: "note", value: `fact ${i}` }));
    const merged = mergeMemories("", many)!;
    expect(merged.split("\n").length).toBeLessThanOrEqual(20);
    expect(merged.length).toBeLessThanOrEqual(2000);
  });

  it("formats a prompt block only when memory exists", () => {
    expect(buildMemoryBlock(undefined)).toBe("");
    expect(buildMemoryBlock("No preferences saved yet.")).toBe("");
    expect(buildMemoryBlock("note: standup at 9:30")).toMatch(/standup at 9:30/);
  });
});

describe("computer tools", () => {
  it("advertises status + proposal tools", () => {
    expect(COMPUTER_TOOL_NAMES.has("computer_status")).toBe(true);
    expect(COMPUTER_TOOL_NAMES.has("computer_propose_task")).toBe(true);
    expect(COMPUTER_TOOLS.map((tool) => tool.function.name)).toContain("computer_propose_task");
  });

  it("rejects non-http proposal URLs", () => {
    expect(() =>
      parseComputerToolArguments("computer_propose_task", JSON.stringify({ title: "Do a thing now", url: "file:///etc/passwd" })),
    ).toThrow(/http\(s\)/);
  });

  it("reports live pairing state without secrets", async () => {
    const db = await import("../server/db");
    vi.spyOn(db, "listRookNodesForUser").mockResolvedValueOnce([
      {
        id: "1",
        nodeId: "node-1",
        userId: "u",
        name: "Desk",
        status: "online",
        version: "1",
        lastSeenAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    const state = await executeComputerReadTool("u", "computer_status", {});
    expect(state).toMatchObject({ paired: true, online: true });
    expect(JSON.stringify(state)).not.toMatch(/secret|token/i);
  });

  it("executor records proposals with a per-turn cap", async () => {
    const approvals: never[] = [];
    const proposals: Array<{ proposalId: string; title: string }> = [];
    const base = {
      userId: "u",
      botId: "b",
      taskId: "t",
      excelConnected: false,
      githubConnected: false,
      computerOnline: true,
      approvals,
      computerProposals: proposals,
    };
    const first = await executeAgentTool({
      ...base,
      name: "computer_propose_task",
      rawArgs: JSON.stringify({ title: "Open the portal and export June" }),
    });
    expect(first.traceStep.title).toMatch(/Proposed a computer task/);
    expect(proposals).toHaveLength(1);
    await executeAgentTool({
      ...base,
      name: "computer_propose_task",
      rawArgs: JSON.stringify({ title: "Second proposed task here" }),
    });
    const capped = await executeAgentTool({
      ...base,
      name: "computer_propose_task",
      rawArgs: JSON.stringify({ title: "Third proposed task here!" }),
    });
    expect(capped.resultPayload).toMatchObject({ status: "not_prepared" });
    expect(proposals).toHaveLength(2);
  });

  it("executor rejects unknown tools with available-tool guidance", async () => {
    const result = await executeAgentTool({
      userId: "u",
      botId: "b",
      taskId: "t",
      name: "browser_click",
      rawArgs: "{}",
      excelConnected: false,
      githubConnected: false,
      computerOnline: false,
      approvals: [],
      computerProposals: [],
    });
    expect(result.resultPayload).toMatchObject({ status: "error" });
    expect(String((result.resultPayload as { message: string }).message)).toMatch(/computer_status/);
  });
});

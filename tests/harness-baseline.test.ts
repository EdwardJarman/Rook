/** Actual request assembly + transport, fictional data and stubbed responses. No live services. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
vi.mock("../server/db", () => ({ listRookNodesForUser: vi.fn(async () => []) }));
vi.mock("../server/integrations/microsoft-excel", async (original) => ({ ...await original<object>(), isMicrosoftExcelConfigured: () => false }));
vi.mock("../server/integrations/github", async (original) => ({ ...await original<object>(), isGithubConfigured: () => false }));
vi.mock("../server/integrations/cloud-computer", async (original) => ({ ...await original<object>(), isCloudComputerConfigured: () => false }));
vi.mock("../server/integrations/web-research", () => ({ searchPublicWeb: async () => [
  { title: "Fixture release", url: "https://example.test/release", snippet: "Fictional release information." },
] }));
import { runRookAgent, type RookAgentInput } from "../server/integrations/excel-agent";
import { __resetOpenRouterCachesForTests } from "../server/ai/openrouter";
import { __resetTelemetryForTests, recentTurns } from "../server/ai/telemetry";

const base: RookAgentInput = { userId: "fixture-owner", botId: "fixture-bot", taskId: "fixture-task",
  botName: "Scout", botRole: "teammate", botPurpose: "Help complete the user's work.",
  model: "openrouter/free", message: "hello", recentContext: [] };
export const HARNESS_TASKS: Array<{ id: string; input: Partial<RookAgentInput>; tool?: boolean }> = [
  { id: "greeting", input: { message: "hey" } },
  { id: "ambiguous-code", input: { message: "fix it", recentContext: [
    { author: "user", body: "function add(a, b) { return a - b; } should add" },
    { author: "bot", body: "The operator subtracts." },
  ], skillIds: ["systematic-debugging"] } },
  { id: "research", input: { message: "latest Expo SDK?" } },
  { id: "computer-status", input: { message: "is my computer online?" }, tool: true },
  { id: "long-followup", input: { message: "continue migration task", recentContext: Array.from({ length: 40 }, (_, i) => ({
    author: i % 2 ? "bot" as const : "user" as const,
    body: `Continue this migration task, step ${i}. Keep plan and validation. `.repeat(30),
  })) } },
];

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_KEY", "fixture-only");
  __resetOpenRouterCachesForTests(); __resetTelemetryForTests();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("rendered harness baseline", () => {
  it("captures complete serialized requests through the real loop without billed token estimates", async () => {
    const evidence = [];
    for (const fixture of HARNESS_TASKS) {
      const requests: Record<string, unknown>[] = [];
      vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("/models")) return Response.json({ data: [] });
        expect(url).toMatch(/\/chat\/completions$/);
        requests.push(JSON.parse(String(init?.body)));
        const toolCall = fixture.tool && requests.length === 1;
        return Response.json({ id: "fixture", created: 1, model: "fixture/model", choices: [{ index: 0,
          message: { role: "assistant", content: toolCall ? "" : "Fixture answer (not a model quality result).",
            ...(toolCall ? { tool_calls: [{ id: "fixture-call", type: "function", function: { name: "computer_status", arguments: "{}" } }] } : {}) },
          finish_reason: toolCall ? "tool_calls" : "stop" }] });
      }));
      const answer = await runRookAgent({ ...base, ...fixture.input, taskId: fixture.id });
      expect(answer.text).toContain("Fixture answer");
      const measured = recentTurns(1)[0];
      expect(measured.usage?.requests).toBe(requests.length);
      expect(measured.usage?.unknown.input).toBe(requests.length);
      expect(requests).toHaveLength(fixture.tool ? 2 : 1);
      evidence.push({ id: fixture.id, agentTurns: 1, requests, measurements: measured.modelRequests,
        usedTools: answer.usedTools, taskSuccess: null, costUsd: null });
    }
    expect(evidence.find((e) => e.id === "long-followup")!.measurements![0].inputCharacters.ledger).toBeGreaterThan(0);
    expect(evidence.find((e) => e.id === "ambiguous-code")!.measurements![0].inputCharacters.skills).toBeGreaterThan(0);
    expect(evidence.find((e) => e.id === "research")!.measurements![0].inputCharacters.searchResults).toBeGreaterThan(0);
    if (process.env.ROOK_WRITE_HARNESS_BASELINE === "1") {
      const folder = path.join(process.cwd(), ".cache", "harness-evaluation");
      await mkdir(folder, { recursive: true });
      const reportName = process.env.ROOK_HARNESS_REPORT_NAME ?? "baseline.json";
      if (!/^[a-z0-9-]+\.json$/.test(reportName)) throw new Error("Use a simple JSON report filename.");
      await writeFile(path.join(folder, reportName), JSON.stringify({
        kind: "actual request assembly with fictional context and stub responses; no live token or quality measurement",
        cases: evidence,
      }, null, 2));
    }
  });
});

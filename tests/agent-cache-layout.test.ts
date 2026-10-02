import { expect, it, vi } from "vitest";
vi.mock("../server/db", () => ({ listRookNodesForUser: vi.fn(async () => []) }));
import { buildRookSystemPrompt, buildRookSystemPromptParts, type RookSystemPromptInput } from "../server/ai/system-prompt";
import { prepareAgentTurn, type RookAgentInput } from "../server/integrations/excel-agent";
import { measureRequestSources } from "../server/ai/request-accounting";

const input: RookSystemPromptInput = { botName: "Scout", botRole: "Helper", botPurpose: "Help", modelRoute: "fixture/model",
  clockLocal: "today", clockTimeZone: "UTC", clockIso: "2026-09-29", capabilities: { computer: "offline", excel: "absent", github: "absent", web: "available" }, extraContext: "A skill and memory" };
it("keeps system bytes identical when clock, capabilities and injected context change", () => {
  const before = buildRookSystemPromptParts(input);
  const after = buildRookSystemPromptParts({ ...input, clockIso: "2026-09-30", clockLocal: "tomorrow", capabilities: { ...input.capabilities, computer: "online" }, extraContext: "Changed skill and memory" });
  expect(after.stable).toBe(before.stable); expect(after.setup).not.toBe(before.setup);
  expect(before.stable).not.toContain("2026-09-29"); expect(before.setup).toContain("A skill and memory");
  expect(buildRookSystemPrompt(input)).toBe(`${before.stable}\n\n${before.setup}`);
});
it("assembles stable instructions, live user setup, history, then the actual request", async () => {
  const turnInput: RookAgentInput = { userId: "fixture", botId: "bot", taskId: "task", botName: "Scout", botRole: "Helper", botPurpose: "Help", message: "hello", recentContext: [{ author: "user", body: "hello earlier" }] };
  const a = await prepareAgentTurn(turnInput, "a"); const b = await prepareAgentTurn({ ...turnInput, message: "hi" }, "b");
  expect(a.messages[0]).toEqual(b.messages[0]);
  expect(a.messages[0].role).toBe("system"); expect(a.messages[0].content).not.toContain("## Live context");
  expect(a.messages[1].role).toBe("user"); expect(a.messages[1].content).toContain("## Live context");
  expect(a.messages.at(-1)).toEqual({ role: "user", content: "hello" });
  expect(JSON.stringify(a.tools)).toBe(JSON.stringify(b.tools));
});
it("attributes setup and nested sections without double counting or matching ordinary conversation", () => {
  const setup = "clock and memory";
  const payload = { messages: [{ role: "system", content: "stable" }, { role: "user", content: setup }, { role: "user", content: "memory" }] };
  const measured = measureRequestSources(payload, [{ source: "setup", text: setup }, { source: "memory", text: "memory" }]);
  expect(measured.memory).toBe(6); expect(measured.setup).toBeGreaterThan(0); expect(measured.user).toBeGreaterThan(6);
  expect(Object.values(measured).reduce((sum, n) => sum + n, 0)).toBe(JSON.stringify(payload).length);
});

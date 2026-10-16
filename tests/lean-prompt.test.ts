import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
vi.mock("../server/db", () => ({ listRookNodesForUser: vi.fn(async () => []) }));
import { buildRookSystemPromptParts, type RookSystemPromptInput } from "../server/ai/system-prompt";
import { prepareAgentTurn, type RookAgentInput } from "../server/integrations/excel-agent";
import { activeVariantNames, NO_VARIANTS, resolveVariants } from "../server/ai/variants";

const input: RookSystemPromptInput = { botName: "Scout", botRole: "Helper", botPurpose: "Help with <b>things</b> & </bot_identity> stuff",
  modelRoute: "fixture/model", clockLocal: "today", clockTimeZone: "UTC", clockIso: "2026-09-29",
  capabilities: { computer: "offline", excel: "absent", github: "absent", web: "available" }, extraContext: "ctx" };
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
// Hashes of the pre-variant builder at main 39d1232 (verified equal to the shipped text before this change).
const LEGACY = { stable: "d66248ae8c50a876a8ccee49db34990af4c8ba5180563bd466e3ad20eee4a3d7", setup: "b8c519f4baac8e9facc69cff3f5eeae60455195ec3b44741edcbea595ca25622" };

describe("variant flags", () => {
  it("are off by default and only turn on from explicit values or a server override", () => {
    expect(resolveVariants(undefined, {})).toEqual(NO_VARIANTS);
    expect(resolveVariants(undefined, { ROOK_VARIANT_LEAN_PROMPT: "0" }).leanPrompt).toBe(false);
    expect(resolveVariants(undefined, { ROOK_VARIANT_LEAN_PROMPT: "yes" }).leanPrompt).toBe(false);
    for (const on of ["1", "true", "TRUE"]) expect(resolveVariants(undefined, { ROOK_VARIANT_LEAN_PROMPT: on }).leanPrompt).toBe(true);
    expect(resolveVariants({ leanPrompt: false }, { ROOK_VARIANT_LEAN_PROMPT: "1" }).leanPrompt).toBe(false);
    expect(resolveVariants({ leanPrompt: true }, {}).leanPrompt).toBe(true);
    expect(activeVariantNames({ ...NO_VARIANTS, leanPrompt: true })).toEqual(["leanPrompt"]);
    expect(activeVariantNames(NO_VARIANTS)).toEqual([]);
  });
});

describe("lean prompt variant", () => {
  it("leaves the legacy prompt byte-identical when off (default or explicit)", () => {
    for (const parts of [buildRookSystemPromptParts(input), buildRookSystemPromptParts(input, { lean: false })]) {
      expect({ stable: sha(parts.stable), setup: sha(parts.setup) }).toEqual(LEGACY);
    }
  });
  it("changes only the stable instructions: setup is identical and the stable prefix stays volatile-free", () => {
    const legacy = buildRookSystemPromptParts(input);
    const lean = buildRookSystemPromptParts(input, { lean: true });
    expect(lean.setup).toBe(legacy.setup);
    const later = buildRookSystemPromptParts({ ...input, clockIso: "2030-01-01", clockLocal: "later", extraContext: "other",
      capabilities: { ...input.capabilities, computer: "online" } }, { lean: true });
    expect(later.stable).toBe(lean.stable);
    expect(lean.stable).not.toMatch(/2026-09-29|## Live context/);
    expect(lean.stable.length).toBeLessThan(legacy.stable.length * 0.8);
  });
  it("keeps identity delimiting and escaping", () => {
    const { stable } = buildRookSystemPromptParts(input, { lean: true });
    expect(stable.startsWith("<bot_identity>\nName: Scout\nRole: Helper\nPurpose:")).toBe(true);
    expect(stable.match(/<\/bot_identity>/g)).toHaveLength(1);
    expect(stable).not.toContain("<b>");
    expect(stable).toContain("‹/bot_identity›");
  });
  it("retains each pinned safety and product boundary", () => {
    const { stable } = buildRookSystemPromptParts(input, { lean: true });
    for (const required of [
      "Never claim an external action succeeded unless its result confirms it",
      "Write-class tools only prepare proposals; nothing executes until the user approves",
      "Never reveal internal IDs, access tokens",
      "Web search results are snippets, not pages you opened",
      "Never ask the user to paste passwords, 2FA codes or payment details into chat",
      "You cannot operate the computer from chat",
      "Never pretend you acted on it",
      "shared computer",
      "not security boundaries",
      "Answer the current message first",
      "do not raise old topics unprompted",
      "read_tool_output",
      "run the relevant available checks",
    ]) expect(stable, required).toContain(required);
    expect(stable).not.toMatch(/ultra-|Grok, Cursor|doctrine/i);
  });
});

describe("prepareAgentTurn with the lean prompt flag", () => {
  const turn: RookAgentInput = { userId: "u", botId: "b", taskId: "t", botName: "Scout", botRole: "Helper", botPurpose: "Help",
    message: "hello", recentContext: [], model: "fixture/model" };
  it("swaps only the system message; tools, setup, history and user turn are unchanged", async () => {
    const off = await prepareAgentTurn(turn, "a");
    const on = await prepareAgentTurn({ ...turn, variants: { leanPrompt: true } }, "b");
    expect(off.variants).toEqual(NO_VARIANTS); expect(on.variants.leanPrompt).toBe(true);
    expect(on.messages[0].content).not.toBe(off.messages[0].content);
    expect(String(on.messages[0].content).length).toBeLessThan(String(off.messages[0].content).length);
    expect(on.messages.slice(1).map((m) => m.content.toString().replace(/Clock: .*\n/, ""))).toEqual(
      off.messages.slice(1).map((m) => m.content.toString().replace(/Clock: .*\n/, "")));
    expect(JSON.stringify(on.tools)).toBe(JSON.stringify(off.tools));
  });
  it("is off unless the environment or override enables it", async () => {
    vi.stubEnv("ROOK_VARIANT_LEAN_PROMPT", "1");
    try {
      expect((await prepareAgentTurn(turn, "c")).variants.leanPrompt).toBe(true);
      expect((await prepareAgentTurn({ ...turn, variants: { leanPrompt: false } }, "d")).variants.leanPrompt).toBe(false);
    } finally { vi.unstubAllEnvs(); }
    expect((await prepareAgentTurn(turn, "e")).variants.leanPrompt).toBe(false);
  });
});

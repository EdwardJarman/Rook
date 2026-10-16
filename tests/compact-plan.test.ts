import { afterAll, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const outputDir = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const made = require("node:fs").mkdtempSync(require("node:path").join(require("node:os").tmpdir(), "rook-compact-"));
  process.env.ROOK_TOOL_OUTPUT_DIR = made;
  return made as string;
});
vi.mock("../server/db", () => ({ listRookNodesForUser: vi.fn(async () => []) }));

import { prepareAgentTurn, type RookAgentInput } from "../server/integrations/excel-agent";
import { buildPlanLedger, PLAN_HISTORY_BUDGET_TOKENS } from "../server/ai/compaction";
import { executeAgentTool } from "../server/integrations/agent-tool-executor";
import { NO_VARIANTS, resolveVariants } from "../server/ai/variants";
import { MAX_HISTORY_FOR_TEST } from "./compact-plan.fixture";

afterAll(async () => {
  if (path.dirname(outputDir) !== path.resolve(os.tmpdir()) || !path.basename(outputDir).startsWith("rook-compact-")) return;
  await fs.rm(outputDir, { recursive: true, force: true });
});

// The chat routes accept at most 8 context entries of 2,000 characters.
const apiMax = MAX_HISTORY_FOR_TEST.map((body, i) => ({ author: (i % 2 ? "bot" : "user") as "bot" | "user", body }));
const turn: RookAgentInput = { userId: "alice", botId: "bot-a", taskId: "t", botName: "Scout", botRole: "Helper", botPurpose: "Help",
  message: "continue the billing migration schema", recentContext: apiMax, model: "fixture/model" };
const setupOf = (prepared: Awaited<ReturnType<typeof prepareAgentTurn>>) => String(prepared.messages[1].content);
const historyChars = (prepared: Awaited<ReturnType<typeof prepareAgentTurn>>) =>
  prepared.messages.slice(2, -1).reduce((sum, m) => sum + String(m.content).length, 0);
const read = (reference: string, who = { userId: "alice", botId: "bot-a" }, disallowedTools?: string[]) =>
  executeAgentTool({ ...who, taskId: "t", name: "read_tool_output", rawArgs: JSON.stringify({ reference, search: "MIGRATE-GOAL", limit: 12 }), disallowedTools,
    excelConnected: false, githubConnected: false, computerOnline: false, approvals: [], computerProposals: [] });

describe("plan ledger", () => {
  const entries = [
    { author: "user" as const, body: "Please MIGRATE-GOAL the billing service to the new schema" },
    { author: "bot" as const, body: "Sure. I'll start with the invoices table and next the ledger." },
    { author: "bot" as const, body: "Here is a long unrelated explanation of indexes." },
    { author: "user" as const, body: "Also keep the audit log intact" },
  ];
  it("keeps the goal, recent asks and bot commitments, honestly labelled, with the pointer", () => {
    const ledger = buildPlanLedger(entries, "rook-output:" + "a".repeat(32));
    expect(ledger).toContain("condensed so this turn fits");
    expect(ledger).toContain("MIGRATE-GOAL"); expect(ledger).toContain("audit log intact");
    expect(ledger).toContain("I'll start with the invoices table");
    expect(ledger).not.toContain("unrelated explanation");
    expect(ledger).toContain("rook-output:" + "a".repeat(32)); expect(ledger).toContain("read_tool_output");
  });
  it("is empty with nothing dropped, bounded, and works without a pointer", () => {
    expect(buildPlanLedger([])).toBe("");
    const many = Array.from({ length: 60 }, (_, i) => ({ author: "user" as const, body: `ask ${i} ` + "x".repeat(400) }));
    const ledger = buildPlanLedger(many, "rook-output:" + "b".repeat(32));
    expect(ledger.length).toBeLessThanOrEqual(1600); expect(ledger).toContain("rook-output:"); expect(ledger).toContain("ask 0 ");
    expect(buildPlanLedger(entries)).not.toContain("rook-output");
  });
});

describe("compaction variant through prepareAgentTurn", () => {
  it("off: the largest history the API accepts never overflows the 6,000-token budget, so no ledger exists to engage", async () => {
    const off = await prepareAgentTurn(turn, "a");
    expect(setupOf(off)).not.toContain("condensed"); expect(historyChars(off)).toBeGreaterThan(15_000);
    expect(off.variants).toEqual(NO_VARIANTS);
  });
  it("on: older turns leave the request; goal and pointer arrive in setup; history shrinks", async () => {
    const off = await prepareAgentTurn(turn, "a");
    const on = await prepareAgentTurn({ ...turn, variants: { compactPlan: true } }, "b");
    expect(on.variants.compactPlan).toBe(true);
    const kept = on.messages.length - 3;
    expect(kept).toBeLessThan(apiMax.length); expect(kept).toBeGreaterThanOrEqual(1);
    expect(historyChars(on)).toBeLessThan(historyChars(off) * 0.5);
    expect(setupOf(on)).toContain("MIGRATE-GOAL"); expect(setupOf(on)).toMatch(/rook-output:[a-f0-9]{32}/);
    console.info(`[compact] API-max history ${historyChars(off)} chars -> ${historyChars(on)} verbatim (+${setupOf(on).length - setupOf(off).length} setup chars), ${apiMax.length - kept} turns condensed`);
    expect(PLAN_HISTORY_BUDGET_TOKENS).toBe(1500);
  });
  it("retrieval returns the transcript to the same owner and Bot only, and fails closed when the reader is denied", async () => {
    const on = await prepareAgentTurn({ ...turn, variants: { compactPlan: true } }, "c");
    const reference = /rook-output:[a-f0-9]{32}/.exec(setupOf(on))![0];
    expect((await read(reference)).resultPayload).toMatchObject({ status: "completed", result: { text: "MIGRATE-GOAL" } });
    for (const who of [{ userId: "bob", botId: "bot-a" }, { userId: "alice", botId: "bot-b" }]) {
      expect((await read(reference, who)).resultPayload).toMatchObject({ status: "error", code: "OUTPUT_UNAVAILABLE" });
    }
    expect((await read(reference, undefined, ["read_tool_output"])).resultPayload).toMatchObject({ code: "POLICY_DENIED" });
    const before = (await fs.readdir(outputDir)).length;
    const denied = await prepareAgentTurn({ ...turn, variants: { compactPlan: true }, disallowedTools: ["read_tool_output"] }, "d");
    expect(setupOf(denied)).not.toContain("rook-output:"); expect(setupOf(denied)).toContain("MIGRATE-GOAL");
    expect((await fs.readdir(outputDir)).length).toBe(before);
  });
  it("keeps credentials out of the retained transcript", async () => {
    const secret = [{ author: "user" as const, body: "password: hunter2 and Bearer abcdef123456" }, ...apiMax];
    await prepareAgentTurn({ ...turn, recentContext: secret.slice(0, 8), variants: { compactPlan: true } }, "e");
    const files = await fs.readdir(outputDir);
    const disk = (await Promise.all(files.map((f) => fs.readFile(path.join(outputDir, f), "utf8")))).join("\n");
    expect(disk).not.toMatch(/hunter2|abcdef123456/);
  });
  it("resolves from env", () => {
    expect(resolveVariants(undefined, { ROOK_VARIANT_COMPACT_PLAN: "1" }).compactPlan).toBe(true);
    expect(resolveVariants(undefined, {}).compactPlan).toBe(false);
  });
});

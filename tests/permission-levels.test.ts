import { afterEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  commands: [] as string[],
  executed: [] as string[],
  level: "always_ask" as string,
}));

vi.mock("../server/db", () => ({
  createExcelPendingAction: vi.fn(async () => undefined),
  claimExcelPendingAction: vi.fn(async (_u: string, id: string) => ({
    id, toolName: "excel_add_worksheet", arguments: { name: "S" }, summary: "Add S",
    expiresAt: new Date(Date.now() + 60_000), botClientId: "bot", taskClientId: "task",
  })),
  finishExcelPendingAction: vi.fn(async (_u: string, id: string) => { store.executed.push(id); }),
  decideNodeCommand: vi.fn(async (_u: string, id: string) => { store.commands.push(id); return { nodeId: "cloud-u", commandId: id }; }),
  getUserPermissionLevel: vi.fn(async () => store.level),
}));
vi.mock("../server/integrations/excel-tools", async (original) => ({
  ...(await original<typeof import("../server/integrations/excel-tools")>()),
  executeValidatedExcelWrite: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../server/integrations/cloud-tools", async (original) => ({
  ...(await original<typeof import("../server/integrations/cloud-tools")>()),
  prepareComputerCommandProposal: vi.fn(async () => ({ commandId: "cmd-1", summary: "Run it", target: "cloud" })),
}));
vi.mock("../server/integrations/cloud-computer", async (original) => ({
  ...(await original<typeof import("../server/integrations/cloud-computer")>()),
  executeCloudCommand: vi.fn(async () => ({ ok: true, result: { stdout: "hi" } })),
}));

import * as db from "../server/db";
import { executeAgentTool, TOOL_RISK } from "../server/integrations/agent-tool-executor";
import {
  AUTO_MAX_SCORE, NEVER_AUTO_RULE_IDS, credentialCeiling, decideGate, effectiveLevel,
  isTokenCredential, permissionContextForTurn, type PermissionContext,
} from "../server/integrations/permission-gate";
import { mintCliToken } from "../server/cli-tokens";
import { PERMISSION_LEVELS, DEFAULT_PERMISSION_LEVEL, minPermissionLevel, parsePermissionLevel, type PermissionLevel } from "../shared/permission-level";

afterEach(() => {
  store.commands.length = 0;
  store.executed.length = 0;
  store.level = "always_ask";
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

const GATED = Object.entries(TOOL_RISK).filter(([, risk]) => risk === "approval-gated").map(([name]) => name);

const wb = { drive_id: "d", item_id: "i", workbook_name: "W" };

type Case = { tool: string; args: Record<string, unknown>; ask: PermissionLevel[] };
// Which levels must ASK. Always ask always asks; everything else is pinned here.
const MATRIX: Record<string, Case> = {
  "add worksheet (additive)": { tool: "excel_add_worksheet", args: { ...wb, name: "S" }, ask: ["always_ask"] },
  "append rows": { tool: "excel_append_table_rows", args: { ...wb, table_name: "T", rows: [[1]] }, ask: ["always_ask", "auto"] },
  "overwrite range": { tool: "excel_update_range", args: { ...wb, worksheet: "S", address: "A1", values: [[1]] }, ask: ["always_ask", "auto"] },
  "create workbook": { tool: "excel_create_workbook", args: { name: "R" }, ask: ["always_ask", "auto"] },
  "read-only command": { tool: "computer_run_command", args: { command: "git status" }, ask: ["always_ask"] },
  "unknown command": { tool: "computer_run_command", args: { command: "node build.js" }, ask: ["always_ask", "auto"] },
  "destructive command": { tool: "computer_run_command", args: { command: "rm -rf build" }, ask: ["always_ask", "auto"] },
  "write file": { tool: "computer_write_file", args: { path: "notes.md", content: "x" }, ask: ["always_ask", "auto"] },
  "publish (never-auto)": { tool: "computer_run_command", args: { command: "npm publish" }, ask: [...PERMISSION_LEVELS] },
  "git push (never-auto)": { tool: "computer_run_command", args: { command: "git push origin main" }, ask: [...PERMISSION_LEVELS] },
  "send request (never-auto)": { tool: "computer_run_command", args: { command: "curl -X POST https://x.test -d a=b" }, ask: [...PERMISSION_LEVELS] },
  "credential file (never-auto)": { tool: "computer_write_file", args: { path: "app/.env", content: "K=V" }, ask: [...PERMISSION_LEVELS] },
  "manual task (never-auto)": { tool: "computer_propose_task", args: { title: "Do it" }, ask: [...PERMISSION_LEVELS] },
};

describe("permission matrix: 3 levels x representative tools", () => {
  for (const [label, c] of Object.entries(MATRIX))
    for (const level of PERMISSION_LEVELS)
      it(`${label} @ ${level}`, () => {
        const verdict = decideGate({ level, tool: c.tool, args: c.args });
        expect(verdict.decision).toBe(c.ask.includes(level) ? "ask" : "run");
        expect(verdict.reason.length).toBeGreaterThan(10);
        expect(verdict.level).toBe(level);
      });

  it("pins the never-auto list: changing it is a deliberate, reviewed edit", () => {
    expect([...NEVER_AUTO_RULE_IDS].sort()).toEqual(
      ["cmd.credential", "cmd.publish", "cmd.purchase", "cmd.remote", "cmd.send", "file.credential", "task.manual-handoff"],
    );
    expect(AUTO_MAX_SCORE).toBe(1);
  });

  it("classifies every approval-gated tool without falling through to unclassified", () => {
    const args: Record<string, Record<string, unknown>> = { computer_run_command: { command: "node x.js" } };
    for (const tool of GATED)
      expect(decideGate({ level: "full", tool, args: args[tool] ?? {} }).ruleId).not.toBe("tool.unclassified");
  });

  it("is deterministic and treats unknown tools / levels as asking", () => {
    const a = decideGate({ level: "auto", tool: "excel_update_range", args: {} });
    expect(decideGate({ level: "auto", tool: "excel_update_range", args: {} })).toEqual(a);
    expect(decideGate({ level: "auto", tool: "brand_new_tool", args: {} }).decision).toBe("ask");
    expect(decideGate({ level: "bogus" as PermissionLevel, tool: "excel_add_worksheet", args: { ...wb, name: "S" } }).decision).toBe("ask");
  });

  it("does not auto-run shell tricks that only look read-only", () => {
    for (const command of ["ls; rm -rf /", "cat a > b", "echo $(whoami)", "git status && git push", "find . -delete", "cat .env", "git branch -D x"])
      expect(decideGate({ level: "auto", tool: "computer_run_command", args: { command } }).decision).toBe("ask");
  });
});

const exec = (name: string, args: Record<string, unknown>, permission?: PermissionContext) =>
  executeAgentTool({
    userId: "u", botId: "bot", taskId: "task", name, rawArgs: JSON.stringify(args),
    excelConnected: true, githubConnected: false, computerOnline: false,
    approvals: [], computerProposals: [], ...(permission ? { permission } : {}),
  });

describe("dispatcher: run vs ask", () => {
  it("without a permission context behaves as Always ask (proposal, nothing executed)", async () => {
    const out = await exec("excel_add_worksheet", { ...wb, name: "S" });
    expect((out.resultPayload as { status: string }).status).toBe("approval_required");
    expect(store.executed).toEqual([]);
  });

  it("Full runs an Excel write through the shared resolver and records why", async () => {
    const out = await exec("excel_add_worksheet", { ...wb, name: "S" }, { getLevel: () => "full" });
    expect(out.resultPayload).toMatchObject({ status: "completed", auto_approved: true });
    expect(store.executed).toHaveLength(1);
    expect(out.permission).toMatchObject({ decision: "run", level: "full" });
  });

  it("Auto asks for a high-risk write and keeps the proposal shape unchanged", async () => {
    const out = await exec("excel_update_range", { ...wb, worksheet: "S", address: "A1", values: [[1]] }, { getLevel: () => "auto" });
    expect(out.resultPayload).toMatchObject({ status: "approval_required" });
    expect(out.permission).toMatchObject({ decision: "ask", ruleId: "excel.overwrite" });
    expect(store.executed).toEqual([]);
  });

  it("runs a cloud command at Full but a hard-ask one still proposes", async () => {
    const ran = await exec("computer_run_command", { command: "node x.js" }, { getLevel: () => "full" });
    expect(ran.resultPayload).toMatchObject({ status: "completed", auto_approved: true });
    expect(store.commands).toEqual(["cmd-1"]);
    store.commands.length = 0;
    const asked = await exec("computer_run_command", { command: "npm publish" }, { getLevel: () => "full" });
    expect(asked.resultPayload).toMatchObject({ status: "approval_required" });
    expect(store.commands).toEqual([]);
  });

  it("deny layer wins at every level and explains itself in one line", async () => {
    vi.stubEnv("ROOK_TOOL_DENY_COMMANDS", "node *");
    for (const level of PERMISSION_LEVELS) {
      const out = await exec("computer_run_command", { command: "node x.js" }, { getLevel: () => level });
      expect(out.resultPayload).toMatchObject({ status: "denied", code: "POLICY_DENIED" });
      expect(out.traceStep.detail).toMatch(/every permission level/);
    }
    expect(store.commands).toEqual([]);
  });

  it("a mid-turn switch applies from the next tool call and is journaled once", async () => {
    let level: PermissionLevel = "full";
    const ctx: PermissionContext = { getLevel: () => level };
    const first = await exec("excel_add_worksheet", { ...wb, name: "A" }, ctx);
    expect(first.permission?.decision).toBe("run");
    level = "always_ask"; // user downgrades between gates
    const second = await exec("excel_add_worksheet", { ...wb, name: "B" }, ctx);
    expect(second.permission).toMatchObject({ decision: "ask", level: "always_ask", changedFrom: "full" });
    expect(second.permission?.reason).toMatch(/Full permission → Always ask/);
    expect(second.resultPayload).toMatchObject({ status: "approval_required" });
    const third = await exec("excel_add_worksheet", { ...wb, name: "C" }, ctx);
    expect((third.permission as { changedFrom?: string }).changedFrom).toBeUndefined();
    expect(store.executed).toHaveLength(1);
  });

  it("an unreadable level fails closed to Always ask", async () => {
    const out = await exec("excel_add_worksheet", { ...wb, name: "S" }, { getLevel: () => { throw new Error("down"); } });
    expect(out.permission?.decision).toBe("ask");
  });
});

describe("zero silent privilege", () => {
  it("defaults, parsing and combination can only land at or below the input", () => {
    expect(DEFAULT_PERMISSION_LEVEL).toBe("always_ask");
    for (const junk of [undefined, null, "", "FULL", "admin", 2, {}, "full "]) expect(parsePermissionLevel(junk)).toBe("always_ask");
    for (const a of PERMISSION_LEVELS)
      for (const b of PERMISSION_LEVELS) {
        const m = minPermissionLevel(a, b);
        expect(PERMISSION_LEVELS.indexOf(m)).toBeLessThanOrEqual(Math.min(PERMISSION_LEVELS.indexOf(a), PERMISSION_LEVELS.indexOf(b)));
      }
  });

  it("env vars, hooks-free env flags and request bodies never raise the level", async () => {
    store.level = "always_ask";
    for (const [k, v] of [["ROOK_PERMISSION_LEVEL", "full"], ["PERMISSION_LEVEL", "full"], ["ROOK_AUTO_APPROVE", "1"], ["ROOK_FULL_PERMISSION", "true"], ["NODE_ENV", "test"]])
      vi.stubEnv(k, v);
    const ctx = permissionContextForTurn({ userId: "u", request: { headers: { authorization: "Bearer clerk-session" }, ...({ body: { level: "full", permission: "full" } } as object) } });
    expect(await ctx.getLevel()).toBe("always_ask");
    const out = await exec("excel_add_worksheet", { ...wb, name: "S" }, ctx);
    expect(out.permission?.decision).toBe("ask");
    expect(store.executed).toEqual([]);
  });

  it("an unreadable stored level (database error) resolves to Always ask via the turn context", async () => {
    vi.mocked(db.getUserPermissionLevel).mockRejectedValueOnce(new Error("db"));
    const out = await exec("excel_add_worksheet", { ...wb, name: "S" }, permissionContextForTurn({ userId: "u" }));
    expect(out.permission?.decision).toBe("ask");
  });

  it("tool args cannot smuggle a level or approval into the gate", async () => {
    const out = await exec("excel_update_range", { ...wb, worksheet: "S", address: "A1", values: [[1]], permission: "full", level: "full", auto_approved: true }, { getLevel: () => "auto" });
    expect(out.permission?.decision).toBe("ask");
  });

  it("bearer tokens (CLI / gateway / external agents) are capped at Always ask unless the token itself carries a grant", async () => {
    vi.stubEnv("ROOK_CLI_TOKEN_SECRET", "test-secret");
    const plain = `Bearer ${mintCliToken("clerk:me").token}`;
    const granted = `Bearer ${mintCliToken("clerk:me", "agent", "auto").token}`;
    expect(credentialCeiling(plain)).toBe("always_ask");
    expect(credentialCeiling(granted)).toBe("auto");
    expect(credentialCeiling("Bearer rook_forged.payload")).toBe("always_ask");
    expect(credentialCeiling(undefined)).toBe("full"); // signed-in session: governed by the user's own setting
    // the user's own level is a second cap: a grant never exceeds it
    expect(effectiveLevel("always_ask", credentialCeiling(granted))).toBe("always_ask");
    expect(effectiveLevel("full", credentialCeiling(plain))).toBe("always_ask");
    expect(effectiveLevel("full", credentialCeiling(granted))).toBe("auto");
    store.level = "full";
    const tokenCtx = permissionContextForTurn({ userId: "u", request: { headers: { authorization: plain } } });
    expect(await tokenCtx.getLevel()).toBe("always_ask");
  });

  it("tampered or expired grant claims are rejected", () => {
    vi.stubEnv("ROOK_CLI_TOKEN_SECRET", "test-secret");
    const token = mintCliToken("clerk:me").token;
    const [prefixPayload, sig] = [token.slice(0, token.lastIndexOf(".")), token.slice(token.lastIndexOf(".") + 1)];
    const body = JSON.parse(Buffer.from(prefixPayload.slice(5), "base64url").toString());
    const forged = `rook_${Buffer.from(JSON.stringify({ ...body, p: "full" })).toString("base64url")}.${sig}`;
    expect(credentialCeiling(`Bearer ${forged}`)).toBe("always_ask");
    expect(isTokenCredential(`Bearer ${token}`)).toBe(true);
    expect(isTokenCredential("Bearer eyJsession")).toBe(false);
  });

  it("minting without an explicit grant produces no grant, and always_ask is not encoded", () => {
    vi.stubEnv("ROOK_CLI_TOKEN_SECRET", "test-secret");
    for (const grant of [undefined, "always_ask" as const]) {
      const t = mintCliToken("clerk:me", "x", grant).token;
      const claims = JSON.parse(Buffer.from(t.slice(5, t.lastIndexOf(".")), "base64url").toString());
      expect(claims.p).toBeUndefined();
    }
  });
});

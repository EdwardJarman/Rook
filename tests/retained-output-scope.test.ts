import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const outputDir = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const made = require("node:fs").mkdtempSync(require("node:path").join(require("node:os").tmpdir(), "rook-scope-test-"));
  process.env.ROOK_TOOL_OUTPUT_DIR = made;
  return made as string;
});
const status = vi.hoisted(() => ({
  github: { connected: true, selectedRepos: [{ fullName: "Acme/Repo" }] as Array<{ fullName: string }> },
  excel: { connected: true, accounts: [{ accountId: "acct-1", status: "connected" }] },
  computer: { kind: "local" },
  fail: false,
}));
vi.mock("../server/db", () => ({ listRookNodesForUser: vi.fn(async () => []) }));
vi.mock("../server/integrations/github", async (original) => ({ ...await original<object>(),
  githubConnectionStatus: async () => { if (status.fail) throw new Error("down"); return status.github; } }));
vi.mock("../server/integrations/microsoft-excel", async (original) => ({ ...await original<object>(),
  microsoftConnectionStatus: async () => status.excel }));
vi.mock("../server/integrations/cloud-computer", async (original) => ({ ...await original<object>(),
  resolveComputerTarget: async () => status.computer }));

import { executeAgentTool } from "../server/integrations/agent-tool-executor";
import { retainedOutputAuthorizer, retainedOutputResource } from "../server/integrations/retained-output-scope";
import { formatToolOutput } from "../server/ai/tool-output";

const alice = { userId: "alice", botId: "bot-a" };
const big = { status: "completed", result: "x".repeat(20_000) + "NEEDLE" };
const retain = async (name: string, resource?: string, who = alice) =>
  (JSON.parse(await formatToolOutput({ ...who, name, value: big, resource })) as { reference: string }).reference;
const read = (reference: string, who: typeof alice & { disallowedTools?: string[] } = alice) =>
  executeAgentTool({ ...who, taskId: "t", name: "read_tool_output", rawArgs: JSON.stringify({ reference, search: "NEEDLE", limit: 6 }),
    excelConnected: true, githubConnected: true, computerOnline: true, approvals: [], computerProposals: [] });
const payload = (r: Awaited<ReturnType<typeof read>>) => r.resultPayload as { status: string; code?: string; result?: { text: string } };

beforeEach(() => {
  status.github = { connected: true, selectedRepos: [{ fullName: "Acme/Repo" }] };
  status.excel = { connected: true, accounts: [{ accountId: "acct-1", status: "connected" }] };
  status.computer = { kind: "local" }; status.fail = false;
});
afterAll(async () => {
  if (path.dirname(outputDir) !== path.resolve(os.tmpdir()) || !path.basename(outputDir).startsWith("rook-scope-test-")) return;
  await fs.rm(outputDir, { recursive: true, force: true });
});

describe("retained output retrieval scope (dispatcher)", () => {
  it("returns the owner's output while its GitHub repo remains selected", async () => {
    const ref = await retain("github_read_file", retainedOutputResource("github_read_file", '{"repo":"Acme/Repo","path":"a"}'));
    expect(payload(await read(ref))).toMatchObject({ status: "completed", result: { text: "NEEDLE" } });
  });
  it("denies after the repo is deselected, the connector is unlinked, or the status lookup fails", async () => {
    const ref = await retain("github_read_file", "acme/repo");
    status.github = { connected: true, selectedRepos: [{ fullName: "Acme/Other" }] };
    expect(payload(await read(ref))).toMatchObject({ status: "error", code: "OUTPUT_UNAVAILABLE" });
    status.github = { connected: false, selectedRepos: [{ fullName: "Acme/Repo" }] };
    expect(payload(await read(ref))).toMatchObject({ code: "OUTPUT_UNAVAILABLE" });
    status.github = { connected: true, selectedRepos: [{ fullName: "Acme/Repo" }] };
    expect(payload(await read(ref))).toMatchObject({ status: "completed" });
    status.fail = true;
    expect(payload(await read(ref))).toMatchObject({ code: "OUTPUT_UNAVAILABLE" });
  });
  it("never crosses users or Bots, with the same error as any other unavailable reference", async () => {
    const ref = await retain("github_read_file", "acme/repo");
    const other = await read(ref, { userId: "bob", botId: "bot-a" });
    const otherBot = await read(ref, { userId: "alice", botId: "bot-b" });
    const missing = await read(`rook-output:${"0".repeat(32)}`);
    for (const r of [other, otherBot, missing]) expect(payload(r)).toMatchObject({ code: "OUTPUT_UNAVAILABLE" });
    expect(payload(other)).toEqual(payload(missing));
  });
  it("denies when the Bot now disallows the source tool or the reader", async () => {
    const ref = await retain("github_read_file", "acme/repo");
    expect(payload(await read(ref, { ...alice, disallowedTools: ["github_read_file"] }))).toMatchObject({ code: "OUTPUT_UNAVAILABLE" });
    expect(payload(await read(ref, { ...alice, disallowedTools: ["read_tool_output"] }))).toMatchObject({ code: "POLICY_DENIED" });
  });
});

describe("retainedOutputAuthorizer", () => {
  const deps = {
    excelStatus: async () => status.excel, githubStatus: async () => status.github, computerTarget: async () => status.computer,
  };
  const check = (source: { tool: string; resource?: string }, disallowedTools?: string[]) =>
    retainedOutputAuthorizer({ userId: "alice", disallowedTools }, deps)(source);

  it("scopes Excel output to a still-connected account", async () => {
    expect(await check({ tool: "excel_read_range", resource: "acct-1" })).toBe(true);
    expect(await check({ tool: "excel_read_range", resource: "acct-2" })).toBe(false);
    status.excel = { connected: true, accounts: [{ accountId: "acct-1", status: "reauthorize" }] };
    expect(await check({ tool: "excel_read_range", resource: "acct-1" })).toBe(false);
    status.excel = { connected: false, accounts: [] };
    expect(await check({ tool: "excel_read_range" })).toBe(false);
  });
  it("requires a reachable computer for file reads, and allows skill text", async () => {
    expect(await check({ tool: "computer_read_file" })).toBe(true);
    status.computer = { kind: "none" };
    expect(await check({ tool: "computer_read_file" })).toBe(false);
    expect(await check({ tool: "read_skill" })).toBe(true);
  });
  it("denies unknown sources and normalizes resource names", async () => {
    expect(await check({ tool: "mystery_tool" })).toBe(false);
    expect(retainedOutputResource("github_read_file", '{"repo":" Acme/Repo "}')).toBe("acme/repo");
    expect(retainedOutputResource("computer_read_file", '{"path":"a"}')).toBeUndefined();
    expect(retainedOutputResource("github_read_file", "not json")).toBeUndefined();
  });
});

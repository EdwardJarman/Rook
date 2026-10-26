import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackgroundRuntime, type DurableTurn, type RuntimeDeps } from "./runtime";
import { MemoryJobStore } from "./store";
import type { executeAgentTool } from "../integrations/agent-tool-executor";
import type { PermissionLevel } from "../../shared/permission-level";

const bot = { id: "bot", name: "Bot", role: "Analyst", purpose: "Complete the supplied job" };
const done = { traceStep: { kind: "tool" as const, title: "Approved action completed" }, resultPayload: { status: "completed" } };

const toolInput = (name: string, rawArgs: string): Parameters<typeof executeAgentTool>[0] => ({
  userId: "owner", botId: bot.id, taskId: "task", name, rawArgs,
  excelConnected: true, githubConnected: false, computerOnline: true, approvals: [], computerProposals: [],
});

function runTool(name: string, args: Record<string, unknown>) {
  return async (_job: unknown, turn: DurableTurn) => {
    const input = toolInput(name, JSON.stringify(args));
    await turn.execute(input, async () => input.prepareBackgroundApproval!(name, args, `${name} summary`));
    return { text: "finished" };
  };
}

function harness(userLevel: (() => Promise<PermissionLevel>) | undefined, run: RuntimeDeps["run"]) {
  const resolve = vi.fn(async () => done);
  const store = new MemoryJobStore();
  const runtime = new BackgroundRuntime({
    store, now: () => 1_000_000, id: (() => { let n = 0; return () => `job-${++n}`; })(), holder: "one",
    run, resolve, notify: vi.fn(async () => true), ...(userLevel ? { userLevel } : {}),
  });
  return { runtime, resolve };
}

async function fireWith(opts: { scheduled?: PermissionLevel; current?: PermissionLevel | "none"; tool: string; args: Record<string, unknown> }) {
  const current = opts.current ?? "always_ask";
  const h = harness(
    current === "none" ? undefined : async () => current,
    runTool(opts.tool, opts.args),
  );
  const job = await h.runtime.schedule("owner", { bot, prompt: "Do the job.", permissionLevel: opts.scheduled });
  await h.runtime.fire("owner", job.id);
  return { saved: await h.runtime.inspect("owner", job.id), resolve: h.resolve, scheduled: job.permissionLevel };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("background jobs inherit the level at schedule time and re-check at fire time", () => {
  const sheet = { name: "Summary" };

  it("defaults a job with no captured level to Always ask", async () => {
    const { saved, scheduled } = await fireWith({ current: "full", tool: "excel_add_worksheet", args: sheet });
    expect(scheduled).toBe("always_ask");
    expect(saved.state).toBe("awaiting_approval");
  });

  it("runs a Full job without approval when the owner is still on Full, and journals why", async () => {
    const { saved, resolve } = await fireWith({ scheduled: "full", current: "full", tool: "excel_update_range", args: { worksheet: "S", values: [[1]] } });
    expect(saved.state).toBe("done");
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(saved.alert?.kind).not.toBe("approval");
    expect(saved.journal.some((e) => e.kind === "permission" && /Full permission: ran without asking/.test(e.detail))).toBe(true);
  });

  it("re-checks at fire time: tightening to Always ask parks an older Full job", async () => {
    const { saved, resolve } = await fireWith({ scheduled: "full", current: "always_ask", tool: "excel_add_worksheet", args: sheet });
    expect(saved.state).toBe("awaiting_approval");
    expect(saved.alert?.kind).toBe("approval");
    expect(resolve).not.toHaveBeenCalled();
    expect(saved.journal.some((e) => e.kind === "permission" && /Always ask/.test(e.detail))).toBe(true);
  });

  it("never elevates: loosening the owner's level does not upgrade an older job", async () => {
    const { saved, resolve } = await fireWith({ scheduled: "always_ask", current: "full", tool: "excel_add_worksheet", args: sheet });
    expect(saved.state).toBe("awaiting_approval");
    expect(resolve).not.toHaveBeenCalled();
  });

  it("fails closed when the owner's level cannot be read, or no reader is wired", async () => {
    const unreadable = harness(async () => { throw new Error("db down"); }, runTool("excel_add_worksheet", sheet));
    const job = await unreadable.runtime.schedule("owner", { bot, prompt: "x", permissionLevel: "full" });
    await unreadable.runtime.fire("owner", job.id);
    expect((await unreadable.runtime.inspect("owner", job.id)).state).toBe("awaiting_approval");
    const { saved } = await fireWith({ scheduled: "full", current: "none", tool: "excel_add_worksheet", args: sheet });
    expect(saved.state).toBe("awaiting_approval");
  });

  it("Auto jobs run only low-risk actions", async () => {
    const low = await fireWith({ scheduled: "auto", current: "auto", tool: "excel_add_worksheet", args: sheet });
    expect(low.saved.state).toBe("done");
    const high = await fireWith({ scheduled: "auto", current: "auto", tool: "excel_update_range", args: { worksheet: "S", values: [[1]] } });
    expect(high.saved.state).toBe("awaiting_approval");
  });

  it("hard-ask actions park even for a Full job", async () => {
    const { saved, resolve } = await fireWith({ scheduled: "full", current: "full", tool: "computer_run_command", args: { command: "git push origin main" } });
    expect(saved.state).toBe("awaiting_approval");
    expect(resolve).not.toHaveBeenCalled();
  });
});

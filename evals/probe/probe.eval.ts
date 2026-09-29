/**
 * Operator entry point. Run locally with `pnpm eval:probe` (see docs/eval-probe.md).
 * It sends real requests through the existing authenticated ChatGPT session
 * path using the operator's own plan; connector backends are stubbed. It is
 * skipped unless ROOK_EVAL_CONFIRM=run, and writes a numbers-only report.
 */
import { describe, expect, it, vi } from "vitest";
import { exec } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

vi.hoisted(() => {
  // Retained tool outputs go to a throwaway directory for this run only.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  process.env.ROOK_TOOL_OUTPUT_DIR = require("node:fs").mkdtempSync(require("node:path").join(require("node:os").tmpdir(), "rook-probe-output-"));
});
vi.mock("../../server/db", async () => (await import("./mocks")).db());
vi.mock("../../server/integrations/excel-tools", async (original) => (await import("./mocks")).excelTools(await original()));
vi.mock("../../server/integrations/github-tools", async (original) => (await import("./mocks")).githubTools(await original()));
vi.mock("../../server/integrations/computer-tools", async (original) => (await import("./mocks")).computerTools(await original()));
vi.mock("../../server/integrations/microsoft-excel", async (original) => (await import("./mocks")).microsoftExcel(await original()));
vi.mock("../../server/integrations/github", async (original) => (await import("./mocks")).github(await original()));
vi.mock("../../server/integrations/cloud-computer", async (original) => (await import("./mocks")).cloudComputer(await original()));
vi.mock("../../server/integrations/web-research", async () => (await import("./mocks")).webResearch());
vi.mock("../../server/integrations/agent-tool-executor", async (original) => (await import("./mocks")).agentToolExecutor(await original()));

import { assertNumbersOnly, createTokenSource, looksLikeJwt, parseEnvOptions, preflightProblems, renderSummary, runProbe, sessionRequest } from "./harness";
import { TASKS } from "./tasks";

const shell = promisify(exec);

describe.skipIf(process.env.ROOK_EVAL_CONFIRM !== "run")("probe (real ChatGPT session)", () => {
  it("runs the arms and writes a numbers-only report", async () => {
    const env = process.env;
    const options = parseEnvOptions(env);
    const problems = preflightProblems(env, options.model);
    if (problems.length) throw new Error(`The probe cannot start:\n- ${problems.join("\n- ")}`);

    const session = createTokenSource(env, async (command) => (await shell(command, { timeout: 20_000 })).stdout, Date.now);
    await session.refresh();
    if (!looksLikeJwt(session.current())) throw new Error("ROOK_EVAL_SESSION_TOKEN is not a JWT.");
    const { listChatGPTModels } = await import("../../server/ai/chatgpt");
    const models = await listChatGPTModels(sessionRequest(session));
    if (!models.length) throw new Error("Could not list ChatGPT models. The session token or CLERK_SECRET_KEY is wrong, or ChatGPT is not connected for this user.");
    if (!models.some((model) => model.id === options.model)) throw new Error(`ROOK_EVAL_MODEL is not in your ChatGPT model list. Available: ${models.map((model) => model.id).join(", ")}`);

    const tasks = options.taskIds ? TASKS.filter((task) => options.taskIds!.includes(task.id)) : TASKS;
    if (!tasks.length) throw new Error("ROOK_EVAL_TASKS matched no task.");
    const { runRookAgent } = await import("../../server/integrations/excel-agent");
    const { recentTurns } = await import("../../server/ai/telemetry");
    const report = await runProbe({ model: options.model, tasks, arms: options.arms, reps: options.reps, seed: options.seed,
      maxRequests: options.maxRequests, minIntervalMs: options.minIntervalMs, maxInvalidRate: 0.2, margin: 0.05, minPairs: 30,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)), session, run: runRookAgent, telemetry: () => recentTurns(1)[0],
      log: (line) => console.info(line) });

    assertNumbersOnly(report, [options.model, ...TASKS.map((task) => task.id)]);
    const folder = path.join(process.cwd(), ".cache", "harness-evaluation");
    mkdirSync(folder, { recursive: true });
    const file = options.out ?? path.join(folder, `probe-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    writeFileSync(file, JSON.stringify(report, null, 2));
    console.info(`\n${renderSummary(report)}\n\nNumbers-only report: ${file}`);
    const dir = process.env.ROOK_TOOL_OUTPUT_DIR;
    if (dir && path.basename(dir).startsWith("rook-probe-output-") && path.dirname(dir) === path.resolve(os.tmpdir())) rmSync(dir, { recursive: true, force: true });
    expect(report.trials.length).toBeGreaterThan(0);
  });
});

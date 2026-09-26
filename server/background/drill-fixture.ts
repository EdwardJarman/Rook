/** Test-only process fixture. Its file store simulates durable persistence across
 * an actual SIGKILL; production uses InstantJobStore exclusively. */
import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { BackgroundRuntime } from "./runtime";
import { createBackgroundRouter } from "./router";
import { startBackgroundRuntime } from "./service";
import type { Job, JobStore } from "./model";

const file = process.argv[2];
const now = Number(process.argv[3]);
const stall = process.argv[4] === "stall";
const load = (): { revision: number; jobs: Job[] } =>
  existsSync(file)
    ? JSON.parse(readFileSync(file, "utf8"))
    : { revision: 0, jobs: [] };
const store: JobStore = {
  load: async (owner) => ({
    ...load(),
    jobs: load().jobs.filter((job) => job.owner === owner),
  }),
  commit: async (_owner, revision, job) => {
    const current = load();
    if (current.revision !== revision) return false;
    writeFileSync(
      `${file}.next`,
      JSON.stringify({
        revision: revision + 1,
        jobs: [...current.jobs.filter((j) => j.id !== job.id), job],
      }),
    );
    renameSync(`${file}.next`, file);
    return true;
  },
  owners: async () => [...new Set(load().jobs.map((job) => job.owner))],
};
function count(name: string) {
  const path = `${file}.${name}`;
  writeFileSync(
    path,
    String((existsSync(path) ? Number(readFileSync(path, "utf8")) : 0) + 1),
  );
}
const runtime = new BackgroundRuntime({
  store,
  now: () => now,
  id: randomUUID,
  holder: randomUUID(),
  run: async (job, turn) => {
    const read = {
      userId: job.owner,
      botId: job.bot.id,
      taskId: job.id,
      name: "github_read_file",
      rawArgs: "{}",
      excelConnected: true,
      githubConnected: true,
      computerOnline: true,
      approvals: [],
      computerProposals: [],
    };
    await turn.execute(read, async () => {
      count("reads");
      return {
        traceStep: { kind: "tool", title: "Read" },
        resultPayload: { value: 42 },
      };
    });
    if (stall) {
      process.send?.({ checkpoint: true });
      await new Promise(() => {});
    }
    const write: Parameters<typeof turn.execute>[0] = {
      ...read,
      name: "excel_update_range",
    };
    await turn.execute(write, async () =>
      write.prepareBackgroundApproval!(
        write.name,
        { worksheet: "Sheet1", values: [[42]] },
        "Write 42 to Sheet1",
      ),
    );
    return { text: "Wrote 42 to Sheet1." };
  },
  resolve: async (_job, _tool, guard) => {
    await guard();
    count("writes");
    return {
      traceStep: { kind: "tool", title: "Write completed" },
      resultPayload: { written: 42 },
    };
  },
  notify: async (job) => {
    writeFileSync(
      `${file}.alert`,
      JSON.stringify({ jobId: job.id, ...job.alert }),
    );
    return true;
  },
});
const app = express();
app.use(
  "/trpc",
  createExpressMiddleware({
    router: createBackgroundRouter(runtime),
    createContext: ({ req, res }) => ({
      req,
      res,
      user: {
        id: "drill-owner",
        openId: "drill-owner",
        name: null,
        email: null,
        loginMethod: null,
        role: "user",
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      },
    }),
  }),
);
const server = createServer(app);
server.listen(0, "127.0.0.1", () => {
  startBackgroundRuntime(runtime);
  process.send?.({ port: (server.address() as { port: number }).port });
});

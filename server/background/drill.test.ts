import { fork, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { expect, it } from "vitest";
import type { createBackgroundRouter } from "./router";

it("live HTTP drill: schedule, kill mid-run, restart, approve from alert, receive result", async () => {
  const file = join(
    mkdtempSync(join(tmpdir(), "rook-background-drill-")),
    "jobs.json",
  );
  const children: ChildProcess[] = [];
  const boot = (now: number, stall = false) =>
    new Promise<{
      child: ChildProcess;
      port: number;
      checkpoint: Promise<void>;
    }>((resolveBoot, reject) => {
      const child = fork(
        resolve("server/background/drill-fixture.ts"),
        [file, String(now), stall ? "stall" : "resume"],
        { execArgv: ["--import", "tsx"], silent: true },
      );
      children.push(child);
      let checkpointResolve!: () => void;
      const checkpoint = new Promise<void>((r) => {
        checkpointResolve = r;
      });
      let stderr = "";
      child.stderr?.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code) reject(new Error(`Drill process exited ${code}: ${stderr}`));
      });
      child.on(
        "message",
        (message: { port?: number; checkpoint?: boolean }) => {
          if (message.port)
            resolveBoot({ child, port: message.port, checkpoint });
          if (message.checkpoint) checkpointResolve();
        },
      );
    });
  const client = (port: number) =>
    createTRPCProxyClient<ReturnType<typeof createBackgroundRouter>>({
      links: [
        httpBatchLink({
          url: `http://127.0.0.1:${port}/trpc`,
          transformer: superjson,
        }),
      ],
    });
  const until = async <T>(
    read: () => Promise<T>,
    ok: (value: T) => boolean,
  ): Promise<T> => {
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      const value = await read();
      if (ok(value)) return value;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("Drill state did not arrive before deadline");
  };
  try {
    const first = await boot(1_000_000, true);
    const api1 = client(first.port);
    const scheduled = await api1.schedule.mutate({
      bot: {
        id: "bot",
        name: "Scout",
        role: "Analyst",
        purpose: "Complete the detached task",
      },
      prompt: "Read the file, then put 42 in Sheet1.",
    });
    expect(scheduled.ok).toBe(true);
    if (!scheduled.ok) throw new Error(scheduled.error.message);
    const id = scheduled.value.id;
    await first.checkpoint;
    const exited = new Promise<void>((r) =>
      first.child.once("exit", () => r()),
    );
    first.child.kill("SIGKILL");
    await exited;
    const second = await boot(1_031_000);
    const api2 = client(second.port);
    const parked = await until(
      () => api2.inspect.query({ id }),
      (value) => value.ok && value.value.state === "awaiting_approval",
    );
    if (!parked.ok) throw new Error(parked.error.message);
    await until(
      async () =>
        existsSync(`${file}.alert`)
          ? JSON.parse(readFileSync(`${file}.alert`, "utf8"))
          : null,
      (alert) => alert?.kind === "approval",
    );
    const alert = JSON.parse(readFileSync(`${file}.alert`, "utf8"));
    expect(alert.jobId).toBe(id);
    expect(readFileSync(`${file}.reads`, "utf8")).toBe("1");
    expect(existsSync(`${file}.writes`)).toBe(false);
    const approved = await api2.approve.mutate({
      id,
      approvalId: alert.id,
      decision: "approve",
    });
    expect(approved.ok).toBe(true);
    const done = await until(
      () => api2.inspect.query({ id }),
      (value) => value.ok && value.value.state === "done",
    );
    expect(done.ok && done.value.result).toEqual({
      text: "Wrote 42 to Sheet1.",
    });
    expect(readFileSync(`${file}.reads`, "utf8")).toBe("1");
    expect(readFileSync(`${file}.writes`, "utf8")).toBe("1");
    expect(
      done.ok && done.value.journal.some((event) => event.kind === "recovery"),
    ).toBe(true);
  } finally {
    await Promise.all(
      children
        .filter((child) => child.exitCode === null && child.signalCode === null)
        .map(
          (child) =>
            new Promise<void>((resolveExit) => {
              child.once("exit", () => resolveExit());
              child.kill("SIGKILL");
            }),
        ),
    );
  }
}, 60_000);

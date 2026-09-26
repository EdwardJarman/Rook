import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createBackgroundRouter } from "./router";
import { BackgroundRuntime } from "./runtime";
import { MemoryJobStore } from "./store";
import type { TrpcContext } from "../_core/context";

describe("background API ownership", () => {
  it("requires auth and never inspects, cancels or approves another owner's job", async () => {
    const runtime = new BackgroundRuntime({
      store: new MemoryJobStore(),
      now: () => 1000,
      id: randomUUID,
      holder: "test",
      run: async () => ({}),
      resolve: async () => {
        throw new Error("unused");
      },
      notify: async () => true,
    });
    const router = createBackgroundRouter(runtime);
    const context = (id?: string): TrpcContext => ({
      req: {} as TrpcContext["req"],
      res: {} as TrpcContext["res"],
      user: id
        ? {
            id,
            openId: id,
            name: null,
            email: null,
            loginMethod: null,
            role: "user",
            createdAt: new Date(),
            updatedAt: new Date(),
            lastSignedIn: new Date(),
          }
        : null,
    });
    await expect(router.createCaller(context()).list()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    const owner = router.createCaller(context("owner")),
      other = router.createCaller(context("other"));
    const created = await owner.schedule({
      bot: { id: "bot", name: "Bot", role: "Analyst", purpose: "Work" },
      prompt: "Read a file",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.value.id;
    for (const result of await Promise.all([
      other.inspect({ id }),
      other.cancel({ id }),
      other.approve({ id, approvalId: "anything", decision: "approve" }),
    ]))
      expect(result).toMatchObject({
        ok: false,
        error: { code: "NOT_FOUND", retryable: false },
      });
    expect(await other.list()).toEqual({ ok: true, value: [] });
    expect(await owner.status()).toEqual({
      ok: true,
      value: { jobs: 1, awaitingApproval: 0 },
    });
  });
});

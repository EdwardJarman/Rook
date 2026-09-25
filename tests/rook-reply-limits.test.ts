import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  clampReplyField,
  isValidationSendError,
  REPLY_LIMITS,
  toRecentContextEntries,
  VALIDATION_SEND_FALLBACK,
} from "../lib/workroom-helpers";

describe("reply input contract clamping", () => {
  it("truncates history bodies to the server per-entry cap", () => {
    const entries = toRecentContextEntries([
      { author: "bot", body: "x".repeat(5000) },
      { author: "user", body: "short" },
    ]);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.body).toHaveLength(REPLY_LIMITS.contextBody);
    expect(entries[1]?.body).toBe("short");
  });

  it("keeps only the newest entries", () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({
      author: "user" as const,
      body: `m${i}`,
    }));
    const entries = toRecentContextEntries(messages, 6);
    expect(entries.map((entry) => entry.body)).toEqual([
      "m4",
      "m5",
      "m6",
      "m7",
      "m8",
      "m9",
    ]);
  });

  it("clamps identity fields without touching short values", () => {
    expect(clampReplyField("Scout", REPLY_LIMITS.botName)).toBe("Scout");
    expect(clampReplyField("x".repeat(200), REPLY_LIMITS.botName)).toHaveLength(80);
  });

  it("stays in sync with the server zod caps on both reply routes", () => {
    const routers = readFileSync(resolve(process.cwd(), "server/routers.ts"), "utf8");
    const streamRoute = readFileSync(
      resolve(process.cwd(), "server/agent-stream-route.ts"),
      "utf8",
    );
    for (const source of [routers, streamRoute]) {
      expect(source).toContain("botName: z.string().min(1).max(80)");
      expect(source).toContain("botRole: z.string().min(1).max(120)");
      expect(source).toContain("botPurpose: z.string().min(1).max(500)");
      expect(source).toContain("message: z.string().min(1).max(4000)");
      expect(source).toContain("botMemory: z.string().max(4000).optional()");
      expect(source).toContain("body: z.string().max(2000)");
    }
    expect(REPLY_LIMITS).toEqual({
      botName: 80,
      botRole: 120,
      botPurpose: 500,
      message: 4000,
      botMemory: 4000,
      contextBody: 2000,
      contextDepth: 8,
    });
  });
});

describe("validation-error fallback", () => {
  it("recognizes the exact raw-Zod leak from the bug report", () => {
    const leaked = JSON.stringify([
      {
        origin: "string",
        code: "too_big",
        maximum: 2000,
        inclusive: true,
        path: ["recentContext", 3, "body"],
        message: "Too big: expected string to have <=2000 characters",
      },
    ]);
    expect(isValidationSendError(new Error(leaked))).toBe(true);
    expect(VALIDATION_SEND_FALLBACK).not.toContain("[");
    expect(VALIDATION_SEND_FALLBACK.length).toBeLessThan(160);
  });

  it("leaves genuine capacity errors alone", () => {
    expect(
      isValidationSendError(new Error("Free AI capacity is temporarily full.")),
    ).toBe(false);
    expect(isValidationSendError(new Error("网络错误"))).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import {
  approvalsFromReply,
  filterChatContext,
  messageKindFor,
  replyTextOf,
  taskForSend,
  traceFromReply,
  turnNeedsDecision,
} from "./reply-artifacts";

describe("reply text + kind", () => {
  it("never yields a blank body", () => {
    expect(replyTextOf(undefined)).toBe("…");
    expect(replyTextOf(null)).toBe("…");
    expect(replyTextOf({})).toBe("…");
    expect(replyTextOf({ text: "  hi  " })).toBe("hi");
  });

  it("marks decision turns as approval kind", () => {
    expect(messageKindFor({ text: "done" })).toBe("message");
    expect(
      messageKindFor({
        text: "x",
        approvals: [{ actionId: "a", title: "t", detail: "d", risk: "Medium" }],
      }),
    ).toBe("approval");
    expect(
      messageKindFor({
        text: "x",
        computerProposals: [{ proposalId: "p", title: "t" }],
      }),
    ).toBe("approval");
    expect(turnNeedsDecision({ text: "x" })).toBe(false);
  });
});

describe("approvalsFromReply", () => {
  it("maps Excel approvals to executable desktop records", () => {
    const [approval] = approvalsFromReply(
      {
        approvals: [{ actionId: "act-1", title: "Update Q3", detail: "Sheet1!A1", risk: "Medium" }],
      },
      { botId: "b", taskId: "t", now: "2026-01-01T00:00:00.000Z" },
    );
    expect(approval).toMatchObject({
      botId: "b",
      taskId: "t",
      summary: "Update Q3",
      reason: "Sheet1!A1",
      capability: "excel",
      state: "pending",
      externalActionId: "act-1",
      agentKind: "excel",
    });
    expect(approval.expiresAt).toBeTruthy();
  });

  it("preserves computer proposal payload for later execution", () => {
    const [proposal] = approvalsFromReply(
      {
        computerProposals: [
          { proposalId: "p-1", title: "Open portal", url: "https://portal.example.com" },
        ],
      },
      { botId: "b", taskId: "t" },
    );
    expect(proposal).toMatchObject({
      capability: "computer",
      agentKind: "computer",
      proposalUrl: "https://portal.example.com",
    });
    expect(proposal.reason).toContain("Computer panel");
  });

  it("returns nothing for plain answers", () => {
    expect(approvalsFromReply({ text: "hi" }, { botId: "b", taskId: "t" })).toEqual([]);
    expect(approvalsFromReply(undefined, { botId: "b", taskId: "t" })).toEqual([]);
  });
});

describe("taskForSend", () => {
  it("builds a Planning task with a trimmed title", () => {
    const task = taskForSend({ botId: "b", body: "x".repeat(100) });
    expect(task).toMatchObject({ botId: "b", status: "Planning", risk: "Low" });
    expect(task.title.endsWith("…")).toBe(true);
    expect(task.steps).toHaveLength(3);
  });
});

describe("traceFromReply", () => {
  it("keeps well-formed steps and drops junk without throwing", () => {
    expect(traceFromReply(undefined)).toBeUndefined();
    expect(traceFromReply({ trace: "nope" })).toBeUndefined();
    expect(
      traceFromReply({
        trace: [
          { kind: "tool", title: "Checked Excel", detail: "ok" },
          null,
          "junk",
          { kind: "tool" },
          { kind: "search", title: "Searched", url: "https://example.com", extra: 1 },
        ],
      }),
    ).toEqual([
      { kind: "tool", title: "Checked Excel", detail: "ok" },
      { kind: "search", title: "Searched", url: "https://example.com" },
    ]);
  });
});

describe("filterChatContext", () => {
  it("scopes history to chat members and caps depth", () => {
    const messages = [
      { botId: "other", author: "user" as const, body: "leak?" },
      ...Array.from({ length: 10 }, (_, i) => ({
        botId: i % 2 ? "b1" : null,
        author: "user" as const,
        body: `m${i}`,
      })),
    ];
    const context = filterChatContext(messages, ["b1"]);
    expect(context).toHaveLength(6);
    expect(context.some((m) => m.body === "leak?")).toBe(false);
    expect(context[context.length - 1]?.body).toBe("m9");
  });

  it("truncates bodies to the server per-entry cap", () => {
    const context = filterChatContext(
      [{ botId: "b1", author: "bot" as const, body: "y".repeat(5000) }],
      ["b1"],
    );
    expect(context[0]?.body).toHaveLength(2000);
  });
});

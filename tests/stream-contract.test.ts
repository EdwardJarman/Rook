import { describe, expect, it } from "vitest";

import type { AgentTraceStepKind } from "../shared/agent-trace";
import {
  AGENT_STREAM_EVENT_TYPES,
  STREAM_CONTRACT_VERSION,
  type AgentStreamEvent,
  type AgentStreamEventType,
} from "../server/ai/agent-stream";

describe("grok ACP-parity: versioned stream contract", () => {
  it("pins the contract version and event kinds", () => {
    expect(STREAM_CONTRACT_VERSION).toBe(1);
    expect([...AGENT_STREAM_EVENT_TYPES]).toEqual(["trace", "token", "approval", "proposal"]);
  });

  it("every kind constructs (producer/consumer shape parity)", () => {
    const traceKind: AgentTraceStepKind = "tool";
    const events: AgentStreamEvent[] = [
      { type: "trace", step: { kind: traceKind, title: "Ran tests" } },
      { type: "token", delta: "hello" },
      {
        type: "approval",
        approval: { actionId: "a", title: "Approve", detail: "d", risk: "Medium" },
      },
      { type: "proposal", proposal: { proposalId: "p", title: "Task" } },
    ];
    const kinds = events.map((event) => event.type).sort();
    const expected: AgentStreamEventType[] = [...AGENT_STREAM_EVENT_TYPES].sort();
    expect(kinds).toEqual(expected);
  });
});

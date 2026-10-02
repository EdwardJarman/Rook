import { describe, expect, it } from "vitest";

import {
  approvalReason,
  assessRisk,
  fileSizeLabel,
  guessDeliverableTitle,
  isDeliverableWorthy,
  isNetworkSendError,
  reconcileApprovals,
  requiresApproval,
  wordCount,
} from "../lib/workroom-helpers";

describe("Auto-Review risk classifier", () => {
  it("classifies irreversible, financial, and production actions as High", () => {
    expect(assessRisk("Delete my account permanently").tier).toBe("High");
    expect(assessRisk("Purchase the annual plan").tier).toBe("High");
    expect(assessRisk("Deploy the change to production").tier).toBe("High");
    expect(assessRisk("Buy the domain for the launch").tier).toBe("High");
    expect(assessRisk("Pay the invoice by Friday").tier).toBe("High");
    expect(assessRisk("Wire transfer $500 to the contractor").tier).toBe("High");
  });

  it("classifies outbound and destructive-but-scoped actions as Medium", () => {
    expect(assessRisk("Send the client the draft").tier).toBe("Medium");
    expect(assessRisk("Publish the announcement").tier).toBe("Medium");
    expect(assessRisk("Delete the old workspace").tier).toBe("Medium");
  });

  it("never blocks everyday dev and chat vocabulary (false-positive guards)", () => {
    // Each Low case below previously tripped a financial/destructive
    // pattern and hard-blocked sending with a misleading reason.
    const low = [
      "Checkout the feature branch and review the diff",
      "Pay attention to the error handling in this file",
      "We need buy-in from the team before Friday",
      "Write a commit message for these changes",
      "Remove the bug where the timer never stops",
      "Take charge of the refactor and keep it small",
      "Then proceed to implement Phase 1 fully with tight gunplay and multiplayer",
      "How does deployment to production work?",
      "What does revoke actually do to API keys?",
    ];
    for (const message of low) {
      expect({ message, tier: assessRisk(message).tier }).toEqual({
        message,
        tier: "Low",
      });
    }
    // Medium still labels (task risk pill) but never blocks sending.
    for (const message of [
      "Share your thoughts on this API design",
      "Draft a blog post about the release",
    ]) {
      expect(requiresApproval(message)).toBe(false);
    }
  });

  it("classifies routine drafting/research work as Low with no approval friction", () => {
    expect(assessRisk("Summarize the attached notes into a clear brief").tier).toBe("Low");
    expect(assessRisk("Research the top 3 competitors").tier).toBe("Low");
    expect(requiresApproval("Summarize the attached notes into a clear brief")).toBe(false);
  });

  it("only pauses sending for High risk; Medium labels without blocking", () => {
    expect(requiresApproval("Send the client the draft")).toBe(false);
    expect(requiresApproval("Delete the old workspace")).toBe(false);
    expect(requiresApproval("Deploy the change to production")).toBe(true);
    expect(requiresApproval("Purchase the annual plan")).toBe(true);
    expect(approvalReason("Send the client the draft")).toContain("communicate outside");
    expect(approvalReason("Purchase the annual plan")).toContain("financial");
  });
});

describe("stale approval reconciliation", () => {
  const NOW = 1_000_000;
  const local = (overrides: Record<string, unknown> = {}) => ({
    externalActionId: undefined,
    createdAtMs: NOW - 10_000,
    ...overrides,
  });

  it("keeps everything when the server list has not loaded", () => {
    const approvals = [local({ externalActionId: "a1" })];
    expect(reconcileApprovals(approvals, null, NOW)).toEqual(approvals);
  });

  it("drops server-backed approvals the server no longer lists", () => {
    const approvals = [
      local({ externalActionId: "gone", createdAtMs: NOW - 500_000 }),
      local({ externalActionId: "live", createdAtMs: NOW - 500_000 }),
      local({ createdAtMs: NOW - 500_000 }),
    ];
    expect(reconcileApprovals(approvals, new Set(["live"]), NOW)).toEqual([
      approvals[1],
      approvals[2],
    ]);
  });

  it("spares just-created actions inside the grace window", () => {
    const approvals = [local({ externalActionId: "fresh", createdAtMs: NOW - 5_000 })];
    expect(reconcileApprovals(approvals, new Set(), NOW)).toEqual(approvals);
  });
});

describe("file + deliverable helpers", () => {
  it("returns stable file size labels", () => {
    expect(fileSizeLabel(512)).toBe("512 B");
    expect(fileSizeLabel(2048)).toBe("2 KB");
  });

  it("treats short chat replies as ordinary messages, not deliverables", () => {
    expect(isDeliverableWorthy("Sure, I'll get right on that.")).toBe(false);
  });

  it("treats multi-paragraph or structured results as deliverables", () => {
    const longAnswer = `# Weekly brief\n\n${"Lorem ipsum dolor sit amet. ".repeat(10)}\n\n${"Another paragraph of findings. ".repeat(10)}`;
    expect(isDeliverableWorthy(longAnswer)).toBe(true);
    expect(guessDeliverableTitle(longAnswer)).toBe("Weekly brief");
  });

  it("guesses a title from the first sentence when there is no heading", () => {
    const text = "Here is the competitor comparison you asked for. It covers pricing and features.";
    expect(guessDeliverableTitle(text)).toContain("Here is the competitor comparison");
  });

  it("counts words for a quick deliverable summary", () => {
    expect(wordCount("one two three")).toBe(3);
    expect(wordCount("  ")).toBe(0);
  });
});

describe("send retry safety", () => {
  it("retries only transport failures, never auth/validation/rate errors", () => {
    expect(isNetworkSendError(new Error("fetch failed"))).toBe(true);
    expect(isNetworkSendError(new Error("Network request failed"))).toBe(true);
    expect(isNetworkSendError(new Error("The AI stream timed out"))).toBe(true);
    expect(isNetworkSendError(new Error("Connection refused"))).toBe(true);
    expect(isNetworkSendError(new Error("UNAUTHORIZED"))).toBe(false);
    expect(isNetworkSendError(new Error("Session not accepted (10001)"))).toBe(false);
    expect(isNetworkSendError(new Error('[{"code":"too_big"}]'))).toBe(false);
    expect(isNetworkSendError(new Error("Free AI capacity is temporarily full."))).toBe(false);
    expect(isNetworkSendError(new Error("429"))).toBe(false);
  });
});

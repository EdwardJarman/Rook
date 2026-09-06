import { describe, expect, it } from "vitest";

import {
  approvalReason,
  assessRisk,
  fileSizeLabel,
  guessDeliverableTitle,
  isDeliverableWorthy,
  requiresApproval,
  wordCount,
} from "../lib/workroom-helpers";

describe("Auto-Review risk classifier", () => {
  it("classifies irreversible, financial, and production actions as High", () => {
    expect(assessRisk("Delete my account permanently").tier).toBe("High");
    expect(assessRisk("Purchase the annual plan").tier).toBe("High");
    expect(assessRisk("Deploy the change to production").tier).toBe("High");
  });

  it("classifies outbound and destructive-but-scoped actions as Medium", () => {
    expect(assessRisk("Send the client the draft").tier).toBe("Medium");
    expect(assessRisk("Publish the announcement").tier).toBe("Medium");
    expect(assessRisk("Delete the old workspace").tier).toBe("Medium");
  });

  it("classifies routine drafting/research work as Low with no approval friction", () => {
    expect(assessRisk("Summarize the attached notes into a clear brief").tier).toBe("Low");
    expect(assessRisk("Research the top 3 competitors").tier).toBe("Low");
    expect(requiresApproval("Summarize the attached notes into a clear brief")).toBe(false);
  });

  it("keeps requiresApproval/approvalReason as tier-aware wrappers", () => {
    expect(requiresApproval("Send the client the draft")).toBe(true);
    expect(requiresApproval("Deploy the change to production")).toBe(true);
    expect(approvalReason("Send the client the draft")).toContain("communicate outside");
    expect(approvalReason("Purchase the annual plan")).toContain("financial");
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

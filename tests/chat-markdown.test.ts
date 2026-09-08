import { describe, expect, it } from "vitest";

import { parseChatMarkdown, parseInlineMarkdown } from "../lib/chat-markdown";

describe("mobile chat Markdown rendering", () => {
  it("turns headings, ordered items, bullets, and bold markers into structured display blocks", () => {
    const blocks = parseChatMarkdown("## Low-cost ideas\n1. **AI automation consulting**\n- Build useful workflows");

    expect(blocks).toEqual([
      { type: "heading", level: 2, content: [{ text: "Low-cost ideas" }] },
      { type: "ordered", ordinal: "1", content: [{ text: "AI automation consulting", bold: true }] },
      { type: "bullet", content: [{ text: "Build useful workflows" }] },
    ]);
  });

  it("preserves inline emphasis without exposing literal Markdown markers", () => {
    expect(parseInlineMarkdown("A **bold** and `code` note")).toEqual([
      { text: "A " },
      { text: "bold", bold: true },
      { text: " and " },
      { text: "code", code: true },
      { text: " note" },
    ]);
  });
});

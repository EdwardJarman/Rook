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

  it("keeps fenced code byte-verbatim: underscores, stars, lists, numbers", () => {
    const blocks = parseChatMarkdown(
      "Here you go:\n```python\ndef __init__(self):\n    self.x = bird.radius * 2\n1. not a list\n- not a bullet\nif __name__ == \"__main__\":\n```\nDone.",
    );
    expect(blocks).toEqual([
      { type: "paragraph", content: [{ text: "Here you go:" }] },
      {
        type: "code",
        language: "python",
        code: "def __init__(self):\n    self.x = bird.radius * 2\n1. not a list\n- not a bullet\nif __name__ == \"__main__\":",
      },
      { type: "paragraph", content: [{ text: "Done." }] },
    ]);
  });

  it("still parses emphasis in prose around code fences", () => {
    const blocks = parseChatMarkdown("A **bold** claim:\n```\n__init__ stays\n```\nBack to *italic*.");
    expect(blocks[0]).toEqual({
      type: "paragraph",
      content: [{ text: "A " }, { text: "bold", bold: true }, { text: " claim:" }],
    });
    expect(blocks[1]).toEqual({ type: "code", code: "__init__ stays" });
    expect(blocks[2]).toEqual({
      type: "paragraph",
      content: [{ text: "Back to " }, { text: "italic", bold: false }, { text: "." }],
    });
  });

  it("treats an unclosed fence as code to the end without leaking markers", () => {
    const blocks = parseChatMarkdown("Start:\n```js\nconst x = a * b;");
    expect(blocks).toEqual([
      { type: "paragraph", content: [{ text: "Start:" }] },
      { type: "code", language: "js", code: "const x = a * b;" },
    ]);
  });
});

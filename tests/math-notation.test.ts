import { describe, expect, it } from "vitest";

import { mathFallbackText, splitMathNotation } from "../lib/math-notation";

describe("math notation in mobile chat", () => {
  it("separates inline and display LaTeX from ordinary prose", () => {
    expect(splitMathNotation("Rectangle: \\(P = 2(l + w)\\) then $$C = 2\\pi r$$")).toEqual([
      { type: "text", text: "Rectangle: " },
      { type: "math", latex: "P = 2(l + w)", display: false },
      { type: "text", text: " then " },
      { type: "math", latex: "C = 2\\pi r", display: true },
    ]);
  });

  it("provides a readable symbol fallback when typesetting is unavailable", () => {
    expect(mathFallbackText("C = 2\\pi r")).toBe("C = 2π r");
    expect(mathFallbackText("\\frac{a}{b} \\times \\sqrt{x}")).toBe("a⁄b × √(x)");
  });
});

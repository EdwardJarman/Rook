export type MathNotationSegment =
  | { type: "text"; text: string }
  | { type: "math"; latex: string; display: boolean };

const MATH_TOKEN = /(\\\((?:.|\n)*?\\\)|\\\[(?:.|\n)*?\\\]|\$\$(?:.|\n)*?\$\$)/g;

export function splitMathNotation(value: string): MathNotationSegment[] {
  const segments: MathNotationSegment[] = [];
  let cursor = 0;

  for (const match of value.matchAll(MATH_TOKEN)) {
    const index = match.index ?? 0;
    if (index > cursor) segments.push({ type: "text", text: value.slice(cursor, index) });
    const token = match[0];
    const display = token.startsWith("\\[") || token.startsWith("$$");
    const latex = token
      .replace(/^\\\(|\\\)$/g, "")
      .replace(/^\\\[|\\\]$/g, "")
      .replace(/^\$\$|\$\$$/g, "")
      .trim();
    if (latex) segments.push({ type: "math", latex, display });
    cursor = index + token.length;
  }

  if (cursor < value.length) segments.push({ type: "text", text: value.slice(cursor) });
  return segments.length ? segments : [{ type: "text", text: value }];
}

/** Readable fallback when a native math surface cannot load its typesetting engine. */
export function mathFallbackText(latex: string) {
  return latex
    .replace(/\\left|\\right/g, "")
    .replace(/\\cdot/g, "·")
    .replace(/\\times/g, "×")
    .replace(/\\div/g, "÷")
    .replace(/\\pi/g, "π")
    .replace(/\\theta/g, "θ")
    .replace(/\\alpha/g, "α")
    .replace(/\\beta/g, "β")
    .replace(/\\gamma/g, "γ")
    .replace(/\\sqrt\{([^}]*)\}/g, "√($1)")
    .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, "$1⁄$2")
    .replace(/[{}]/g, "")
    .replace(/\\,/g, " ")
    .replace(/\\!/g, "")
    .replace(/\\text\{([^}]*)\}/g, "$1");
}

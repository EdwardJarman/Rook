export type ChatMarkdownInline = {
  text: string;
  bold?: boolean;
  code?: boolean;
};

export type ChatMarkdownBlock =
  | { type: "heading"; level: 1 | 2 | 3; content: ChatMarkdownInline[] }
  | { type: "bullet"; content: ChatMarkdownInline[] }
  | { type: "ordered"; ordinal: string; content: ChatMarkdownInline[] }
  | { type: "paragraph"; content: ChatMarkdownInline[] }
  | { type: "math"; latex: string };

const inlineToken = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*]+\*)/g;
const displayMathToken = /(\\\[(?:.|\n)*?\\\]|\$\$(?:.|\n)*?\$\$)/g;

/**
 * Keeps display math together before ordinary Markdown is split line-by-line.
 * Without this first pass an expression such as `\[` newline `C = 2\pi r`
 * newline `\]` becomes three text paragraphs and can never reach the visual
 * math surface as one expression.
 */
export function parseChatMarkdown(value: string): ChatMarkdownBlock[] {
  const normalized = value.replace(/\r\n?/g, "\n");
  const blocks: ChatMarkdownBlock[] = [];
  let cursor = 0;

  for (const match of normalized.matchAll(displayMathToken)) {
    const index = match.index ?? 0;
    if (index > cursor)
      blocks.push(...parseTextBlocks(normalized.slice(cursor, index)));

    const token = match[0];
    const latex = token.startsWith("\\[")
      ? token.slice(2, -2).trim()
      : token.slice(2, -2).trim();
    if (latex) blocks.push({ type: "math", latex });
    cursor = index + token.length;
  }

  if (cursor < normalized.length)
    blocks.push(...parseTextBlocks(normalized.slice(cursor)));
  return blocks.length
    ? blocks
    : [{ type: "paragraph", content: [{ text: "" }] }];
}

function parseTextBlocks(value: string): ChatMarkdownBlock[] {
  const blocks: ChatMarkdownBlock[] = [];
  const lines = value.split("\n");

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1].length as 1 | 2 | 3,
        content: parseInlineMarkdown(heading[2]),
      });
      continue;
    }

    const ordered = /^(\d+)\.\s+(.+)$/.exec(line);
    if (ordered) {
      blocks.push({
        type: "ordered",
        ordinal: ordered[1],
        content: parseInlineMarkdown(ordered[2]),
      });
      continue;
    }

    const bullet = /^[-*+]\s+(.+)$/.exec(line);
    if (bullet) {
      blocks.push({ type: "bullet", content: parseInlineMarkdown(bullet[1]) });
      continue;
    }

    blocks.push({ type: "paragraph", content: parseInlineMarkdown(line) });
  }

  return blocks;
}

export function parseInlineMarkdown(value: string): ChatMarkdownInline[] {
  const parts: ChatMarkdownInline[] = [];
  let cursor = 0;

  for (const match of value.matchAll(inlineToken)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push({ text: value.slice(cursor, index) });
    const token = match[0];
    if (token.startsWith("**") || token.startsWith("__")) {
      parts.push({ text: token.slice(2, -2), bold: true });
    } else if (token.startsWith("`")) {
      parts.push({ text: token.slice(1, -1), code: true });
    } else {
      parts.push({ text: token.slice(1, -1), bold: false });
    }
    cursor = index + token.length;
  }

  if (cursor < value.length) parts.push({ text: value.slice(cursor) });
  return parts.length ? parts : [{ text: value }];
}

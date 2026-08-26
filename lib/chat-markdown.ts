export type ChatMarkdownInline = {
  text: string;
  bold?: boolean;
  code?: boolean;
};

export type ChatMarkdownBlock =
  | { type: "heading"; level: 1 | 2 | 3; content: ChatMarkdownInline[] }
  | { type: "bullet"; content: ChatMarkdownInline[] }
  | { type: "ordered"; ordinal: string; content: ChatMarkdownInline[] }
  | { type: "paragraph"; content: ChatMarkdownInline[] };

const inlineToken = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*]+\*)/g;

export function parseChatMarkdown(value: string): ChatMarkdownBlock[] {
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ChatMarkdownBlock[] = [];

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
      blocks.push({ type: "ordered", ordinal: ordered[1], content: parseInlineMarkdown(ordered[2]) });
      continue;
    }

    const bullet = /^[-*+]\s+(.+)$/.exec(line);
    if (bullet) {
      blocks.push({ type: "bullet", content: parseInlineMarkdown(bullet[1]) });
      continue;
    }

    blocks.push({ type: "paragraph", content: parseInlineMarkdown(line) });
  }

  return blocks.length ? blocks : [{ type: "paragraph", content: [{ text: "" }] }];
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

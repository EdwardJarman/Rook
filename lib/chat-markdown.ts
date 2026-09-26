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
  | { type: "code"; language?: string; code: string }
  | { type: "math"; latex: string };

const inlineToken = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*]+\*)/g;
const displayMathToken = /(\\\[(?:.|\n)*?\\\]|\$\$(?:.|\n)*?\$\$)/g;

const fenceOpenToken = /^\s{0,3}```([A-Za-z0-9_+#-]*)\s*$/;
const fenceCloseToken = /^\s{0,3}```\s*$/;

type Segment = { code: false; text: string } | { code: true; language?: string; text: string };

/**
 * Splits raw input into fenced-code segments (kept byte-verbatim) and
 * prose segments. Fences must occupy their own line; an unclosed fence
 * runs to the end of input. Fence marker lines never reach the output.
 */
function splitCodeSegments(value: string): Segment[] {
  const segments: Segment[] = [];
  const lines = value.split("\n");
  let prose: string[] = [];
  let code: string[] | null = null;
  let language: string | undefined;

  const flushProse = () => {
    if (prose.length) {
      segments.push({ code: false, text: prose.join("\n") });
      prose = [];
    }
  };

  for (const rawLine of lines) {
    if (code === null) {
      const open = fenceOpenToken.exec(rawLine);
      if (open) {
        flushProse();
        code = [];
        language = open[1] || undefined;
        continue;
      }
      prose.push(rawLine);
    } else if (fenceCloseToken.test(rawLine)) {
      segments.push({ code: true, language, text: code.join("\n") });
      code = null;
      language = undefined;
    } else {
      code.push(rawLine);
    }
  }
  if (code !== null) {
    segments.push({ code: true, language, text: code.join("\n") });
  } else {
    flushProse();
  }
  return segments;
}

/**
 * Keeps display math together before ordinary Markdown is split line-by-line.
 * Without this first pass an expression such as `\[` newline `C = 2\pi r`
 * newline `\]` becomes three text paragraphs and can never reach the visual
 * math surface as one expression.
 *
 * Fenced code blocks are carved out first and passed through verbatim:
 * emphasis markers (`__init__`, `* 2`), list markers, and math delimiters
 * inside code must never be interpreted — that mangling is what used to
 * shred pasted/model-generated source code in chat.
 */
export function parseChatMarkdown(value: string): ChatMarkdownBlock[] {
  const normalized = value.replace(/\r\n?/g, "\n");
  const blocks: ChatMarkdownBlock[] = [];

  for (const segment of splitCodeSegments(normalized)) {
    if (segment.code) {
      if (segment.text.trim()) {
        blocks.push({
          type: "code",
          ...(segment.language ? { language: segment.language } : {}),
          code: segment.text.replace(/^\n+/, "").replace(/\s+$/, ""),
        });
      }
      continue;
    }
    blocks.push(...parseNonCodeBlocks(segment.text));
  }
  return blocks.length
    ? blocks
    : [{ type: "paragraph", content: [{ text: "" }] }];
}

function parseNonCodeBlocks(value: string): ChatMarkdownBlock[] {
  const blocks: ChatMarkdownBlock[] = [];
  let cursor = 0;

  for (const match of value.matchAll(displayMathToken)) {
    const index = match.index ?? 0;
    if (index > cursor)
      blocks.push(...parseTextBlocks(value.slice(cursor, index)));

    const token = match[0];
    const latex = token.startsWith("\\[")
      ? token.slice(2, -2).trim()
      : token.slice(2, -2).trim();
    if (latex) blocks.push({ type: "math", latex });
    cursor = index + token.length;
  }

  if (cursor < value.length)
    blocks.push(...parseTextBlocks(value.slice(cursor)));
  return blocks;
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

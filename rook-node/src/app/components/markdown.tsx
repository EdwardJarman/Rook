import { useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";

import { useTheme } from "@/lib/theme";

/**
 * Lightweight markdown renderer for chat messages: fenced code blocks with
 * copy buttons, inline code, bold/italic, links, and bullet/numbered lists.
 * Deliberately dependency-free — parity with the web app's ChatMarkdown
 * for the constructs chat actually produces.
 */
export function Markdown({ text }: { text: string }) {
  const { tokens } = useTheme();
  const blocks = splitFences(text);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {blocks.map((b, i) =>
        b.kind === "code" ? (
          <CodeBlock key={i} code={b.body} lang={b.lang} />
        ) : (
          <TextBlock key={i} text={b.body} />
        ),
      )}
    </div>
  );
}

type Block = { kind: "code"; body: string; lang: string } | { kind: "text"; body: string };

function splitFences(text: string): Block[] {
  const blocks: Block[] = [];
  const parts = text.split(/```/);
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) {
      const nl = parts[i].indexOf("\n");
      const lang = nl === -1 ? parts[i].trim() : parts[i].slice(0, nl).trim();
      const body = nl === -1 ? "" : parts[i].slice(nl + 1).replace(/\n$/, "");
      blocks.push({ kind: "code", body, lang });
    } else if (parts[i].length > 0) {
      blocks.push({ kind: "text", body: parts[i] });
    }
  }
  return blocks;
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const { tokens } = useTheme();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable (permissions) — nothing sensible to do
    }
  };
  return (
    <div
      style={{
        background: tokens.surfaceAlt,
        border: `1px solid ${tokens.line}`,
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "5px 10px",
          borderBottom: `1px solid ${tokens.line}`,
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 600, color: tokens.textFaint, fontFamily: "var(--rook-mono)" }}>
          {lang || "code"}
        </span>
        <button
          type="button"
          onClick={() => void copy()}
          aria-label="Copy code"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            border: "none",
            background: "transparent",
            color: tokens.textSoft,
            fontSize: 11,
            cursor: "pointer",
            padding: 2,
          }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre
        style={{
          margin: 0,
          padding: "10px 12px",
          overflowX: "auto",
          fontSize: 12.5,
          lineHeight: 1.55,
          fontFamily: "var(--rook-mono)",
          color: tokens.text,
        }}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

function TextBlock({ text }: { text: string }) {
  const { tokens } = useTheme();
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    out.push(
      <Tag
        key={`l-${out.length}`}
        style={{ margin: "2px 0", paddingLeft: 20, display: "flex", flexDirection: "column", gap: 3 }}
      >
        {list.items.map((it, i) => (
          <li key={i} style={{ lineHeight: 1.55 }}>
            <Inline text={it} />
          </li>
        ))}
      </Tag>,
    );
    list = null;
  };

  lines.forEach((raw, idx) => {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet) {
      if (!list || list.ordered) flush();
      list = list ?? { ordered: false, items: [] };
      list.items.push(bullet[1]);
      return;
    }
    if (ordered) {
      if (!list || !list.ordered) flush();
      list = list ?? { ordered: true, items: [] };
      list.items.push(ordered[1]);
      return;
    }
    flush();
    if (line.trim() === "") return;
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    out.push(
      heading ? (
        <div
          key={`h-${idx}`}
          style={{
            fontSize: heading[1].length === 1 ? 15 : 14,
            fontWeight: 700,
            marginTop: 4,
            color: tokens.text,
          }}
        >
          <Inline text={heading[2]} />
        </div>
      ) : (
        <p key={`p-${idx}`} style={{ margin: 0, minHeight: line ? undefined : 4 }}>
          <Inline text={line} />
        </p>
      ),
    );
  });
  flush();
  return <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>{out}</div>;
}

/** Inline markdown: **bold**, *italic*, `code`, and bare links. */
function Inline({ text }: { text: string }) {
  const { tokens } = useTheme();
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|https?:\/\/[^\s)]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      parts.push(
        <strong key={key++} style={{ fontWeight: 700 }}>
          {tok.slice(2, -2)}
        </strong>,
      );
    } else if (tok.startsWith("`")) {
      parts.push(
        <code
          key={key++}
          style={{
            fontFamily: "var(--rook-mono)",
            fontSize: "0.92em",
            background: tokens.surfaceAlt,
            border: `1px solid ${tokens.line}`,
            borderRadius: 5,
            padding: "1px 4px",
          }}
        >
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith("*")) {
      parts.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    } else {
      parts.push(
        <a
          key={key++}
          href={tok}
          target="_blank"
          rel="noreferrer"
          style={{ color: tokens.accent, textDecoration: "underline" }}
        >
          {tok.length > 60 ? tok.slice(0, 57) + "…" : tok}
        </a>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

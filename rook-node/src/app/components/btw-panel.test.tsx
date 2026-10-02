import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/theme", () => ({
  useTheme: () => ({ tokens: { text: "t", textSoft: "s", textFaint: "f", line: "l", surfaceAlt: "a", accent: "x" } }),
}));
vi.mock("./markdown", () => ({ Markdown: ({ text }: { text: string }) => <p>{text}</p> }));
vi.mock("../lib/send-bridge", () => ({ currentToken: async () => null }));
vi.mock("../lib/api-base", () => ({ getApiBaseUrl: () => "http://x" }));

import { BtwBar } from "./btw-panel";
import type { BtwState } from "../../../../shared/btw-client";

const base: BtwState = { open: true, draft: "", question: "", text: "", status: "idle" };
const noop = () => undefined;
const render = (state: BtwState) =>
  renderToStaticMarkup(<BtwBar state={state} onChangeDraft={noop} onAsk={noop} onStop={noop} onDismiss={noop} />);
const answer = { text: "White blood cell", model: "m", requestId: "r", latencyMs: 1, firstTokenMs: 1, partial: false };

describe("desktop aside bar states", () => {
  it("hidden renders nothing", () => expect(render({ ...base, open: false })).toBe(""));

  it("open: slim input, placeholder, no card chrome, Send disabled", () => {
    const html = render(base);
    expect(html).toContain('placeholder="Ask a quick aside…"');
    expect(html).not.toMatch(/Side question|stays outside the chat/);
    expect(html).toMatch(/aria-label="Send aside"[^>]*disabled/);
  });

  it("answering: input locked, Stop shown, partial text", () => {
    const html = render({ ...base, draft: "q", status: "answering", text: "White" });
    expect(html).toContain("Answering…");
    expect(html).toContain('aria-label="Stop aside"');
    expect(html).toContain("White");
  });

  it("answered: compact answer, dismiss available", () => {
    const html = render({ ...base, draft: "q", status: "done", text: answer.text, answer });
    expect(html).toContain("White blood cell");
    expect(html).toContain('aria-label="Dismiss aside"');
    expect(html).not.toContain("Answering…");
  });

  it("error: one line with Retry", () => {
    const html = render({ ...base, draft: "q", status: "error", error: "Could not connect" });
    expect(html).toContain("Could not connect");
    expect(html).toContain('aria-label="Retry aside"');
  });
});

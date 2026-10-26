import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Platform: { OS: "web" },
  View: ({ children, accessibilityLabel }: any) => <div aria-label={accessibilityLabel}>{children}</div>,
  Text: ({ children }: any) => <span>{children}</span>,
  ScrollView: ({ children }: any) => <section>{children}</section>,
  TextInput: ({ value, placeholder, editable, accessibilityLabel }: any) => (
    <input aria-label={accessibilityLabel} placeholder={placeholder} value={value} readOnly disabled={editable === false} />
  ),
  Pressable: ({ children, accessibilityLabel, disabled }: any) => (
    <button aria-label={accessibilityLabel} disabled={disabled}>{children}</button>
  ),
}));
vi.mock("../components/rook-primitives", () => ({
  useRookTheme: () => ({ colors: { text: "t", textSoft: "s", textFaint: "f", line: "l", surfaceAlt: "a", accent: "x" } }),
}));
vi.mock("../constants/oauth", () => ({ getApiBaseUrl: () => "http://x" }));
vi.mock("../lib/chat-markdown", () => ({
  parseChatMarkdown: (text: string) => [{ type: "paragraph", content: [{ text }] }],
}));

import { BtwBar as NativeBar } from "../components/btw-panel";
import { BtwController, type BtwState } from "../shared/btw-client";
import { btwKeyAction, btwTrigger } from "../shared/btw";

const base: BtwState = { open: true, draft: "", question: "", text: "", status: "idle" };
const states: Record<string, BtwState> = {
  hidden: { ...base, open: false },
  open: base,
  answering: { ...base, draft: "wbc?", question: "wbc?", status: "answering", text: "White" },
  answered: { ...base, draft: "wbc?", question: "wbc?", status: "done", text: "White blood cell",
    answer: { text: "White blood cell", model: "m", requestId: "r", latencyMs: 1, firstTokenMs: 1, partial: false } },
  error: { ...base, draft: "wbc?", status: "error", error: "Could not connect" },
};
const noop = () => undefined;
const renderers = {
  native: (state: BtwState) => renderToStaticMarkup(<NativeBar state={state} onChangeDraft={noop} onAsk={noop} onStop={noop} onDismiss={noop} />),
};

describe("native aside bar states", () => {
  const render = renderers.native;
  it("renders nothing when hidden (also after dismiss)", () => {
    expect(render(states.hidden)).toBe("");
  });

  it("open: one slim input with the placeholder, no card chrome, disabled Send", () => {
    const html = render(states.open);
    expect(html).toContain('placeholder="Ask a quick aside…"');
    expect(html).toContain("/btw");
    expect(html).not.toMatch(/Side question|stays outside the chat|Answering/);
    expect(html).toMatch(/aria-label="Send aside"[^>]*disabled/);
    expect(html).toContain('aria-label="Dismiss aside"');
  });

  it("answering: input locked, Stop replaces Send, partial text shows", () => {
    const html = render(states.answering);
    expect(html).toContain("Answering…");
    expect(html).toContain('aria-label="Stop aside"');
    expect(html).not.toContain('aria-label="Send aside"');
    expect(html).toContain("White");
    expect(html).toMatch(/<input[^>]*disabled/);
  });

  it("answered: compact answer, dismissible, Send available, no model footer", () => {
    const html = render(states.answered);
    expect(html).toContain("White blood cell");
    expect(html).toContain('aria-label="Dismiss aside"');
    expect(html).not.toContain("Answering…");
    expect(html).not.toMatch(/>m</);
  });

  it("error: one line with Retry", () => {
    const html = render(states.error);
    expect(html).toContain("Could not connect");
    expect(html).toContain('aria-label="Retry aside"');
  });
});

describe("trigger and keys", () => {
  it("opens on '/btw ' only, seeding the rest; plain text and near-misses are untouched", () => {
    expect(btwTrigger("/btw ")).toBe("");
    expect(btwTrigger("/btw what is a wbc")).toBe("what is a wbc");
    expect(btwTrigger("/btw")).toBeNull();
    expect(btwTrigger("/btwice")).toBeNull();
    expect(btwTrigger("explain /btw x")).toBeNull();
    expect(btwTrigger("hello")).toBeNull();
  });

  it("Esc dismisses in every state; Enter asks except while answering or composing", () => {
    for (const status of ["idle", "answering", "done", "error"] as const) {
      expect(btwKeyAction({ key: "Escape" }, status)).toBe("dismiss");
    }
    expect(btwKeyAction({ key: "Enter" }, "idle")).toBe("ask");
    expect(btwKeyAction({ key: "Enter" }, "done")).toBe("ask");
    expect(btwKeyAction({ key: "Enter" }, "error")).toBe("ask");
    expect(btwKeyAction({ key: "Enter" }, "answering")).toBe("none");
    expect(btwKeyAction({ key: "Enter", shiftKey: true }, "idle")).toBe("none");
    expect(btwKeyAction({ key: "Enter", isComposing: true }, "idle")).toBe("none");
    expect(btwKeyAction({ key: "Enter", keyCode: 229 }, "idle")).toBe("none");
  });

  it("dismiss from open, answering and answered all return to hidden and cancel in-flight work", async () => {
    let release!: () => void;
    const answer = { text: "A", model: "m", requestId: "r", latencyMs: 1, firstTokenMs: 1, partial: false };
    const controller = new BtwController(async (_q, signal) => {
      await new Promise<void>((resolve) => { release = resolve; signal.addEventListener("abort", () => resolve()); });
      return answer;
    });
    controller.open("");
    controller.dismiss();
    expect(controller.snapshot().open).toBe(false);

    controller.open("q");
    const running = controller.ask();
    expect(controller.snapshot().status).toBe("answering");
    controller.dismiss();
    await running;
    expect(controller.snapshot()).toMatchObject({ open: false, text: "", status: "idle" });

    controller.open("q2");
    const second = controller.ask();
    release();
    await second;
    expect(controller.snapshot().status).toBe("done");
    controller.dismiss();
    expect(controller.snapshot()).toMatchObject({ open: false, text: "", answer: undefined });
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { BtwController, requestBtw } from "../shared/btw-client";
import { boundedBtwContext, parseBtwCommand, type BtwAnswer } from "../shared/btw";

const answer: BtwAnswer = { text: "White blood cell", model: "fixture", requestId: "aside", latencyMs: 12, firstTokenMs: 3, partial: false };
const body = { botId: "scout", botName: "Scout", question: "WBC?", context: [] };
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; };
afterEach(() => vi.unstubAllGlobals());

describe("side question isolation", () => {
  it("recognizes only explicit commands and keeps bounded context chronological", () => {
    expect(parseBtwCommand(" /btw WBC? ")).toBe("WBC?");
    expect(parseBtwCommand("/btw")).toBe("");
    expect(parseBtwCommand("explain /btw")).toBeNull();
    expect(parseBtwCommand("/btwice")).toBeNull();
    expect(boundedBtwContext(Array.from({ length: 10 }, (_, n) => ({ author: "user" as const, body: String(n).repeat(2500) }))))
      .toEqual([7, 8, 9].map((n) => ({ author: "user", body: String(n).repeat(2000) })));
  });

  it("discards late tokens and completion after dismiss, even if transport ignores abort", async () => {
    const pending = deferred<BtwAnswer>();
    let emit!: (text: string) => void;
    let signal!: AbortSignal;
    const controller = new BtwController(async (_q, s, token) => { signal = s; emit = token; return pending.promise; });
    controller.open("WBC?");
    const running = controller.ask();
    emit("White");
    expect(controller.snapshot().text).toBe("White");
    controller.dismiss();
    expect(signal.aborted).toBe(true);
    emit(" stale"); pending.resolve(answer); await running;
    expect(controller.snapshot()).toMatchObject({ open: false, text: "", draft: "", status: "idle" });
  });

  it("stop and retry cannot be overwritten by an older answer; main state stays independent", async () => {
    const old = deferred<BtwAnswer>();
    const main = { draft: "Finish the report", attachments: ["report.pdf"], abort: new AbortController() };
    const transport = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce({ ...answer, text: "new answer" });
    const controller = new BtwController(transport);
    controller.open("first"); const first = controller.ask();
    await controller.ask(); expect(transport).toHaveBeenCalledTimes(1);
    controller.cancel(); controller.setDraft("second"); await controller.ask();
    old.resolve(answer); await first;
    expect(controller.snapshot()).toMatchObject({ question: "second", text: "new answer", status: "done" });
    expect(main).toMatchObject({ draft: "Finish the report", attachments: ["report.pdf"] });
    expect(main.abort.signal.aborted).toBe(false);
  });

  it("shows failures with partial text and supports retry", async () => {
    const transport = vi.fn().mockImplementationOnce(async (_q, _s, token) => { token("partial"); throw new Error("offline"); }).mockResolvedValueOnce(answer);
    const controller = new BtwController(transport);
    controller.open("WBC?"); await controller.ask();
    expect(controller.snapshot()).toMatchObject({ text: "partial", status: "error", error: "offline" });
    await controller.ask(); expect(controller.snapshot()).toMatchObject({ text: answer.text, status: "done", error: undefined });
  });
});

describe("side question transport", () => {
  const request = (onToken = vi.fn(), signal = new AbortController().signal) => requestBtw({ baseUrl: "https://fixture.invalid/", getToken: async () => "fixture-token", body, signal, onToken, streaming: true });
  it("parses split SSE frames and Unicode without making a second model request", async () => {
    const data = new TextEncoder().encode(`data: ${JSON.stringify({ kind: "token", delta: "cell 🧬" })}\r\n\r\ndata: ${JSON.stringify({ kind: "done", result: answer })}\n\n`);
    const fetcher = vi.fn(async () => new Response(new ReadableStream({ start(c) { for (const byte of data) c.enqueue(Uint8Array.of(byte)); c.close(); } }), { headers: { "Content-Type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetcher); const token = vi.fn();
    await expect(request(token)).resolves.toEqual(answer);
    expect(token).toHaveBeenCalledWith("cell 🧬"); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("uses the same buffered SSE response on native and accepts JSON fallback", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, headers: new Headers({ "Content-Type": "text/event-stream" }), body: null,
      text: async () => `data: ${JSON.stringify({ kind: "done", result: answer })}\n\n` }).mockResolvedValueOnce(Response.json(answer));
    vi.stubGlobal("fetch", fetcher);
    await expect(request()).resolves.toEqual(answer); expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(request()).resolves.toEqual(answer); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("rejects an incomplete stream and authenticated HTTP failures without retrying", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('data: {"kind":"token","delta":"partial"}\n\n', { headers: { "Content-Type": "text/event-stream" } }))
      .mockResolvedValueOnce(Response.json({ error: "Sign in" }, { status: 401 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(request()).rejects.toThrow("interrupted");
    await expect(request()).rejects.toThrow("Sign in"); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("does not send after cancellation during token acquisition", async () => {
    const token = deferred<string>(); const abort = new AbortController(); const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const pending = requestBtw({ baseUrl: "", getToken: () => token.promise, body, signal: abort.signal, onToken: vi.fn(), streaming: false });
    abort.abort(); token.resolve("token"); await expect(pending).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
  });
  it("supports native AbortSignal polyfills without throwIfAborted", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(answer)));
    const signal = { aborted: false } as AbortSignal;
    await expect(request(undefined, signal)).resolves.toEqual(answer);
    Object.assign(signal, { aborted: true });
    await expect(request(undefined, signal)).rejects.toThrow("cancelled");
  });
});

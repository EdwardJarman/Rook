import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
vi.mock("../server/ai/openai-stream", () => ({ invokeAiStream: vi.fn() }));
import { registerBtwRoute } from "../server/btw-route";
import { transientClerkUser } from "../server/clerk-auth";
import type { BtwAnswer } from "../shared/btw";

let server: Server; let base: string;
const result: BtwAnswer = { text: "White blood cell", model: "fixture", requestId: "aside", latencyMs: 5, firstTokenMs: 1, partial: false };
const body = { botId: "bot", botName: "Scout", question: "WBC?", context: [] };
const answer = vi.fn();
const authenticate = vi.fn(async () => transientClerkUser({ clerkUserId: "fixture", name: null, email: null }));
beforeAll(async () => {
  const app = express(); app.use(express.json()); registerBtwRoute(app, { authenticate, answer });
  server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/agent/btw`;
});
afterAll(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
beforeEach(() => { vi.clearAllMocks(); answer.mockImplementation(async (_input, token) => { token?.("White "); return result; }); });
const post = (data: unknown = body, accept = "application/json", signal?: AbortSignal) => fetch(base, { method: "POST", headers: { "Content-Type": "application/json", Accept: accept }, body: JSON.stringify(data), signal });
it("requires auth and validates input before invoking a provider", async () => {
  authenticate.mockRejectedValueOnce(new Error("private auth failure"));
  expect((await post()).status).toBe(401);
  expect((await post({ ...body, question: "" })).status).toBe(400);
  expect(answer).not.toHaveBeenCalled();
});
it("returns JSON or SSE through the same one-call service contract", async () => {
  await expect((await post()).json()).resolves.toEqual(result);
  const stream = await post(body, "text/event-stream"); const text = await stream.text();
  expect(text).toContain('"kind":"token"'); expect(text).toContain('"kind":"done"');
  expect(answer).toHaveBeenCalledTimes(2);
  expect(answer.mock.calls[0][0].userId).toBe("transient:clerk:fixture");
});
it("holds one request per owner and frees the slot after disconnect", async () => {
  let disconnected!: () => void;
  const closed = new Promise<void>((resolve) => { disconnected = resolve; });
  answer.mockImplementationOnce((_input, _token, signal: AbortSignal) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => { disconnected(); reject(new Error("cancelled")); }, { once: true });
  }));
  const abort = new AbortController(); const stream = await post(body, "text/event-stream", abort.signal);
  expect(stream.status).toBe(200);
  expect((await post()).status).toBe(429);
  abort.abort(); await closed;
  await expect((await post()).json()).resolves.toEqual(result);
});
it("does not expose provider errors and releases the owner slot after a failure", async () => {
  answer.mockRejectedValueOnce(new Error("sensitive upstream detail"));
  const response = await post(); expect(response.status).toBe(502);
  expect(await response.text()).not.toContain("sensitive");
  expect((await post()).status).toBe(200);
});

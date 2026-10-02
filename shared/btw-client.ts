import type { BtwAnswer, BtwEvent, BtwInput } from "./btw";

// React Native's AbortController polyfill need not implement throwIfAborted().
function throwIfCancelled(signal: AbortSignal) {
  if (!signal.aborted) return;
  const error = new Error("Side question cancelled.");
  error.name = "AbortError";
  throw error;
}

export async function requestBtw(input: {
  baseUrl: string; getToken: () => Promise<string | null>; body: BtwInput;
  signal: AbortSignal; onToken: (text: string) => void; streaming: boolean;
}): Promise<BtwAnswer> {
  const token = await input.getToken();
  throwIfCancelled(input.signal);
  if (!token) throw new Error("Sign in to ask a side question.");
  const response = await fetch(`${input.baseUrl.replace(/\/$/, "")}/api/agent/btw`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json",
      Accept: input.streaming ? "text/event-stream" : "application/json" },
    body: JSON.stringify(input.body), signal: input.signal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.error === "string" ? body.error.slice(0, 300) : "The side question could not connect. Try again.");
  }
  if (!(response.headers.get("content-type") ?? "").includes("text/event-stream")) {
    const answer = validateAnswer(await response.json());
    throwIfCancelled(input.signal);
    return answer;
  }
  let result: BtwAnswer | undefined;
  let buffer = "";
  const accept = (block: string) => {
    const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
    if (!data || data === "[DONE]") return;
    const event = JSON.parse(data) as BtwEvent;
    if (event.kind === "token" && typeof event.delta === "string") input.onToken(event.delta);
    else if (event.kind === "done") result = validateAnswer(event.result);
    else if (event.kind === "error") throw new Error(event.message);
  };
  const feed = (text: string, final = false) => {
    buffer += text;
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";
    blocks.forEach(accept);
    if (final && buffer.trim()) { accept(buffer); buffer = ""; }
  };
  // React Native may expose a buffered response only. Consume that same response; never regenerate.
  if (!response.body?.getReader || typeof TextDecoder === "undefined") feed(await response.text(), true);
  else {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (!result) {
        throwIfCancelled(input.signal);
        const chunk = await reader.read();
        if (chunk.done) { feed(decoder.decode(), true); break; }
        feed(decoder.decode(chunk.value, { stream: true }));
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  throwIfCancelled(input.signal);
  if (!result) throw new Error("The side answer was interrupted. You can retry without affecting your main work.");
  return result;
}

function validateAnswer(value: unknown): BtwAnswer {
  const answer = value as BtwAnswer | undefined;
  if (!answer || typeof answer.text !== "string" || typeof answer.model !== "string" || typeof answer.requestId !== "string") {
    throw new Error("The side answer could not be read. Try again.");
  }
  return answer;
}

export type BtwState = {
  open: boolean; draft: string; question: string; text: string;
  status: "idle" | "answering" | "done" | "error"; error?: string; answer?: BtwAnswer;
};
export type BtwTransport = (question: string, signal: AbortSignal, onToken: (text: string) => void) => Promise<BtwAnswer>;

/** Separate state and generation identity prevent late answers from reviving a dismissed panel. */
export class BtwController {
  private state: BtwState = { open: false, draft: "", question: "", text: "", status: "idle" };
  private generation = 0;
  private abort?: AbortController;
  private listeners = new Set<() => void>();
  constructor(private readonly transport: BtwTransport) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private change(update: Partial<BtwState>) { this.state = { ...this.state, ...update }; this.listeners.forEach((fn) => fn()); }
  open = (draft?: string) => { this.change({ open: true, ...(draft === undefined ? {} : { draft }) }); };
  setDraft = (draft: string) => { this.change({ draft }); };
  cancel = () => {
    this.generation += 1; this.abort?.abort(); this.abort = undefined;
    this.change({ status: "idle" });
  };
  dismiss = () => { this.cancel(); this.change({ open: false, draft: "", question: "", text: "", answer: undefined, error: undefined }); };
  ask = async () => {
    const question = this.state.draft.trim();
    if (!question || this.state.status === "answering") return;
    this.abort?.abort();
    const controller = new AbortController(); this.abort = controller;
    const generation = ++this.generation;
    this.change({ open: true, question, text: "", status: "answering", error: undefined, answer: undefined });
    try {
      const answer = await this.transport(question, controller.signal, (text) => {
        if (this.generation === generation) this.change({ text: this.state.text + text });
      });
      if (this.generation === generation) this.change({ text: answer.text, status: "done", answer });
    } catch (error) {
      if (this.generation === generation) this.change({ status: "error", error: error instanceof Error ? error.message : "The side answer failed. Try again." });
    } finally { if (this.generation === generation) this.abort = undefined; }
  };
}

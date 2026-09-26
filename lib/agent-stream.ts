/**
 * Best-effort SSE client for POST /api/agent/stream.
 *
 * Contract: resolves with the turn's full result on the `done` event
 * (same shape as `trpc.workroom.reply`), and THROWS on anything else —
 * non-200 status, missing body, malformed stream, mid-stream `error`
 * event, or abort. Callers fall back to the `workroom.reply` mutation,
 * which stays the supported reply path.
 *
 * Token/progress callbacks are fire-and-forget render hints; the `done`
 * result is the source of truth the caller persists.
 *
 * `baseUrl` is injected (not imported) so this module stays free of
 * Expo/native dependencies and unit-testable under plain vitest.
 */

export type AgentStreamTraceStep = {
  kind: "context" | "response" | "search" | "source" | "tool" | "approval";
  title: string;
  detail?: string;
  url?: string;
};

export type AgentStreamReply = {
  text: string;
  model: string;
  approvals: Array<{
    actionId: string;
    title: string;
    detail: string;
    risk: "Medium";
  }>;
  computerProposals: Array<{ proposalId: string; title: string; url?: string; detail?: string }>;
  suggestedMemories: Array<{ key: string; value: string }>;
  trace: AgentStreamTraceStep[];
  /** Agent-built files (OpenCode turns): openable in the browser. */
  files?: Array<{ name: string; mimeType: string; content: string }>;
  pushDelivery?: { accepted: boolean; recipients: number };
};

export type AgentStreamCallbacks = {
  onToken?: (delta: string) => void;
  onTrace?: (step: AgentStreamTraceStep) => void;
  /** Set when a tool ran — caller must NOT retry via mutation (would double up approvals). */
  onToolActivity?: () => void;
};

const SSE_EVENT_SPLIT = /\r?\n\r?\n/;

export function supportsAgentStream(): boolean {
  try {
    return (
      typeof fetch === "function" &&
      typeof TextDecoder === "function" &&
      typeof AbortController === "function" &&
      typeof ReadableStream === "function"
    );
  } catch {
    return false;
  }
}

/** True only when the response body can actually be read as a stream. */
function hasStreamBody(response: Response): boolean {
  try {
    return (
      Boolean(response.body) &&
      typeof (response.body as ReadableStream | null)?.getReader === "function"
    );
  } catch {
    return false;
  }
}

export async function streamAgentReply(input: {
  baseUrl: string;
  body: Record<string, unknown>;
  getToken: () => Promise<string | null>;
  signal?: AbortSignal;
  callbacks?: AgentStreamCallbacks;
}): Promise<AgentStreamReply> {
  if (!supportsAgentStream()) throw new Error("Streaming not supported here.");
  const token = await input.getToken().catch(() => null);
  const response = await fetch(`${input.baseUrl.replace(/\/$/, "")}/api/agent/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(input.body),
    signal: input.signal,
  });
  if (!response.ok || !hasStreamBody(response)) {
    throw new Error(`Stream unavailable (${response.status}).`);
  }

  const reader = (response.body as ReadableStream).getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const finish = () => {
    try {
      reader.releaseLock();
    } catch {
      // Already closed.
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split(SSE_EVENT_SPLIT);
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const data = part
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice("data:".length).trim())
          .join("\n")
          .trim();
        if (!data || data === "[DONE]") continue;
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(data) as Record<string, unknown>;
        } catch {
          continue;
        }
        switch (event.kind) {
          case "token":
            if (typeof event.delta === "string" && event.delta) {
              input.callbacks?.onToken?.(event.delta);
            }
            break;
          case "trace": {
            const step = event.step as AgentStreamTraceStep | undefined;
            if (step && typeof step.title === "string") {
              input.callbacks?.onTrace?.(step);
              if (step.kind === "tool" || step.kind === "approval") {
                input.callbacks?.onToolActivity?.();
              }
            }
            break;
          }
          case "approval":
          case "proposal":
            input.callbacks?.onToolActivity?.();
            break;
          case "error":
            throw new Error(
              typeof event.message === "string" && event.message
                ? event.message
                : "The live reply failed.",
            );
          case "done": {
            const result = event.result as AgentStreamReply | undefined;
            if (!result || typeof result.text !== "string") {
              throw new Error("The live reply ended without a result.");
            }
            return result;
          }
          default:
            break;
        }
      }
    }
  } finally {
    finish();
  }
  throw new Error("The live reply ended before finishing.");
}

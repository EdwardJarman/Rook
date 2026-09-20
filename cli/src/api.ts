/**
 * Minimal Rook API client: tRPC batch calls (superjson envelope) plus the
 * raw SSE agent stream. Mirrors lib/agent-stream.ts framing on purpose —
 * same contract, no shared code (the CLI ships self-contained).
 */

import superjson from "superjson";

import type { CliProfile } from "./config.js";

export class ApiError extends Error {
  status?: number;
  code?: string;
  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

const unreachable = (apiUrl: string): ApiError =>
  new ApiError(
    `Rook server is unreachable at ${apiUrl}. Start it (or point --api-url at a live one).`,
  );

async function authedFetch(
  profile: CliProfile,
  path: string,
  init?: RequestInit & { anonymous?: boolean },
): Promise<Response> {
  if (!profile.token && !init?.anonymous) {
    throw new ApiError("Not signed in. Run `rook login` first.", undefined, "UNAUTHORIZED");
  }
  let response: Response;
  try {
    response = await fetch(`${profile.apiUrl.replace(/\/+$/, "")}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        // No keep-alive pooling: force-exiting (fatal()) with pooled
        // undici sockets trips a libuv assertion on Windows (Node 24).
        // One connection per CLI call is plenty.
        Connection: "close",
        ...(profile.token ? { Authorization: `Bearer ${profile.token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch (error) {
    // Timeouts and user aborts must surface as-is, never as "unreachable".
    const signal = init?.signal as AbortSignal | undefined;
    if (signal?.aborted) throw error;
    throw unreachable(profile.apiUrl);
  }
  return response;
}

type TrpcBatchItem =
  | { result: { data: { json: unknown; meta?: unknown } } }
  | { error: { message?: string; data?: { code?: string; httpStatus?: number } } };

/**
 * One tRPC call, batch-of-one. Queries ride GET (the server answers 405
 * to POSTed queries); mutations must POST. Returns deserialized data.
 */
export async function trpc<T>(
  profile: CliProfile,
  procPath: string,
  input?: unknown,
  opts?: { method?: "GET" | "POST"; timeoutMs?: number; signal?: AbortSignal; anonymous?: boolean },
): Promise<T> {
  const method = opts?.method ?? "GET";
  const path =
    method === "GET"
      ? `/api/trpc/${procPath}?batch=1&input=${encodeURIComponent(
          JSON.stringify({ "0": { json: input ?? null } }),
        )}`
      : `/api/trpc/${procPath}?batch=1`;
  // Fast metadata calls pass timeoutMs so a wedged server fails loudly
  // instead of hanging the terminal forever. Long turns (workroom.reply)
  // deliberately pass none.
  const signals: AbortSignal[] = [];
  if (opts?.signal) signals.push(opts.signal);
  if (opts?.timeoutMs) signals.push(AbortSignal.timeout(opts.timeoutMs));
  const signal =
    signals.length > 1 && typeof AbortSignal.any === "function"
      ? AbortSignal.any(signals)
      : (signals[0] ?? undefined);
  let response: Response;
  try {
    response = await authedFetch(profile, path, {
      method,
      ...(method === "POST" ? { body: JSON.stringify({ "0": { json: input ?? null } }) } : {}),
      ...(signal ? { signal } : {}),
      ...(opts?.anonymous ? { anonymous: true as const } : {}),
    });
  } catch (error) {
    if (opts?.timeoutMs && error instanceof Error && error.name === "TimeoutError") {
      throw new ApiError(
        `Rook server took too long to answer (${profile.apiUrl}). Is it overloaded? Try again.`,
      );
    }
    throw error;
  }
  if (response.status === 401 || response.status === 403) {
    throw new ApiError(
      "Sign-in expired or rejected. Run `rook login` again.",
      response.status,
      "UNAUTHORIZED",
    );
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError(`Rook server answered oddly (HTTP ${response.status}).`);
  }
  const items = (Array.isArray(payload) ? payload : [payload]) as TrpcBatchItem[];
  const item = items[0];
  if (!item || "error" in item) {
    const message =
      (item && "error" in item && item.error.message) || `Request failed (HTTP ${response.status}).`;
    const code = item && "error" in item ? item.error.data?.code : undefined;
    if (code === "UNAUTHORIZED") {
      throw new ApiError("Sign-in expired or rejected. Run `rook login` again.", response.status, code);
    }
    throw new ApiError(message, response.status, code);
  }
  // Envelope is superjson-shaped by construction (server transformer);
  // the cast below only bridges its structural type to superjson's.
  const envelope = item.result.data as Parameters<typeof superjson.deserialize>[0];
  return superjson.deserialize(envelope) as T;
}

export type StreamTraceStep = {
  kind: string;
  title: string;
  detail?: string;
  url?: string;
};

export type StreamDone = {
  text: string;
  model?: string;
  files?: Array<{ name: string; mimeType: string; content: string }>;
  approvals?: unknown[];
  computerProposals?: unknown[];
  suggestedMemories?: unknown[];
  trace?: StreamTraceStep[];
};

export type StreamCallbacks = {
  onToken?: (delta: string) => void;
  onTrace?: (step: StreamTraceStep) => void;
  onToolActivity?: () => void;
};

/** POST /api/agent/stream, forwarding live events. Resolves on `done`. */
export async function streamAgentRound(
  profile: CliProfile,
  body: Record<string, unknown>,
  callbacks: StreamCallbacks = {},
  signal?: AbortSignal,
): Promise<StreamDone> {
  const response = await authedFetch(
    profile,
    "/api/agent/stream",
    { method: "POST", body: JSON.stringify(body), signal },
  );
  if (!response.ok || !response.body) {
    if (response.status === 401 || response.status === 403) {
      throw new ApiError("Sign-in expired or rejected. Run `rook login` again.", response.status);
    }
    throw new ApiError(`Live reply unavailable (HTTP ${response.status}).`);
  }
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const handlePart = (part: string): StreamDone | undefined => {
    const data = part
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trim())
      .join("\n")
      .trim();
    if (!data || data === "[DONE]") return undefined;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return undefined;
    }
    switch (event.kind) {
      case "token":
        if (typeof event.delta === "string" && event.delta) callbacks.onToken?.(event.delta);
        break;
      case "trace": {
        const step = event.step as StreamTraceStep | undefined;
        if (step && typeof step.title === "string") {
          callbacks.onTrace?.(step);
          if (step.kind === "tool" || step.kind === "approval") callbacks.onToolActivity?.();
        }
        break;
      }
      case "approval":
      case "proposal":
        callbacks.onToolActivity?.();
        break;
      case "error":
        throw new Error(
          typeof event.message === "string" && event.message
            ? event.message
            : "The live reply failed.",
        );
      case "done": {
        const result = event.result as StreamDone | undefined;
        if (!result || typeof result.text !== "string") {
          throw new Error("The live reply ended without a result.");
        }
        return result;
      }
      default:
        break;
    }
    return undefined;
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (!done && value) buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      // A stream can close with the last frame unterminated: flush the
      // tail on close instead of dropping a perfectly good `done`.
      buffer = done ? "" : (parts.pop() ?? "");
      for (const part of parts) {
        const result = handlePart(part);
        if (result) return result;
      }
      if (done) break;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Already closed.
    }
  }
  // User interruption wins over stream endings: the REPL shows its own
  // cancelled message, not a misleading "ended before finishing".
  if (signal?.aborted) {
    const abort = new Error("The operation was aborted", { cause: "signal" });
    abort.name = "AbortError";
    throw abort;
  }
  throw new Error("The live reply ended before finishing.");
}

/**
 * Connects the in-memory workroom to the live tRPC API.
 *
 * The Workroom route dispatches a `rook:send` CustomEvent when the user
 * sends a message. This module listens for those events, calls the server,
 * and reconciles the optimistic pending message with the real reply.
 *
 * Network and auth failures fall back to a friendly local placeholder reply
 * so the chat remains usable in development / offline.
 */
import { workroom } from "./workroom";
import { trpc, getTrpcClient } from "./trpc";

type SendDetail = {
  text: string;
  attachments: string[];
  botId: string;
  replyId: string;
  userMessageId: string;
};

let initialized = false;

export function mountSendBridge() {
  if (initialized) return () => undefined;
  initialized = true;
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<SendDetail>).detail;
    if (!detail) return;
    void deliver(detail);
  };
  window.addEventListener("rook:send", handler);
  return () => {
    window.removeEventListener("rook:send", handler);
    initialized = false;
  };
}

async function deliver(detail: SendDetail) {
  const { botId, replyId, text, userMessageId, attachments } = detail;
  const bot = workroom.get().bots.find((b) => b.id === botId);
  if (!bot) {
    workroom.updateMessage(replyId, {
      body:
        "I can't find that Bot on this computer. Open the Bots tab to create or re-add it.",
      pending: false,
    });
    return;
  }

  // Try the live tRPC call. If anything goes wrong, surface a useful
  // local message so the chat remains usable.
  try {
    const client = getTrpcClient(async () => {
      try {
        const w = window as unknown as { Clerk?: { session?: { getToken: () => Promise<string | null> } } };
        return (await w.Clerk?.session?.getToken?.()) ?? null;
      } catch {
        return null;
      }
    });
    if (!client) throw new Error("trpc client unavailable");
    // Cast: the desktop app types the router as `unknown` so the
    // server-side route surface remains version-agnostic. We assert the
    // expected shape at runtime.
    const router = (client as unknown as { workroom?: { reply: { mutate: (input: unknown) => Promise<unknown> } } })
      .workroom;
    if (!router?.reply) throw new Error("workroom.reply route not available");
    const result = (await router.reply.mutate({
      botId,
      taskId: userMessageId,
      botName: bot.name,
      botRole: bot.role,
      botPurpose: bot.purpose,
      message: text,
      recentContext: workroom
        .get()
        .messages.slice(-8)
        .map((m) => ({ author: m.author, body: m.body })),
    })) as { text?: string } | undefined;
    workroom.updateMessage(replyId, {
      body: result?.text?.trim() || "…",
      pending: false,
    });
  } catch (err) {
    workroom.updateMessage(replyId, {
      body: friendlyFallback(text, bot.name, attachments),
      pending: false,
    });
    console.warn("[rook] chat reply failed:", (err as Error).message);
  }
}

function friendlyFallback(text: string, name: string, attachments: string[]): string {
  const trimmed = text.trim();
  const at = attachments.length > 0 ? ` and the ${attachments.length} file${attachments.length === 1 ? "" : "s"} you attached` : "";
  return [
    `Hi — I'm ${name}.`,
    trimmed.length > 0
      ? `You said: “${trimmed.slice(0, 280)}${trimmed.length > 280 ? "…" : ""}”${at}.`
      : "",
    "Sign in to Rook and connect this computer to your account so I can run real tasks and bring back evidence.",
  ]
    .filter(Boolean)
    .join(" ");
}

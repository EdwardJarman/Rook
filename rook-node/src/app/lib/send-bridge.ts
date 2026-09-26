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
import { getTrpcClient } from "./trpc";
import {
  approvalsFromReply,
  filterChatContext,
  messageKindFor,
  replyTextOf,
  taskForSend,
  traceFromReply,
  turnNeedsDecision,
  type ReplyResult,
} from "./reply-artifacts";

type SendDetail = {
  text: string;
  attachments: string[];
  botId: string;
  replyId: string;
  userMessageId: string;
};

let initialized = false;

/**
 * Auth token source for tRPC calls. The Clerk context injects the real
 * getter (useAuth().getToken) once the provider mounts; the window.Clerk
 * global remains a fallback.
 */
let tokenGetter: (() => Promise<string | null>) | null = null;

export function setTokenGetter(getter: (() => Promise<string | null>) | null) {
  tokenGetter = getter;
}

/** Shared auth token source for imperative tRPC calls from desktop routes. */
export async function currentToken(): Promise<string | null> {
  if (tokenGetter) {
    try {
      return await tokenGetter();
    } catch {
      /* fall through to the global */
    }
  }
  try {
    const w = window as unknown as {
      Clerk?: { session?: { getToken: () => Promise<string | null> } };
    };
    return (await w.Clerk?.session?.getToken?.()) ?? null;
  } catch {
    return null;
  }
}

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
  const { botId, replyId, text, attachments } = detail;
  const bot = workroom.get().bots.find((b) => b.id === botId);
  if (!bot) {
    workroom.updateMessage(replyId, {
      body: "I can't find that Bot on this computer. Open the Bots tab to create or re-add it.",
      pending: false,
    });
    return;
  }

  const task = taskForSend({ botId, body: text });
  workroom.addTask(task);
  workroom.updateBot(botId, { status: "Working" });

  // Over-long messages fail server validation with a raw error payload —
  // refuse honestly up front instead of sending a doomed request.
  if (text.length > 4000) {
    workroom.updateTask(task.id, {
      status: "Failed",
      summary: "Message too long to send.",
      nextAction: "Shorten it and try again.",
    });
    workroom.updateBot(botId, { status: "Ready" });
    workroom.updateMessage(replyId, {
      body: `That message is ${text.length.toLocaleString()} characters; Rook sends up to 4,000 per turn. Shorten it or split it across messages — nothing was sent.`,
      pending: false,
    });
    return;
  }

  // Try the live tRPC call. If anything goes wrong, surface a useful
  // local message so the chat remains usable.
  try {
    const client = getTrpcClient(currentToken);
    if (!client) throw new Error("trpc client unavailable");
    // Cast: the desktop app types the router as `unknown` so the
    // server-side route surface remains version-agnostic. We assert the
    // expected shape at runtime.
    const router = (
      client as unknown as {
        workroom?: { reply: { mutate: (input: unknown) => Promise<unknown> } };
      }
    ).workroom;
    if (!router?.reply) throw new Error("workroom.reply route not available");
    const state = workroom.get();
    const result = (await router.reply.mutate({
      botId,
      taskId: task.id,
      botName: bot.name.slice(0, 80),
      botRole: bot.role.slice(0, 120),
      botPurpose: bot.purpose.slice(0, 500),
      model: bot.model && bot.model !== "auto" ? bot.model : undefined,
      message: text,
      userTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      botMemory: bot.memory.slice(0, 4000),
      recentContext: filterChatContext(state.messages, state.chatBotIds),
    })) as ReplyResult | undefined;
    const needsDecision = turnNeedsDecision(result);
    for (const approval of approvalsFromReply(result, { botId, taskId: task.id })) {
      workroom.addApproval(approval);
    }
    const memories = Array.isArray(result?.suggestedMemories)
      ? result.suggestedMemories.filter(
          (m): m is { key: string; value: string } =>
            typeof m?.key === "string" && typeof m?.value === "string",
        )
      : [];
    if (memories.length) workroom.updateBotMemory(botId, memories);
    workroom.updateTask(task.id, {
      status: needsDecision ? "Approval required" : "Completed",
      summary: needsDecision
        ? "Review the proposal in Approvals."
        : "Result returned. You can refine or start a new task.",
      nextAction: needsDecision
        ? "Approve or decline in Approvals."
        : "Review the result and decide what happens next.",
    });
    workroom.updateBot(botId, { status: "Ready", lastActive: "just now" });
    workroom.updateMessage(replyId, {
      body: replyTextOf(result),
      pending: false,
      kind: messageKindFor(result),
      taskId: task.id,
      trace: traceFromReply(result),
    });
  } catch (err) {
    const authenticated = Boolean(await currentToken().catch(() => null));
    workroom.updateTask(task.id, {
      status: "Failed",
      summary: "The reply did not arrive.",
      nextAction: "Check your connection and send it again.",
    });
    workroom.updateBot(botId, { status: "Ready" });
    workroom.updateMessage(replyId, {
      body: friendlyFallback(text, bot.name, attachments, authenticated),
      pending: false,
    });
    console.warn("[rook] chat reply failed:", (err as Error).message);
  }
}

function friendlyFallback(
  text: string,
  name: string,
  attachments: string[],
  authenticated: boolean,
): string {
  const trimmed = text.trim();
  const at =
    attachments.length > 0
      ? ` and the ${attachments.length} file${attachments.length === 1 ? "" : "s"} you attached`
      : "";
  if (authenticated) {
    return [
      `I couldn't reach the Rook service just now, ${name ? `this is ${name}` : ""}.`.trim(),
      trimmed.length > 0
        ? `I have your message: “${trimmed.slice(0, 280)}${trimmed.length > 280 ? "…" : ""}”${at}.`
        : "",
      "Check your internet connection and send it again — your message is safe here.",
    ]
      .filter(Boolean)
      .join(" ");
  }
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

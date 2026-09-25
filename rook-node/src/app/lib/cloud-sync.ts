/**
 * Cloud workroom sync for the desktop window (D2 loop goal: same login →
 * same bots and chats on mobile and desktop).
 *
 * Protocol (deliberately conservative):
 * - Boot: if the desktop has NO bots of its own and the cloud snapshot has
 *   bots, adopt the cloud's bots + live messages + tasks (mapped to desktop
 *   shapes). A desktop that already has local state never gets clobbered.
 * - Save: debounced read-modify-write. We reload the cloud snapshot first
 *   and only replace the three arrays the desktop owns
 *   (bots/messages/tasks), preserving everything else (approvals, files,
 *   skills, …) so a desktop save can never wipe mobile data.
 * - No token (signed out) → silent no-op. Any failure → silent no-op with
 *   a console warning; local-first always wins.
 *
 * Known limitation (shared with mobile-vs-mobile today): concurrent edits
 * on two devices are last-write-wins per array. No merge UI — yet.
 */
import { currentToken } from "./send-bridge";
import { getTrpcClient } from "./trpc";
import { workroom, type Bot, type Message, type Task } from "./workroom";

type CloudSnapshot = {
  selectedBotId?: unknown;
  onboardingComplete?: unknown;
  aiProvider?: unknown;
  bots?: unknown;
  messages?: unknown;
  tasks?: unknown;
  skills?: unknown;
  routines?: unknown;
  approvals?: unknown;
  files?: unknown;
  notifications?: unknown;
  activity?: unknown;
} & Record<string, unknown>;

type CloudLoadResult = { snapshot?: CloudSnapshot | null; updatedAt?: unknown } | null;

type CloudRouter = {
  load: { query: (input: unknown) => Promise<CloudLoadResult> };
  save: { mutate: (input: { snapshot: Record<string, unknown> }) => Promise<{ saved?: boolean }> };
};

function cloudRouter() {
  const client = getTrpcClient(currentToken);
  return client as unknown as { cloud: CloudRouter };
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const str = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const strArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

/** Mobile Bot → desktop Bot (avatar falls back to the name initial). */
export function mapCloudBot(raw: unknown): Bot | null {
  const b = asRecord(raw);
  if (typeof b.id !== "string" || !b.id || typeof b.name !== "string" || !b.name) return null;
  const status = b.status === "Working" || b.status === "Paused" ? b.status : "Ready";
  return {
    id: b.id,
    name: b.name,
    role: str(b.role, "Assistant"),
    purpose: str(b.purpose, ""),
    color: str(b.color, "#177149"),
    icon: str(b.icon, "sparkles"),
    status,
    model: str(b.model, "auto"),
    lastActive: str(b.lastActive, ""),
    memory: str(b.memory, ""),
    approvalRule: str(b.approvalRule, "Ask before risky actions"),
  };
}

/** Mobile message → desktop message (drops fields the desktop has no UI for). */
export function mapCloudMessage(raw: unknown): Message | null {
  const m = asRecord(raw);
  if (typeof m.id !== "string" || !m.id || typeof m.body !== "string") return null;
  if (m.author !== "user" && m.author !== "bot" && m.author !== "system") return null;
  const kind =
    m.kind === "message" || m.kind === "activity" || m.kind === "result" || m.kind === "approval" || m.kind === "handoff"
      ? m.kind
      : undefined;
  const trace = Array.isArray(m.trace)
    ? m.trace
        .filter((s): s is Record<string, unknown> => Boolean(s && typeof s === "object"))
        .filter((s) => typeof s.title === "string" && s.title)
        .map((s) => ({
          kind: typeof s.kind === "string" ? s.kind : "tool",
          title: s.title as string,
          ...(typeof s.detail === "string" ? { detail: s.detail } : {}),
          ...(typeof s.url === "string" ? { url: s.url } : {}),
        }))
    : [];
  return {
    id: m.id,
    botId: typeof m.botId === "string" ? m.botId : null,
    author: m.author,
    body: m.body,
    createdAt: str(m.createdAt, new Date().toISOString()),
    ...(typeof m.taskId === "string" ? { taskId: m.taskId } : {}),
    ...(typeof m.attachmentName === "string" ? { attachmentName: m.attachmentName } : {}),
    ...(Array.isArray(m.imageUris) ? { imageUris: strArray(m.imageUris) } : {}),
    ...(typeof m.conversationId === "string" ? { conversationId: m.conversationId } : {}),
    ...(kind ? { kind } : {}),
    ...(trace.length ? { trace } : {}),
  };
}

/** Mobile task → desktop task (handoff history has no desktop UI yet). */
export function mapCloudTask(raw: unknown): Task | null {
  const t = asRecord(raw);
  if (typeof t.id !== "string" || !t.id || typeof t.botId !== "string") return null;
  const risk = t.risk === "Medium" || t.risk === "High" ? t.risk : "Low";
  const steps = asArray(t.steps)
    .filter((s) => s && typeof s === "object")
    .map((s) => {
      const r = asRecord(s);
      return {
        id: str(r.id, "step"),
        label: str(r.label, ""),
        state: (r.state === "done" || r.state === "active" ? r.state : "pending") as
          | "done"
          | "active"
          | "pending",
      };
    });
  return {
    id: t.id,
    botId: t.botId,
    title: str(t.title, "Task"),
    status: str(t.status, "Draft"),
    summary: str(t.summary, ""),
    startedAt: str(t.startedAt, new Date().toISOString()),
    nextAction: str(t.nextAction, ""),
    risk,
    steps: steps.length
      ? steps
      : [{ id: "work", label: "Do the work", state: "pending" as const }],
  };
}

/** Desktop Bot → mobile-shaped record (avatar derived, everything kept). */
export function unmapDesktopBot(bot: Bot): Record<string, unknown> {
  return {
    id: bot.id,
    name: bot.name,
    role: bot.role,
    purpose: bot.purpose,
    avatar: bot.name.trim().slice(0, 1).toUpperCase() || "?",
    color: bot.color,
    icon: bot.icon,
    status: bot.status,
    memory: bot.memory,
    approvalRule: bot.approvalRule,
    model: bot.model,
    lastActive: bot.lastActive,
  };
}

/** Desktop live message → mobile-shaped record (drops transient pending). */
export function unmapDesktopMessage(message: Message): Record<string, unknown> | null {
  if (message.pending) return null;
  return {
    id: message.id,
    botId: message.botId ?? "",
    author: message.author,
    body: message.body,
    createdAt: message.createdAt,
    ...(message.taskId ? { taskId: message.taskId } : {}),
    ...(message.attachmentName ? { attachmentName: message.attachmentName } : {}),
    ...(message.imageUris?.length ? { imageUris: message.imageUris } : {}),
    ...(message.conversationId ? { conversationId: message.conversationId } : {}),
    ...(message.kind ? { kind: message.kind } : {}),
    ...(message.trace?.length ? { trace: message.trace } : {}),
  };
}

/** Desktop task → mobile-shaped record. */
export function unmapDesktopTask(task: Task): Record<string, unknown> {
  return {
    id: task.id,
    botClientId: task.botId,
    botId: task.botId,
    title: task.title,
    status: task.status,
    summary: task.summary,
    startedAt: task.startedAt,
    nextAction: task.nextAction,
    risk: task.risk,
    steps: task.steps,
  };
}

async function loadSnapshot(): Promise<CloudSnapshot | null> {
  try {
    const token = await currentToken().catch(() => null);
    if (!token) return null;
    const result = await cloudRouter().cloud.load.query({});
    const snapshot = result?.snapshot;
    return snapshot && typeof snapshot === "object" ? (snapshot as CloudSnapshot) : null;
  } catch (error) {
    console.warn("[rook] cloud load failed (local-first):", (error as Error).message);
    return null;
  }
}

/** Adopt cloud bots/chats on a fresh desktop that has none of its own. */
export async function adoptCloudStateIfEmpty(): Promise<boolean> {
  const local = workroom.get();
  if (local.bots.length > 0) return false;
  const snapshot = await loadSnapshot();
  if (!snapshot) return false;
  const bots = asArray(snapshot.bots).map(mapCloudBot).filter((b): b is Bot => b !== null);
  if (!bots.length) return false;
  const messages = asArray(snapshot.messages)
    .map(mapCloudMessage)
    .filter((m): m is Message => m !== null)
    .slice(-200);
  const tasks = asArray(snapshot.tasks)
    .map(mapCloudTask)
    .filter((t): t is Task => t !== null)
    .slice(-100);
  workroom.hydrate({ bots, messages, tasks });
  if (bots.length && !workroom.get().activeChatBotId) {
    workroom.setActiveChat([bots[0].id], bots[0].id);
  }
  return true;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saving = false;

/** Debounced read-modify-write: desktop owns bots/messages/tasks only. */
export function scheduleCloudSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void saveNow();
  }, 3000);
}

export async function saveNow(): Promise<boolean> {
  if (saving) return false;
  saving = true;
  try {
    const token = await currentToken().catch(() => null);
    if (!token) return false;
    const base = (await loadSnapshot()) ?? {};
    const local = workroom.get();
    const snapshot: Record<string, unknown> = {
      ...base,
      bots: local.bots.map(unmapDesktopBot),
      messages: local.messages.map(unmapDesktopMessage).filter(Boolean).slice(-200),
      tasks: local.tasks.map(unmapDesktopTask).slice(-100),
    };
    const result = await cloudRouter().cloud.save.mutate({ snapshot });
    return result?.saved !== false;
  } catch (error) {
    console.warn("[rook] cloud save failed (local-first):", (error as Error).message);
    return false;
  } finally {
    saving = false;
  }
}

/** Mount once at boot: adopt if empty, then persist debounced on change. */
export function mountCloudSync(): () => void {
  void adoptCloudStateIfEmpty().catch(() => undefined);
  const unsubscribe = workroom.subscribe(() => scheduleCloudSave());
  return unsubscribe;
}

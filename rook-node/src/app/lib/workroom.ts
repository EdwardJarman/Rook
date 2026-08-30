/**
 * In-memory workroom model used by the desktop chat surface.
 *
 * Mirrors the Expo app's `useWorkroom()` shape so screens are easy to lift.
 * The desktop app receives its initial state from the tRPC `workroom.snapshot`
 * query; updates are pushed optimistically and reconciled on reply.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { useKv } from "./store";

export type Bot = {
  id: string;
  name: string;
  role: string;
  purpose: string;
  color: string;
  icon: string;
  status: "Ready" | "Working" | "Paused";
  model: string;
  lastActive: string;
  memory: string;
  approvalRule: string;
};

export type Message = {
  id: string;
  botId: string | null;
  author: "user" | "bot" | "system";
  body: string;
  createdAt: string;
  taskId?: string;
  attachmentName?: string;
  kind?: "message" | "activity" | "result" | "approval" | "handoff";
  pending?: boolean;
};

export type Task = {
  id: string;
  botId: string;
  title: string;
  status: string;
  summary: string;
  startedAt: string;
  nextAction: string;
  risk: "Low" | "Medium" | "High";
  steps: { id: string; label: string; state: "done" | "active" | "pending" }[];
};

export type Approval = {
  id: string;
  botId: string;
  taskId: string;
  summary: string;
  reason: string;
  capability: string;
  state: "pending" | "approved" | "declined" | "expired";
  createdAt: string;
  expiresAt: string;
};

export type Skill = {
  id: string;
  name: string;
  owner: string;
  status: "Enabled" | "Draft" | "Testing" | "Paused";
  description: string;
  version: string;
  updatedAt: string;
};

export type Routine = {
  id: string;
  name: string;
  schedule: string;
  status: "Active" | "Paused" | "Draft";
  owner: string;
  nextRun: string;
};

export type WorkroomState = {
  bots: Bot[];
  tasks: Task[];
  messages: Message[];
  approvals: Approval[];
  skills: Skill[];
  routines: Routine[];
  chatBotIds: string[];
  activeChatBotId: string | null;
  activeWorkspacePath: string | null;
};

const EMPTY: WorkroomState = {
  bots: [],
  tasks: [],
  messages: [],
  approvals: [],
  skills: [],
  routines: [],
  chatBotIds: [],
  activeChatBotId: null,
  activeWorkspacePath: null,
};

type Listener = (state: WorkroomState) => void;

class WorkroomStore {
  private state: WorkroomState = { ...EMPTY };
  private listeners = new Set<Listener>();

  get(): WorkroomState {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify() {
    for (const l of this.listeners) l(this.state);
  }

  hydrate(partial: Partial<WorkroomState>) {
    this.state = { ...this.state, ...partial };
    this.notify();
  }

  addMessage(msg: Message) {
    this.state = { ...this.state, messages: [...this.state.messages, msg] };
    this.notify();
  }

  updateMessage(id: string, patch: Partial<Message>) {
    this.state = {
      ...this.state,
      messages: this.state.messages.map((m) =>
        m.id === id ? { ...m, ...patch } : m,
      ),
    };
    this.notify();
  }

  addApproval(a: Approval) {
    this.state = { ...this.state, approvals: [a, ...this.state.approvals] };
    this.notify();
  }

  decideApproval(id: string, state: "approved" | "declined") {
    this.state = {
      ...this.state,
      approvals: this.state.approvals.map((a) =>
        a.id === id ? { ...a, state } : a,
      ),
    };
    this.notify();
  }

  addTask(t: Task) {
    this.state = { ...this.state, tasks: [t, ...this.state.tasks] };
    this.notify();
  }

  updateTask(id: string, patch: Partial<Task>) {
    this.state = {
      ...this.state,
      tasks: this.state.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    };
    this.notify();
  }

  addBot(b: Bot) {
    this.state = { ...this.state, bots: [b, ...this.state.bots] };
    this.notify();
  }

  updateBot(id: string, patch: Partial<Bot>) {
    this.state = {
      ...this.state,
      bots: this.state.bots.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    };
    this.notify();
  }

  setActiveChat(botIds: string[], activeId: string | null) {
    this.state = {
      ...this.state,
      chatBotIds: botIds,
      activeChatBotId: activeId ?? (botIds[0] ?? null),
    };
    this.notify();
  }

  setWorkspace(path: string | null) {
    this.state = { ...this.state, activeWorkspacePath: path };
    this.notify();
  }

  clear() {
    this.state = { ...EMPTY };
    this.notify();
  }
}

export const workroom = new WorkroomStore();

export function useWorkroom(): WorkroomState & {
  send: (text: string, attachments?: string[]) => Promise<void>;
  startNewChat: () => void;
  addBotToChat: (botId: string) => void;
  removeBotFromChat: (botId: string) => void;
  focusChatBot: (botId: string) => void;
  decideApproval: (id: string, state: "approved" | "declined") => void;
  setWorkspace: (path: string | null) => void;
} {
  const [state, setState] = useState<WorkroomState>(() => workroom.get());
  useEffect(() => workroom.subscribe(setState), []);

  // Persist the active workspace path so the next launch opens the same one.
  const [, setStoredWorkspace] = useKv<string | null>(
    "active-workspace",
    null,
  );
  useEffect(() => {
    if (state.activeWorkspacePath !== undefined) {
      setStoredWorkspace(state.activeWorkspacePath);
    }
  }, [state.activeWorkspacePath, setStoredWorkspace]);

  const send = useCallback(async (text: string, attachments: string[] = []) => {
    const botId = state.activeChatBotId;
    if (!botId) return;
    const userMsg: Message = {
      id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      botId,
      author: "user",
      body: text,
      createdAt: new Date().toISOString(),
      attachmentName: attachments[0],
    };
    workroom.addMessage(userMsg);
    // Placeholder pending bot reply — replaced when the server responds.
    const replyId = `m-${Date.now() + 1}-${Math.random().toString(36).slice(2, 6)}`;
    workroom.addMessage({
      id: replyId,
      botId,
      author: "bot",
      body: "",
      createdAt: new Date().toISOString(),
      kind: "message",
      pending: true,
    });

    // The actual tRPC call is wired in routes/workroom. We expose a window
    // event so the route can swap in its own handler without forcing every
    // caller to know about tRPC.
    const detail = {
      text,
      attachments,
      botId,
      replyId,
      userMessageId: userMsg.id,
    };
    window.dispatchEvent(new CustomEvent("rook:send", { detail }));
  }, [state.activeChatBotId]);

  const startNewChat = useCallback(() => {
    workroom.setActiveChat([], null);
  }, []);

  const addBotToChat = useCallback((botId: string) => {
    const next = workroom.get().chatBotIds.includes(botId)
      ? workroom.get().chatBotIds
      : [...workroom.get().chatBotIds, botId];
    workroom.setActiveChat(next, botId);
  }, []);

  const removeBotFromChat = useCallback((botId: string) => {
    const cur = workroom.get();
    const next = cur.chatBotIds.filter((id) => id !== botId);
    workroom.setActiveChat(next, next.includes(cur.activeChatBotId ?? "") ? cur.activeChatBotId : next[0] ?? null);
  }, []);

  const focusChatBot = useCallback((botId: string) => {
    workroom.setActiveChat(workroom.get().chatBotIds, botId);
  }, []);

  const decideApproval = useCallback(
    (id: string, decision: "approved" | "declined") => {
      workroom.decideApproval(id, decision);
    },
    [],
  );

  const setWorkspacePath = useCallback((path: string | null) => {
    workroom.setWorkspace(path);
  }, []);

  return useMemo(
    () => ({
      ...state,
      send,
      startNewChat,
      addBotToChat,
      removeBotFromChat,
      focusChatBot,
      decideApproval,
      setWorkspace: setWorkspacePath,
    }),
    [
      state,
      send,
      startNewChat,
      addBotToChat,
      removeBotFromChat,
      focusChatBot,
      decideApproval,
      setWorkspacePath,
    ],
  );
}

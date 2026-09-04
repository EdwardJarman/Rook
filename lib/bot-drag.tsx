import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Platform } from "react-native";

import { useAuth } from "@/hooks/use-auth";
import type { Bot } from "@/lib/workroom-store";

/**
 * Which Bots are present in the one main chat, and the drag gesture that puts
 * them there.
 *
 * The sidebar owns the roster; the chat owns the conversation. Dragging a Bot
 * from one to the other is the only way it joins, so this state is deliberately
 * separate from the workroom store: adding a teammate to the room is a view
 * concern, not a change to the Bot itself.
 */

/** The MIME-ish key used for the web drag payload. */
export const BOT_DRAG_TYPE = "application/x-rook-bot";

type BotDragContextValue = {
  /** The Bot currently under the cursor, or null when nothing is being dragged. */
  draggingBot: Bot | null;
  /** True while the chat is a valid, hovered drop target. */
  dropActive: boolean;
  setDropActive: (active: boolean) => void;
  beginDrag: (bot: Bot) => void;
  endDrag: () => void;
  /** Bots in the chat, oldest first — this is the order of the top row. */
  chatBotIds: string[];
  /** The Bot the composer talks to. */
  activeChatBotId: string;
  /** Stable identifier for the active conversation transcript. */
  activeChatId: string;
  ready: boolean;
  addBotToChat: (id: string) => void;
  /** Starts a clean conversation without deleting Bots or past conversations. */
  startNewChat: () => void;
  removeBotFromChat: (id: string) => void;
  focusChatBot: (id: string) => void;
};

const STORAGE_KEY_PREFIX = "rook-chat-participants-v2";
const LEGACY_CHAT_ID = "chat-legacy";
const makeChatId = () =>
  `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const BotDragContext = createContext<BotDragContextValue | undefined>(
  undefined,
);

export function BotDragProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [draggingBot, setDraggingBot] = useState<Bot | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [chatBotIds, setChatBotIds] = useState<string[]>([]);
  const [activeChatBotId, setActiveChatBotId] = useState("");
  const [activeChatId, setActiveChatId] = useState(LEGACY_CHAT_ID);
  const [ready, setReady] = useState(false);

  const storageKey = useMemo(
    () => `${STORAGE_KEY_PREFIX}-${user?.id ?? "signed-out"}`,
    [user?.id],
  );

  /* Restore the room for this account. A damaged cache must never block chat. */
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setChatBotIds([]);
    setActiveChatBotId("");
    setActiveChatId(LEGACY_CHAT_ID);
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(storageKey);
        if (cancelled || !raw) return;
        const parsed = JSON.parse(raw) as {
          chatBotIds?: unknown;
          activeChatBotId?: unknown;
          activeChatId?: unknown;
        };
        const ids = Array.isArray(parsed.chatBotIds)
          ? parsed.chatBotIds.filter(
              (id): id is string => typeof id === "string",
            )
          : [];
        setChatBotIds(ids);
        setActiveChatBotId(
          typeof parsed.activeChatBotId === "string" &&
            ids.includes(parsed.activeChatBotId)
            ? parsed.activeChatBotId
            : (ids[0] ?? ""),
        );
        setActiveChatId(
          typeof parsed.activeChatId === "string" &&
            parsed.activeChatId.startsWith("chat-")
            ? parsed.activeChatId
            : LEGACY_CHAT_ID,
        );
      } catch {
        /* Ignore an unreadable cache and start with an empty room. */
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  useEffect(() => {
    if (!ready) return;
    void AsyncStorage.setItem(
      storageKey,
      JSON.stringify({ chatBotIds, activeChatBotId, activeChatId }),
    );
  }, [activeChatBotId, activeChatId, chatBotIds, ready, storageKey]);

  const beginDrag = useCallback((bot: Bot) => setDraggingBot(bot), []);
  const endDrag = useCallback(() => {
    setDraggingBot(null);
    setDropActive(false);
  }, []);

  const addBotToChat = useCallback((id: string) => {
    if (!id) return;
    setChatBotIds((current) =>
      current.includes(id) ? current : [...current, id],
    );
    setActiveChatBotId(id);
  }, []);

  const removeBotFromChat = useCallback((id: string) => {
    setChatBotIds((current) => {
      const next = current.filter((botId) => botId !== id);
      setActiveChatBotId((active) =>
        active === id ? (next[next.length - 1] ?? "") : active,
      );
      return next;
    });
  }, []);

  const focusChatBot = useCallback((id: string) => setActiveChatBotId(id), []);
  const startNewChat = useCallback(() => {
    setChatBotIds([]);
    setActiveChatBotId("");
    setActiveChatId(makeChatId());
  }, []);

  const value = useMemo<BotDragContextValue>(
    () => ({
      draggingBot,
      dropActive,
      setDropActive,
      beginDrag,
      endDrag,
      chatBotIds,
      activeChatBotId,
      activeChatId,
      ready,
      addBotToChat,
      startNewChat,
      removeBotFromChat,
      focusChatBot,
    }),
    [
      activeChatBotId,
      activeChatId,
      addBotToChat,
      beginDrag,
      chatBotIds,
      draggingBot,
      dropActive,
      endDrag,
      focusChatBot,
      ready,
      removeBotFromChat,
      startNewChat,
    ],
  );

  return (
    <BotDragContext.Provider value={value}>{children}</BotDragContext.Provider>
  );
}

export function useBotDrag() {
  const context = useContext(BotDragContext);
  if (!context)
    throw new Error("useBotDrag must be used within BotDragProvider");
  return context;
}

/* ------------------------------------------------------------------ */
/* Web drag plumbing                                                   */
/* ------------------------------------------------------------------ */

/**
 * react-native-web forwards HTML drag props straight to the DOM node, but the
 * React Native prop types know nothing about them. These helpers keep the casts
 * in one place so screens stay readable.
 */
type WebDragEvent = {
  dataTransfer?: {
    setData: (type: string, value: string) => void;
    getData: (type: string) => string;
    dropEffect?: string;
    effectAllowed?: string;
    types?: readonly string[];
  };
  preventDefault?: () => void;
};

/** Props that make a sidebar row the drag source for a Bot. */
export function botDragSourceProps(
  bot: Bot,
  handlers: { onStart: () => void; onEnd: () => void },
) {
  if (Platform.OS !== "web") return {};
  return {
    draggable: true,
    onDragStart: (event: WebDragEvent) => {
      event.dataTransfer?.setData(BOT_DRAG_TYPE, bot.id);
      /* Plain text keeps the payload readable if it lands outside the app. */
      event.dataTransfer?.setData("text/plain", bot.name);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
      handlers.onStart();
    },
    onDragEnd: handlers.onEnd,
  } as Record<string, unknown>;
}

/** Props that make the chat stage a drop target for Bots. */
export function botDropTargetProps(handlers: {
  onEnter: () => void;
  onLeave: () => void;
  onDropBot: (botId: string) => void;
}) {
  if (Platform.OS !== "web") return {};
  const carriesBot = (event: WebDragEvent) =>
    Boolean(event.dataTransfer?.types?.includes(BOT_DRAG_TYPE));
  return {
    onDragEnter: (event: WebDragEvent) => {
      if (!carriesBot(event)) return;
      event.preventDefault?.();
      handlers.onEnter();
    },
    onDragOver: (event: WebDragEvent) => {
      if (!carriesBot(event)) return;
      /* Without preventDefault the browser refuses the drop entirely. */
      event.preventDefault?.();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      handlers.onEnter();
    },
    onDragLeave: handlers.onLeave,
    onDrop: (event: WebDragEvent) => {
      const botId = event.dataTransfer?.getData(BOT_DRAG_TYPE);
      event.preventDefault?.();
      handlers.onLeave();
      if (botId) handlers.onDropBot(botId);
    },
  } as Record<string, unknown>;
}

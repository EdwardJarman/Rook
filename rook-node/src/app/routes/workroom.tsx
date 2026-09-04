import { useEffect, useMemo, useRef, useState } from "react";
import {
  Paperclip,
  Send,
  Sparkles,
  Folder,
  ChevronRight,
  Bot as BotIcon,
  RefreshCcw,
  X,
  Check,
  XCircle,
  FileText,
  Image as ImageIcon,
} from "lucide-react";

import { Avatar, Button, Card, EmptyState, Pill, Spinner } from "@/components/primitives";
import { useTheme } from "@/lib/theme";
import { useWorkroom, type Message, type Bot } from "@/lib/workroom";
import { useLinkedFolders } from "@/lib/workspaces";
import { pickFolder, readTextFile, isTauri } from "@/lib/node-bridge";
import { cn } from "@/lib/cn";

const BOT_COLORS = [
  "#0E7C59",
  "#3E63DD",
  "#7C3AED",
  "#D97706",
  "#DC2626",
  "#0891B2",
  "#DB2777",
  "#65A30D",
];

const BOT_ICONS = ["bot", "sparkles", "search", "pen", "code", "image", "shield", "mail"];

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function WorkroomPage() {
  const { tokens } = useTheme();
  const {
    bots,
    messages,
    approvals,
    activeChatBotId,
    activeWorkspacePath,
    send,
    addBotToChat,
    focusChatBot,
    decideApproval,
    setWorkspace,
  } = useWorkroom();
  const { folders: linkedFolders, add: addLinkedFolder } = useLinkedFolders();
  const [composer, setComposer] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [showWorkspacePicker, setShowWorkspacePicker] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeBot: Bot | null = useMemo(
    () => bots.find((b) => b.id === activeChatBotId) ?? null,
    [bots, activeChatBotId],
  );

  useEffect(() => {
    // Auto-scroll the transcript to the bottom on new messages.
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const submit = () => {
    const trimmed = composer.trim();
    if (!trimmed || !activeBot) return;
    void send(trimmed, attachments);
    setComposer("");
    setAttachments([]);
  };

  const onAttach = async () => {
    if (isTauri()) {
      const path = await pickFolder();
      if (path) setAttachments((a) => [...a, path]);
    } else {
      setAttachments((a) => [...a, `attachment-${a.length + 1}`]);
    }
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) 320px",
        gap: 16,
        padding: 16,
        height: "100%",
        minHeight: 0,
      }}
    >
      <section
        style={{
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          gap: 12,
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "4px 4px 0",
          }}
        >
          <BotStrip />
        </header>

        <div
          ref={scrollRef}
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 12,
            padding: "4px 4px 8px",
          }}
        >
          {messages.length === 0 ? (
            <EmptyState
              icon={<Sparkles size={20} strokeWidth={2} />}
              title={
                activeBot
                  ? `Say hello to ${activeBot.name}`
                  : "Pick a Bot to begin"
              }
              body={
                activeBot
                  ? `${activeBot.role}. I can read and write files, run web tasks, and bring back a result.`
                  : "Drag a Bot from the sidebar or create a new one in the Bots tab."
              }
            />
          ) : (
            messages.map((m) => <MessageRow key={m.id} message={m} />)
          )}
        </div>

        <Composer
          value={composer}
          onChange={setComposer}
          onSubmit={submit}
          onAttach={onAttach}
          attachments={attachments}
          onRemoveAttachment={(name) =>
            setAttachments((a) => a.filter((x) => x !== name))
          }
          disabled={!activeBot}
          activeBot={activeBot}
        />
      </section>

      <aside
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          minHeight: 0,
        }}
      >
        <Card>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 8,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: tokens.textFaint }}>
              Workspace
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowWorkspacePicker((v) => !v)}
            >
              {showWorkspacePicker ? "Close" : "Change"}
            </Button>
          </div>
          {activeWorkspacePath ? (
            <WorkspaceSummary path={activeWorkspacePath} />
          ) : (
            <div style={{ fontSize: 13, color: tokens.textSoft }}>
              No folder selected. Open one so Bots can read and write files
              here — like Codex and Claude desktop.
            </div>
          )}
          <div style={{ marginTop: 12 }}>
            <Button
              size="sm"
              variant="primary"
              onClick={async () => {
                const folder = await addLinkedFolder();
                if (folder) setWorkspace(folder.path);
              }}
            >
              <Folder size={14} />
              Open folder
            </Button>
          </div>
          {showWorkspacePicker ? (
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 6 }}>
              {linkedFolders.length === 0 ? (
                <div style={{ fontSize: 12, color: tokens.textFaint }}>
                  No recent folders yet.
                </div>
              ) : (
                linkedFolders.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => {
                      setWorkspace(f.path);
                      setShowWorkspacePicker(false);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "8px 10px",
                      borderRadius: 10,
                      background:
                        f.path === activeWorkspacePath
                          ? tokens.accentSoft
                          : tokens.surfaceAlt,
                      border: "none",
                      textAlign: "left",
                      cursor: "pointer",
                      color: tokens.text,
                    }}
                  >
                    <Folder size={14} color={tokens.accent} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{f.name}</div>
                      <div
                        style={{
                          fontSize: 11.5,
                          color: tokens.textFaint,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {f.path}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          ) : null}
        </Card>

        <Card style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 0.6,
              textTransform: "uppercase",
              color: tokens.textFaint,
              marginBottom: 8,
            }}
          >
            Approvals
          </div>
          {approvals.filter((a) => a.state === "pending").length === 0 ? (
            <div style={{ fontSize: 12.5, color: tokens.textFaint }}>
              No pending approvals. Sensitive actions show up here.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {approvals
                .filter((a) => a.state === "pending")
                .map((a) => (
                  <ApprovalCard
                    key={a.id}
                    summary={a.summary}
                    reason={a.reason}
                    onApprove={() => decideApproval(a.id, "approved")}
                    onDecline={() => decideApproval(a.id, "declined")}
                  />
                ))}
            </div>
          )}
        </Card>
      </aside>
    </div>
  );
}

function BotStrip() {
  const { tokens } = useTheme();
  const { bots, chatBotIds, addBotToChat, focusChatBot, startNewChat } =
    useWorkroom();

  if (bots.length === 0) {
    return (
      <div
        style={{
          fontSize: 12.5,
          color: tokens.textSoft,
          padding: "6px 10px",
        }}
      >
        No Bots yet. Create one in the Bots tab to start a conversation.
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        overflowX: "auto",
        flex: 1,
      }}
    >
      <button
        type="button"
        onClick={startNewChat}
        style={{
          padding: "6px 10px",
          borderRadius: 999,
          background: tokens.surfaceAlt,
          color: tokens.textSoft,
          border: "none",
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        + Bot
      </button>
      {bots.map((bot) => {
        const inChat = chatBotIds.includes(bot.id);
        return (
          <button
            key={bot.id}
            type="button"
            onClick={() => {
              if (!inChat) addBotToChat(bot.id);
              focusChatBot(bot.id);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "5px 12px 5px 6px",
              borderRadius: 999,
              background: inChat ? tokens.accentSoft : tokens.surface,
              border: `1px solid ${inChat ? tokens.accent : tokens.line}`,
              color: tokens.text,
              cursor: "pointer",
            }}
          >
            <Avatar size={26} color={bot.color} icon={bot.icon} />
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>{bot.name}</span>
          </button>
        );
      })}
    </div>
  );
}

function MessageRow({ message }: { message: Message }) {
  const { tokens } = useTheme();
  const { bots } = useWorkroom();
  const bot = bots.find((b) => b.id === message.botId);

  if (message.author === "system") {
    return (
      <div
        style={{
          alignSelf: "center",
          fontSize: 11.5,
          color: tokens.textFaint,
          background: tokens.surfaceAlt,
          padding: "4px 10px",
          borderRadius: 999,
        }}
      >
        {message.body}
      </div>
    );
  }

  const isUser = message.author === "user";

  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        flexDirection: isUser ? "row-reverse" : "row",
        maxWidth: "min(720px, 92%)",
        alignSelf: isUser ? "flex-end" : "flex-start",
      }}
    >
      {!isUser ? (
        bot ? (
          <Avatar size={32} color={bot.color} icon={bot.icon} />
        ) : (
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 12,
              background: tokens.surfaceAlt,
              color: tokens.textFaint,
              display: "grid",
              placeItems: "center",
            }}
          >
            <BotIcon size={16} />
          </div>
        )
      ) : null}
      <div
        style={{
          background: isUser ? tokens.ink : tokens.surface,
          color: isUser ? tokens.onInk : tokens.text,
          border: isUser ? "none" : `1px solid ${tokens.line}`,
          borderRadius: 16,
          padding: "10px 14px",
          fontSize: 13.5,
          lineHeight: 1.55,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {message.attachmentName ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              color: isUser ? tokens.onInk : tokens.textSoft,
              opacity: 0.9,
            }}
          >
            <FileText size={14} />
            {message.attachmentName}
          </div>
        ) : null}
        <div>
          {message.pending ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Spinner size={12} /> thinking…
            </span>
          ) : (
            message.body
          )}
        </div>
      </div>
    </div>
  );
}

function Composer({
  value,
  onChange,
  onSubmit,
  onAttach,
  attachments,
  onRemoveAttachment,
  disabled,
  activeBot,
}: {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  onAttach: () => void;
  attachments: string[];
  onRemoveAttachment: (name: string) => void;
  disabled?: boolean;
  activeBot: Bot | null;
}) {
  const { tokens } = useTheme();
  const [armed, setArmed] = useState(false);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow
  useEffect(() => {
    const el = textAreaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [value]);

  return (
    <div
      style={{
        border: `1px solid ${armed ? tokens.ink : tokens.line}`,
        background: tokens.surface,
        borderRadius: 18,
        padding: 10,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        boxShadow: armed ? "0 0 0 3px " + tokens.focus : "none",
        transition: "border-color 120ms, box-shadow 120ms",
      }}
    >
      {attachments.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {attachments.map((a) => (
            <span
              key={a}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 10px",
                borderRadius: 999,
                background: tokens.surfaceAlt,
                fontSize: 12,
                color: tokens.text,
              }}
            >
              <FileText size={12} />
              {a.split(/[\\/]/).pop()}
              <button
                type="button"
                aria-label="Remove attachment"
                onClick={() => onRemoveAttachment(a)}
                style={{
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  color: tokens.textFaint,
                  display: "inline-flex",
                }}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <textarea
        ref={textAreaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setArmed(true)}
        onBlur={() => setArmed(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (!disabled) onSubmit();
          }
        }}
        placeholder={
          activeBot
            ? `Message ${activeBot.name}…`
            : "Pick a Bot in the strip above to start"
        }
        disabled={disabled}
        rows={1}
        style={{
          border: "none",
          outline: "none",
          background: "transparent",
          resize: "none",
          width: "100%",
          fontSize: 14,
          color: tokens.text,
          lineHeight: 1.5,
        }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <Button variant="ghost" size="sm" onClick={onAttach} title="Attach a file">
          <Paperclip size={14} />
          Attach
        </Button>
        <div style={{ flex: 1 }} />
        <Button
          variant="primary"
          size="sm"
          onClick={onSubmit}
          disabled={disabled || !value.trim()}
        >
          <Send size={14} />
          Send
        </Button>
      </div>
    </div>
  );
}

function WorkspaceSummary({ path }: { path: string }) {
  const { tokens } = useTheme();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: 10,
        background: tokens.surfaceAlt,
        border: `1px solid ${tokens.line}`,
        borderRadius: 12,
      }}
    >
      <Folder size={16} color={tokens.accent} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: tokens.text }}>
          {path.split(/[\\/]/).pop()}
        </div>
        <div
          style={{
            fontSize: 11.5,
            color: tokens.textFaint,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {path}
        </div>
      </div>
    </div>
  );
}

function ApprovalCard({
  summary,
  reason,
  onApprove,
  onDecline,
}: {
  summary: string;
  reason: string;
  onApprove: () => void;
  onDecline: () => void;
}) {
  const { tokens } = useTheme();
  return (
    <div
      style={{
        border: `1px solid ${tokens.line}`,
        borderRadius: 12,
        padding: 10,
        background: tokens.surface,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ fontSize: 12.5, fontWeight: 600 }}>{summary}</div>
      <div style={{ fontSize: 11.5, color: tokens.textSoft }}>{reason}</div>
      <div style={{ display: "flex", gap: 6 }}>
        <Button size="sm" variant="primary" onClick={onApprove}>
          <Check size={12} /> Approve
        </Button>
        <Button size="sm" variant="danger" onClick={onDecline}>
          <XCircle size={12} /> Decline
        </Button>
      </div>
    </div>
  );
}

// --- BotAvatar stub (uses BotIdentityMark via Avatar) -------------------------
// We re-export a typed alias so the JSX above reads naturally.
export { Avatar };

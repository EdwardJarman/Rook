import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Folder,
  Bot as BotIcon,
  Sparkles,
  X,
  Check,
  XCircle,
  FileText,
  Paperclip,
  RefreshCcw,
} from "lucide-react";

import { Avatar, Button, Spinner } from "@/components/primitives";
import { Markdown } from "@/components/markdown";
import { useTheme } from "@/lib/theme";
import { useWorkroom, type Message, type Bot } from "@/lib/workroom";
import { useLinkedFolders } from "@/lib/workspaces";
import { pickFolder, isTauri } from "@/lib/node-bridge";
import { cn } from "@/lib/cn";

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
    ensureChatTarget,
  } = useWorkroom();
  const { folders: linkedFolders, add: addLinkedFolder } = useLinkedFolders();
  const [composer, setComposer] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeBot: Bot | null = useMemo(
    () => bots.find((b) => b.id === activeChatBotId) ?? null,
    [bots, activeChatBotId],
  );
  const pending = approvals.filter((a) => a.state === "pending");

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const submit = () => {
    const trimmed = composer.trim();
    if (!trimmed) return;
    const botId = ensureChatTarget();
    void send(trimmed, attachments, botId);
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

  const openFolder = async () => {
    const folder = await addLinkedFolder();
    if (folder) setWorkspace(folder.path);
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
      }}
    >
      {bots.length > 0 ? (
        <div style={{ padding: "2px 24px 0" }}>
          <BotStrip />
        </div>
      ) : null}

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          padding: "8px 24px 12px",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 760,
            margin: "0 auto",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {messages.length === 0 ? (
            <WelcomeHero
              botName={activeBot?.name ?? "Rook"}
              hasBots={bots.length > 0}
              onPick={(s) => {
                setComposer(s);
                document.querySelector<HTMLTextAreaElement>("textarea")?.focus();
              }}
            />
          ) : (
            messages.map((m) => <MessageRow key={m.id} message={m} />)
          )}
        </div>
      </div>

      <div style={{ padding: "0 24px 14px" }}>
        <div style={{ width: "100%", maxWidth: 760, margin: "0 auto", position: "relative" }}>
          {pending.length > 0 ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                marginBottom: 10,
              }}
            >
              {pending.slice(0, 3).map((a) => (
                <ApprovalCard
                  key={a.id}
                  summary={a.summary}
                  reason={a.reason}
                  onApprove={() => decideApproval(a.id, "approved")}
                  onDecline={() => decideApproval(a.id, "declined")}
                />
              ))}
              {pending.length > 3 ? (
                <div style={{ fontSize: 11.5, color: tokens.textFaint }}>
                  +{pending.length - 3} more in Approvals
                </div>
              ) : null}
            </div>
          ) : null}

          <Composer
            value={composer}
            onChange={setComposer}
            onSubmit={submit}
            onAttach={onAttach}
            attachments={attachments}
            onRemoveAttachment={(name) =>
              setAttachments((a) => a.filter((x) => x !== name))
            }
            activeBot={activeBot}
            workspacePath={activeWorkspacePath}
            pickerOpen={pickerOpen}
            setPickerOpen={setPickerOpen}
            openFolder={openFolder}
            linkedFolders={linkedFolders}
            setWorkspace={(p) => {
              setWorkspace(p);
              setPickerOpen(false);
            }}
          />
        </div>
      </div>
    </div>
  );
}

const SUGGESTIONS = [
  { icon: "📁", label: "Summarize a folder" },
  { icon: "🔍", label: "Research with sources" },
  { icon: "✍️", label: "Draft a document" },
  { icon: "🧹", label: "Tidy up (ask first)" },
];

const SUGGESTION_TEXTS: Record<string, string> = {
  "Summarize a folder":
    "Summarize what's in my open workspace folder and flag anything that looks stale.",
  "Research with sources":
    "Research a topic I give you and bring back a short brief with sources.",
  "Draft a document":
    "Draft a one-page status report from the files in this workspace.",
  "Tidy up (ask first)":
    "Find duplicate and old files here, then propose a cleanup plan for my approval.",
};

function WelcomeHero({
  botName,
  hasBots,
  onPick,
}: {
  botName: string;
  hasBots: boolean;
  onPick: (suggestion: string) => void;
}) {
  const { tokens } = useTheme();
  return (
    <div
      style={{
        margin: "auto",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        gap: 10,
        maxWidth: 620,
        padding: "48px 16px 24px",
        backgroundImage:
          "radial-gradient(circle at 1px 1px, " +
          tokens.line +
          " 1px, transparent 0)",
        backgroundSize: "22px 22px",
        backgroundPosition: "center",
        borderRadius: 24,
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 14,
          background: tokens.ink,
          color: tokens.onInk,
          display: "grid",
          placeItems: "center",
        }}
      >
        <Sparkles size={20} strokeWidth={2} />
      </div>
      <h1
        style={{
          margin: "8px 0 0",
          fontSize: 24,
          fontWeight: 750,
          letterSpacing: -0.5,
          color: tokens.text,
        }}
      >
        {hasBots ? `What should ${botName} do first?` : "What can I help with?"}
      </h1>
      <p
        style={{
          margin: "0 0 8px",
          fontSize: 13,
          color: tokens.textSoft,
          lineHeight: 1.6,
          maxWidth: 420,
        }}
      >
        Type below to start — no setup needed. Open a workspace folder and Rook
        will read and write files with your approval.
      </p>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: 8,
        }}
      >
        {SUGGESTIONS.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => onPick(SUGGESTION_TEXTS[s.label])}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              padding: "7px 13px",
              borderRadius: 999,
              background: tokens.surface,
              border: `1px solid ${tokens.line}`,
              cursor: "pointer",
              color: tokens.text,
            }}
          >
            <span style={{ fontSize: 12.5 }} aria-hidden>
              {s.icon}
            </span>
            <span style={{ fontSize: 12, fontWeight: 550 }}>{s.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function BotStrip() {
  const { tokens } = useTheme();
  const { bots, chatBotIds, addBotToChat, focusChatBot, startNewChat } =
    useWorkroom();

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        overflowX: "auto",
        padding: "6px 0",
      }}
    >
      <button
        type="button"
        onClick={startNewChat}
        style={{
          padding: "5px 11px",
          borderRadius: 999,
          background: "transparent",
          color: tokens.textFaint,
          border: `1px dashed ${tokens.lineStrong}`,
          fontSize: 11.5,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        + New
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
              gap: 7,
              padding: "4px 12px 4px 5px",
              borderRadius: 999,
              background: inChat ? tokens.accentSoft : "transparent",
              border: `1px solid ${inChat ? tokens.accent : tokens.line}`,
              color: tokens.text,
              cursor: "pointer",
            }}
          >
            <Avatar size={22} color={bot.color} icon={bot.icon} />
            <span style={{ fontSize: 12, fontWeight: 600 }}>{bot.name}</span>
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
          fontSize: 11,
          color: tokens.textFaint,
          background: tokens.surfaceAlt,
          padding: "3px 10px",
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
        width: "100%",
      }}
    >
      {!isUser ? (
        bot ? (
          <Avatar size={28} color={bot.color} icon={bot.icon} />
        ) : (
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 10,
              background: tokens.surfaceAlt,
              color: tokens.textFaint,
              display: "grid",
              placeItems: "center",
              flexShrink: 0,
            }}
          >
            <BotIcon size={14} />
          </div>
        )
      ) : null}
      <div
        style={{
          maxWidth: "78%",
          background: isUser ? tokens.ink : "transparent",
          color: isUser ? tokens.onInk : tokens.text,
          border: "none",
          borderRadius: 16,
          padding: isUser ? "9px 14px" : "2px 2px",
          fontSize: 13.5,
          lineHeight: 1.6,
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
              display: "inline-flex",
              alignSelf: isUser ? "flex-end" : "flex-start",
              alignItems: "center",
              gap: 6,
              fontSize: 11.5,
              color: isUser ? tokens.onInk : tokens.textSoft,
              opacity: 0.85,
            }}
          >
            <FileText size={13} />
            {message.attachmentName}
          </div>
        ) : null}
        <div>
          {message.pending ? (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                color: tokens.textFaint,
              }}
            >
              <Spinner size={12} /> thinking…
            </span>
          ) : isUser ? (
            message.body
          ) : (
            <Markdown text={message.body} />
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
  activeBot,
  workspacePath,
  pickerOpen,
  setPickerOpen,
  openFolder,
  linkedFolders,
  setWorkspace,
}: {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  onAttach: () => void;
  attachments: string[];
  onRemoveAttachment: (name: string) => void;
  activeBot: Bot | null;
  workspacePath: string | null;
  pickerOpen: boolean;
  setPickerOpen: (next: boolean) => void;
  openFolder: () => void;
  linkedFolders: { id: string; name: string; path: string }[];
  setWorkspace: (path: string) => void;
}) {
  const { tokens } = useTheme();
  const [armed, setArmed] = useState(false);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const canSend = value.trim().length > 0;

  useEffect(() => {
    const el = textAreaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [value]);

  return (
    <div
      style={{
        border: `1px solid ${armed ? tokens.lineStrong : tokens.line}`,
        background: tokens.surface,
        borderRadius: 18,
        padding: "12px 12px 9px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        boxShadow: armed
          ? `0 0 0 3px ${tokens.focus}`
          : "0 1px 2px rgba(0,0,0,0.03)",
        transition: "border-color 120ms, box-shadow 120ms",
        position: "relative",
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
                padding: "3px 10px",
                borderRadius: 999,
                background: tokens.surfaceAlt,
                fontSize: 11.5,
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
                  padding: 0,
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
            onSubmit();
          }
        }}
        placeholder={
          activeBot ? `Message ${activeBot.name}…` : "Ask Rook anything"
        }
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
          padding: "0 4px",
        }}
      />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <button
          type="button"
          onClick={onAttach}
          title="Attach a file"
          aria-label="Attach a file"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            borderRadius: 9,
            border: "none",
            background: "transparent",
            color: tokens.textFaint,
            cursor: "pointer",
          }}
        >
          <Paperclip size={15} />
        </button>

        <button
          type="button"
          onClick={() => setPickerOpen(!pickerOpen)}
          title={workspacePath ?? "Open a workspace folder"}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            maxWidth: 260,
            padding: "4px 10px",
            borderRadius: 999,
            border: "none",
            background: workspacePath ? tokens.surfaceAlt : "transparent",
            color: workspacePath ? tokens.text : tokens.textFaint,
            fontSize: 11.5,
            fontWeight: 550,
            cursor: "pointer",
          }}
        >
          <Folder size={13} color={workspacePath ? tokens.accent : tokens.textFaint} />
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {workspacePath
              ? workspacePath.split(/[\\/]/).pop()
              : "Open folder"}
          </span>
        </button>

        <div style={{ flex: 1 }} />

        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSend}
          aria-label="Send message"
          style={{
            width: 30,
            height: 30,
            borderRadius: 999,
            border: "none",
            background: canSend ? tokens.ink : tokens.surfaceAlt,
            color: canSend ? tokens.onInk : tokens.textFaint,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: canSend ? "pointer" : "default",
            transition: "background 120ms, color 120ms",
          }}
        >
          <ArrowUp size={16} strokeWidth={2.4} />
        </button>
      </div>

      {pickerOpen ? (
        <div
          style={{
            position: "absolute",
            bottom: "calc(100% + 8px)",
            left: 0,
            minWidth: 280,
            background: tokens.elevated,
            border: `1px solid ${tokens.line}`,
            borderRadius: 12,
            padding: 6,
            boxShadow: `0 8px 24px ${tokens.scrim}`,
            display: "flex",
            flexDirection: "column",
            gap: 2,
            zIndex: 20,
          }}
        >
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              letterSpacing: 0.7,
              textTransform: "uppercase",
              color: tokens.textFaint,
              padding: "4px 8px 6px",
            }}
          >
            Workspace folder
          </div>
          {linkedFolders.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setWorkspace(f.path)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "7px 8px",
                borderRadius: 8,
                background: f.path === workspacePath ? tokens.accentSoft : "transparent",
                border: "none",
                textAlign: "left",
                cursor: "pointer",
                color: tokens.text,
              }}
            >
              <Folder size={13} color={tokens.accent} />
              <span
                style={{
                  fontSize: 12.5,
                  fontWeight: 550,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {f.name}
              </span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              openFolder();
              setPickerOpen(false);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "7px 8px",
              borderRadius: 8,
              border: "none",
              background: "transparent",
              textAlign: "left",
              cursor: "pointer",
              color: tokens.textSoft,
              fontSize: 12.5,
              fontWeight: 550,
            }}
          >
            <Folder size={13} />
            Choose a folder…
          </button>
        </div>
      ) : null}
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
        borderRadius: 14,
        padding: "10px 12px",
        background: tokens.surface,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ fontSize: 12.5, fontWeight: 650 }}>{summary}</div>
      <div style={{ fontSize: 11.5, color: tokens.textSoft }}>{reason}</div>
      <div style={{ display: "flex", gap: 6 }}>
        <Button size="sm" variant="primary" onClick={onApprove}>
          <Check size={12} /> Approve
        </Button>
        <Button size="sm" variant="ghost" onClick={onDecline}>
          <XCircle size={12} /> Decline
        </Button>
      </div>
    </div>
  );
}

// WorkspaceSummary kept for the Files route parity; unused here after the
// quiet redesign folded the workspace picker into the composer.
export { RefreshCcw, cn, newId };

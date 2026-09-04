import { useState } from "react";
import { Plus, MoreHorizontal, Trash2, Edit3, Bot as BotIcon } from "lucide-react";

import { Avatar, Button, Card, EmptyState, Field, Input, Modal, Pill, Spinner, Textarea, IconButton } from "@/components/primitives";
import { useTheme } from "@/lib/theme";
import { workroom, useWorkroom, type Bot } from "@/lib/workroom";
import { cn } from "@/lib/cn";

const COLORS = [
  "#0E7C59",
  "#3E63DD",
  "#7C3AED",
  "#D97706",
  "#DC2626",
  "#0891B2",
  "#DB2777",
  "#65A30D",
];

const ICONS = ["bot", "sparkles", "search", "pen", "code", "image", "shield", "mail"];

function newId() {
  return `bot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function BotsPage() {
  const { tokens } = useTheme();
  const { bots } = useWorkroom();
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 750,
            letterSpacing: -0.4,
            color: tokens.text,
          }}
        >
          Your Bots
        </h1>
        <Pill label={`${bots.length}`} tone="muted" />
        <div style={{ flex: 1 }} />
        <Button onClick={() => setCreating(true)}>
          <Plus size={14} /> New Bot
        </Button>
      </header>

      {bots.length === 0 ? (
        <EmptyState
          icon={<BotIcon size={20} />}
          title="No Bots yet"
          body="Create a focused teammate with a role, instructions, and the skills it can use."
          action={
            <Button onClick={() => setCreating(true)}>
              <Plus size={14} /> Create your first Bot
            </Button>
          }
        />
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 12,
          }}
        >
          {bots.map((bot) => (
            <BotCard
              key={bot.id}
              bot={bot}
              onEdit={() => setEditingId(bot.id)}
              onDelete={() => {
                workroom.hydrate({
                  bots: bots.filter((b) => b.id !== bot.id),
                });
              }}
            />
          ))}
        </div>
      )}

      {creating ? (
        <BotEditor
          onClose={() => setCreating(false)}
          onSave={(bot) => {
            workroom.addBot(bot);
            setCreating(false);
          }}
        />
      ) : null}
      {editingId ? (
        <BotEditor
          initial={bots.find((b) => b.id === editingId) ?? null}
          onClose={() => setEditingId(null)}
          onSave={(bot) => {
            workroom.updateBot(editingId, bot);
            setEditingId(null);
          }}
        />
      ) : null}
    </div>
  );
}

function BotCard({
  bot,
  onEdit,
  onDelete,
}: {
  bot: Bot;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { tokens } = useTheme();
  const { addBotToChat, focusChatBot } = useWorkroom();
  return (
    <Card padding={16}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Avatar size={42} color={bot.color} icon={bot.icon} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 14.5,
              fontWeight: 700,
              color: tokens.text,
              letterSpacing: -0.2,
            }}
          >
            {bot.name}
          </div>
          <div style={{ fontSize: 12, color: tokens.textSoft }}>{bot.role}</div>
        </div>
        <Pill
          label={bot.status}
          tone={bot.status === "Working" ? "accent" : "muted"}
        />
      </div>
      {bot.purpose ? (
        <p
          style={{
            margin: "12px 0 0",
            fontSize: 12.5,
            color: tokens.textSoft,
            lineHeight: 1.5,
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {bot.purpose}
        </p>
      ) : null}
      <div
        style={{
          display: "flex",
          gap: 6,
          marginTop: 14,
          alignItems: "center",
        }}
      >
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            addBotToChat(bot.id);
            focusChatBot(bot.id);
          }}
        >
          Start a chat
        </Button>
        <div style={{ flex: 1 }} />
        <IconButton label="Edit" onClick={onEdit}>
          <Edit3 size={15} />
        </IconButton>
        <IconButton label="Delete" tone="danger" onClick={onDelete}>
          <Trash2 size={15} />
        </IconButton>
      </div>
    </Card>
  );
}

function BotEditor({
  initial,
  onClose,
  onSave,
}: {
  initial?: Bot | null;
  onClose: () => void;
  onSave: (bot: Bot) => void;
}) {
  const { tokens } = useTheme();
  const [name, setName] = useState(initial?.name ?? "");
  const [role, setRole] = useState(initial?.role ?? "");
  const [purpose, setPurpose] = useState(initial?.purpose ?? "");
  const [color, setColor] = useState(initial?.color ?? COLORS[0]);
  const [icon, setIcon] = useState(initial?.icon ?? ICONS[0]);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim() || !role.trim()) return;
    setBusy(true);
    onSave({
      id: initial?.id ?? newId(),
      name: name.trim(),
      role: role.trim(),
      purpose: purpose.trim(),
      color,
      icon,
      status: initial?.status ?? "Ready",
      model: initial?.model ?? "openai/gpt-4o",
      lastActive: new Date().toISOString(),
      memory: initial?.memory ?? "",
      approvalRule: initial?.approvalRule ?? "auto",
    });
    setBusy(false);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? "Edit Bot" : "New Bot"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy}>
            {initial ? "Save changes" : "Create Bot"}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Field label="Name">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Research Assistant"
          />
        </Field>
        <Field label="Role" hint="One-line role description.">
          <Input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="e.g. Reads sources and writes a brief"
          />
        </Field>
        <Field label="Purpose" hint="What is this Bot for?">
          <Textarea
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="I help you turn long reading into short, well-cited briefs."
            rows={4}
          />
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Color">
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Color ${c}`}
                  onClick={() => setColor(c)}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 999,
                    background: c,
                    border:
                      c === color
                        ? `2px solid ${tokens.text}`
                        : `2px solid transparent`,
                    cursor: "pointer",
                  }}
                />
              ))}
            </div>
          </Field>
          <Field label="Icon">
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {ICONS.map((i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setIcon(i)}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 10,
                    background:
                      i === icon ? tokens.accentSoft : tokens.surfaceAlt,
                    border: `1px solid ${i === icon ? tokens.accent : tokens.line}`,
                    cursor: "pointer",
                    color: tokens.text,
                    display: "grid",
                    placeItems: "center",
                    fontSize: 14,
                    fontWeight: 700,
                  }}
                >
                  {iconLabel(i)}
                </button>
              ))}
            </div>
          </Field>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: 12,
            borderRadius: 12,
            background: tokens.surfaceAlt,
            border: `1px solid ${tokens.line}`,
          }}
        >
          <Avatar size={42} color={color} icon={icon} />
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 700 }}>{name || "New Bot"}</div>
            <div style={{ fontSize: 12, color: tokens.textSoft }}>
              {role || "Role"}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function iconLabel(i: string): string {
  return (
    {
      bot: "◈",
      sparkles: "✦",
      search: "◎",
      pen: "✎",
      code: "⌘",
      image: "◐",
      shield: "⛨",
      mail: "✉",
    } as Record<string, string>
  )[i] ?? "◈";
}

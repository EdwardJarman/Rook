import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Bot,
  Folder,
  FileText,
  Monitor,
  CheckCheck,
  MessageCircle,
  Settings,
  User,
  Cpu,
  Plus,
} from "lucide-react";

import { useTheme } from "@/lib/theme";
import { useWorkroom } from "@/lib/workroom";
import { useNodeStatus } from "@/lib/use-node-status";
import { Pill, Spinner, Button } from "@/components/primitives";
import { cn } from "@/lib/cn";

type NavItem = {
  to: string;
  label: string;
  icon: typeof MessageCircle;
  end?: boolean;
};

const NAV: NavItem[] = [
  { to: "/", label: "Workroom", icon: MessageCircle, end: true },
  { to: "/bots", label: "Bots", icon: Bot },
  { to: "/library", label: "Library", icon: Folder },
  { to: "/files", label: "Files", icon: FileText },
  { to: "/computer", label: "Computer", icon: Monitor },
  { to: "/approvals", label: "Approvals", icon: CheckCheck },
  { to: "/account", label: "Account", icon: User },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function AppShell() {
  const { tokens, resolved } = useTheme();
  const { chatBotIds, startNewChat, addBotToChat, focusChatBot, bots } =
    useWorkroom();
  const status = useNodeStatus();
  const location = useLocation();

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "var(--sidebar-width) 1fr",
        height: "100vh",
        background: tokens.canvas,
        color: tokens.text,
      }}
    >
      <aside
        style={{
          background: tokens.surface,
          borderRight: `1px solid ${tokens.line}`,
          display: "flex",
          flexDirection: "column",
          padding: "16px 12px 12px",
          gap: 14,
        }}
      >
        <Brand />
        <NewChatButton onClick={startNewChat} />
        <nav
          aria-label="Primary"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                style={({ isActive }) => ({
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 12px",
                  borderRadius: 12,
                  fontSize: 13.5,
                  fontWeight: 600,
                  color: isActive ? tokens.onInk : tokens.textSoft,
                  background: isActive ? tokens.ink : "transparent",
                  textDecoration: "none",
                })}
              >
                <Icon size={17} strokeWidth={1.8} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div
          style={{
            marginTop: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            paddingTop: 12,
            borderTop: `1px solid ${tokens.line}`,
          }}
        >
          <div style={{ paddingLeft: 4 }}>
            <div
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: 0.7,
                textTransform: "uppercase",
                color: tokens.textFaint,
                marginBottom: 8,
              }}
            >
              Your Bots
            </div>
            {bots.length === 0 ? (
              <div
                style={{
                  fontSize: 12,
                  color: tokens.textFaint,
                  padding: "4px 6px",
                }}
              >
                No Bots yet. Create one in the Bots tab.
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                  maxHeight: 200,
                  overflow: "auto",
                }}
              >
                {bots.map((bot) => {
                  const active = chatBotIds.includes(bot.id);
                  return (
                    <button
                      key={bot.id}
                      type="button"
                      onClick={() => {
                        if (!active) addBotToChat(bot.id);
                        focusChatBot(bot.id);
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "6px 8px",
                        borderRadius: 10,
                        background: active ? tokens.accentSoft : "transparent",
                        border: "none",
                        cursor: "pointer",
                        textAlign: "left",
                        color: tokens.text,
                      }}
                    >
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 999,
                          background: active ? tokens.accent : tokens.lineStrong,
                        }}
                      />
                      <span
                        style={{
                          fontSize: 12.5,
                          fontWeight: 600,
                          flex: 1,
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {bot.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <NodeStatusFooter />
        </div>
      </aside>

      <main
        style={{
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          minHeight: 0,
          background: tokens.canvas,
        }}
      >
        <header
          className="titlebar"
          data-tauri-drag-region
          style={{
            background: tokens.surface,
            borderBottom: `1px solid ${tokens.line}`,
          }}
        >
          <span
            style={{
              fontSize: 12,
              color: tokens.textSoft,
              fontWeight: 600,
              letterSpacing: 0.2,
            }}
          >
            {humanizeRoute(location.pathname)}
          </span>
          <span style={{ flex: 1 }} />
          <NodePill />
          <ThemeBadge scheme={resolved} />
        </header>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
          }}
        >
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function Brand() {
  const { tokens } = useTheme();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "0 6px 0 4px",
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 10,
          background: tokens.ink,
          color: tokens.onInk,
          display: "grid",
          placeItems: "center",
        }}
      >
        <Cpu size={18} strokeWidth={2.2} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: -0.3 }}>
          Rook
        </div>
        <div
          style={{
            fontSize: 10.5,
            color: tokens.textFaint,
            letterSpacing: 0.6,
            textTransform: "uppercase",
          }}
        >
          Your workroom
        </div>
      </div>
    </div>
  );
}

function NewChatButton({ onClick }: { onClick: () => void }) {
  const { tokens } = useTheme();
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
        padding: "9px 12px",
        borderRadius: 12,
        background: tokens.ink,
        color: tokens.onInk,
        border: "none",
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: -0.1,
        cursor: "pointer",
      }}
    >
      <Plus size={16} strokeWidth={2.4} />
      New chat
    </button>
  );
}

function NodeStatusFooter() {
  const status = useNodeStatus();
  const { tokens } = useTheme();
  const dotColor = !status.listening
    ? tokens.amber
    : status.paired
      ? tokens.accent
      : tokens.textFaint;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 12,
          color: tokens.textSoft,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: dotColor,
            boxShadow:
              dotColor === tokens.accent ? `0 0 0 4px ${tokens.accentSoft}` : "none",
          }}
        />
        <span>
          {status.listening
            ? status.paired
              ? "Connected"
              : "Listening"
            : status.running
              ? "Starting…"
              : "Offline"}
        </span>
      </div>
      <div
        style={{
          fontSize: 11,
          color: tokens.textFaint,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        v{status.version ?? "—"}
      </div>
    </div>
  );
}

function NodePill() {
  const status = useNodeStatus();
  if (!status.listening) return <Pill label="Offline" tone="muted" />;
  if (!status.paired) return <Pill label="Listening" tone="amber" />;
  return <Pill label="Connected" tone="mint" />;
}

function ThemeBadge({ scheme }: { scheme: string }) {
  const { tokens } = useTheme();
  return (
    <span
      className="no-drag"
      style={{
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: 0.6,
        textTransform: "uppercase",
        color: tokens.textFaint,
        padding: "4px 8px",
        borderRadius: 8,
        background: tokens.surfaceAlt,
      }}
    >
      {scheme}
    </span>
  );
}

function humanizeRoute(pathname: string): string {
  const cleaned = pathname.replace(/^\/+|\/+$/g, "");
  if (!cleaned) return "Workroom";
  const parts = cleaned.split("/").filter(Boolean);
  return parts
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" · ");
}

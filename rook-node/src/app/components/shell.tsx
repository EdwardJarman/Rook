import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Bot,
  Folder,
  FileText,
  Monitor,
  CheckCheck,
  Activity,
  MessageCircle,
  Search,
  Settings,
  User,
  Cpu,
  Plus,
} from "lucide-react";

import { useTheme } from "@/lib/theme";
import { useWorkroom } from "@/lib/workroom";
import { useNodeStatus } from "@/lib/use-node-status";
import { useSafeAuth } from "@/lib/safe-auth";
import { cn } from "@/lib/cn";

type NavItem = {
  to: string;
  label: string;
  icon: typeof MessageCircle;
  end?: boolean;
};

const CHAT_NAV: NavItem[] = [
  { to: "/", label: "Workroom", icon: MessageCircle, end: true },
];

const WORKSPACE_NAV: NavItem[] = [
  { to: "/bots", label: "Bots", icon: Bot },
  { to: "/files", label: "Files", icon: Folder },
  { to: "/library", label: "Library", icon: FileText },
  { to: "/computer", label: "Computer", icon: Monitor },
  { to: "/approvals", label: "Approvals", icon: CheckCheck },
  { to: "/activity", label: "Activity", icon: Activity },
];

const ALL_NAV: NavItem[] = [...CHAT_NAV, ...WORKSPACE_NAV];

export function AppShell() {
  const { tokens, resolved } = useTheme();
  const {
    startNewChat,
    conversations,
    activeConversationId,
    openConversation,
    approvals,
  } = useWorkroom();
  const status = useNodeStatus();
  const location = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);

  const pendingCount = approvals.filter((a) => a.state === "pending").length;

  // Native-app keyboard layer: Ctrl+N new chat, Ctrl+K search, Ctrl+, settings,
  // Ctrl+1..9 jump to sidebar destinations.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key === "n") {
        e.preventDefault();
        startNewChat();
        navigate("/");
      } else if (key === ",") {
        e.preventDefault();
        navigate("/settings");
      } else if (key === "k") {
        e.preventDefault();
        setSearchFocused(true);
      } else if (/^[1-9]$/.test(key)) {
        const item = ALL_NAV[Number(key) - 1];
        if (item) {
          e.preventDefault();
          navigate(item.to);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, startNewChat]);

  const q = query.trim().toLowerCase();

  const visibleChats = useMemo(() => {
    const all = [
      ...(activeConversationId
        ? conversations.filter((c) => c.id === activeConversationId)
        : []),
      ...conversations.filter((c) => c.id !== activeConversationId),
    ];
    if (!q) return all.slice(0, 14);
    return all.filter((c) => c.title.toLowerCase().includes(q)).slice(0, 14);
  }, [conversations, activeConversationId, q]);

  const visibleNav = useMemo(() => {
    if (!q) return WORKSPACE_NAV;
    return WORKSPACE_NAV.filter((n) => n.label.toLowerCase().includes(q));
  }, [q]);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "var(--sidebar-width) 1fr",
        height: "100%",
        minHeight: 0,
        background: tokens.canvas,
        color: tokens.text,
      }}
    >
      <aside
        style={{
          background: tokens.canvas,
          borderRight: `1px solid ${tokens.line}`,
          display: "flex",
          flexDirection: "column",
          padding: "14px 10px 10px",
          gap: 10,
          minHeight: 0,
        }}
      >
        <Brand />
        <NewChatButton onClick={startNewChat} />
        <SearchField
          value={query}
          onChange={setQuery}
          focused={searchFocused}
          setFocused={setSearchFocused}
        />

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {visibleChats.length > 0 ? (
            <SidebarSection
              label={q ? "Chats" : "Recent"}
              count={q ? undefined : conversations.length}
            >
              {visibleChats.map((c) => {
                const active = c.id === activeConversationId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      openConversation(c.id);
                      navigate("/");
                    }}
                    title={c.title}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 9,
                      padding: "7px 9px",
                      borderRadius: 9,
                      background: active ? tokens.surfaceAlt : "transparent",
                      border: "none",
                      cursor: "pointer",
                      textAlign: "left",
                      color: active ? tokens.text : tokens.textSoft,
                      width: "100%",
                    }}
                  >
                    <MessageCircle
                      size={13.5}
                      color={active ? tokens.accent : tokens.textFaint}
                    />
                    <span
                      style={{
                        fontSize: 12.5,
                        fontWeight: active ? 650 : 450,
                        flex: 1,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {c.title}
                    </span>
                  </button>
                );
              })}
              {q && visibleChats.length === 0 ? (
                <div style={{ fontSize: 12, color: tokens.textFaint, padding: "4px 9px" }}>
                  No matching chats
                </div>
              ) : null}
            </SidebarSection>
          ) : null}

          {visibleNav.length > 0 ? (
            <SidebarSection label={q ? "Pages" : "Workspace"}>
              {visibleNav.map((item) => {
                const Icon = item.icon;
                const showDot = item.to === "/approvals" && pendingCount > 0;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    style={({ isActive }) => ({
                      display: "flex",
                      alignItems: "center",
                      gap: 9,
                      padding: "7px 9px",
                      borderRadius: 9,
                      fontSize: 12.5,
                      fontWeight: 550,
                      color: isActive ? tokens.text : tokens.textSoft,
                      background: isActive ? tokens.surfaceAlt : "transparent",
                      textDecoration: "none",
                    })}
                  >
                    <Icon
                      size={14.5}
                      strokeWidth={1.9}
                      color={tokens.textFaint}
                    />
                    <span style={{ flex: 1 }}>{item.label}</span>
                    {showDot ? (
                      <span
                        aria-label={`${pendingCount} pending approvals`}
                        style={{
                          minWidth: 16,
                          height: 16,
                          borderRadius: 999,
                          background: tokens.accent,
                          color: tokens.onInk,
                          fontSize: 9.5,
                          fontWeight: 800,
                          display: "grid",
                          placeItems: "center",
                          padding: "0 4px",
                        }}
                      >
                        {pendingCount}
                      </span>
                    ) : null}
                  </NavLink>
                );
              })}
            </SidebarSection>
          ) : null}
        </div>

        <div
          style={{
            borderTop: `1px solid ${tokens.line}`,
            paddingTop: 8,
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          <AccountRow />
          <SettingsRow />
          <StatusLine />
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
            background: tokens.canvas,
            borderBottom: "none",
            height: 40,
          }}
        >
          <span
            style={{
              fontSize: 12,
              color: tokens.textFaint,
              fontWeight: 500,
              letterSpacing: 0.1,
            }}
          >
            {humanizeRoute(location.pathname)}
          </span>
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

function SidebarSection({
  label,
  count,
  children,
}: {
  label: string;
  count?: number;
  children: React.ReactNode;
}) {
  const { tokens } = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 9px 3px",
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: 0.8,
          textTransform: "uppercase",
          color: tokens.textFaint,
        }}
      >
        {label}
        {typeof count === "number" && count > 0 ? (
          <span style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>
            · {count}
          </span>
        ) : null}
      </div>
      {children}
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
        gap: 9,
        padding: "2px 8px 6px",
      }}
    >
      <div
        style={{
          width: 26,
          height: 26,
          borderRadius: 8,
          background: tokens.ink,
          color: tokens.onInk,
          display: "grid",
          placeItems: "center",
        }}
      >
        <Cpu size={15} strokeWidth={2.2} />
      </div>
      <div style={{ fontSize: 14.5, fontWeight: 700, letterSpacing: -0.2 }}>
        Rook
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
        padding: "8px 12px",
        borderRadius: 10,
        background: tokens.ink,
        color: tokens.onInk,
        border: "none",
        fontSize: 12.5,
        fontWeight: 650,
        letterSpacing: -0.1,
        cursor: "pointer",
      }}
    >
      <Plus size={14.5} strokeWidth={2.4} />
      New chat
    </button>
  );
}

function SearchField({
  value,
  onChange,
  focused,
  setFocused,
}: {
  value: string;
  onChange: (next: string) => void;
  focused: boolean;
  setFocused: (next: boolean) => void;
}) {
  const { tokens } = useTheme();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "6px 9px",
        borderRadius: 9,
        background: tokens.surfaceAlt,
        border: `1px solid ${focused ? tokens.lineStrong : "transparent"}`,
      }}
    >
      <Search size={13.5} color={tokens.textFaint} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="Search"
        aria-label="Search chats and pages"
        style={{
          flex: 1,
          minWidth: 0,
          border: "none",
          outline: "none",
          background: "transparent",
          color: tokens.text,
          fontSize: 12.5,
          fontFamily: "inherit",
        }}
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          style={{
            border: "none",
            background: "transparent",
            color: tokens.textFaint,
            fontSize: 12,
            cursor: "pointer",
            padding: 0,
          }}
        >
          ✕
        </button>
      ) : (
        <span
          aria-hidden
          style={{
            fontSize: 10,
            color: tokens.textFaint,
            border: `1px solid ${tokens.lineStrong}`,
            borderRadius: 4,
            padding: "0 4px",
            fontWeight: 600,
          }}
        >
          K
        </span>
      )}
    </div>
  );
}

function AccountRow() {
  const { tokens } = useTheme();
  const { mode, user } = useSafeAuth();
  const navigate = useNavigate();
  const name = mode === "clerk" && user ? (user.fullName ?? user.email ?? "Signed in") : "This computer";
  const sub = mode === "clerk" && user ? (user.email ?? "") : "Not signed in";
  const initial =
    mode === "clerk" && user ? (user.initials ?? "R") : "R";
  return (
    <button
      type="button"
      onClick={() => navigate("/account")}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "6px 9px",
        borderRadius: 9,
        border: "none",
        background: "transparent",
        cursor: "pointer",
        textAlign: "left",
        color: tokens.text,
        width: "100%",
      }}
    >
      <span
        style={{
          width: 24,
          height: 24,
          borderRadius: 999,
          background: tokens.accentSoft,
          color: tokens.accent,
          fontSize: 11,
          fontWeight: 800,
          display: "grid",
          placeItems: "center",
          flexShrink: 0,
        }}
      >
        {initial}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: "block",
            fontSize: 12.5,
            fontWeight: 600,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name}
        </span>
        <span
          style={{
            display: "block",
            fontSize: 11,
            color: tokens.textFaint,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {sub || "Account"}
        </span>
      </span>
      <User size={13} color={tokens.textFaint} />
    </button>
  );
}

function SettingsRow() {
  const { tokens } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const active = location.pathname === "/settings";
  return (
    <NavLink
      to="/settings"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "6px 9px",
        borderRadius: 9,
        border: "none",
        background: active ? tokens.surfaceAlt : "transparent",
        color: tokens.textSoft,
        fontSize: 12.5,
        fontWeight: 550,
        textDecoration: "none",
      }}
    >
      <Settings size={14.5} strokeWidth={1.9} color={tokens.textFaint} />
      Settings
    </NavLink>
  );
}

function StatusLine() {
  const status = useNodeStatus();
  const { tokens } = useTheme();
  const dotColor = !status.listening
    ? tokens.textFaint
    : status.paired
      ? tokens.accent
      : tokens.amber;
  const label = status.listening
    ? status.paired
      ? "Connected"
      : "Listening"
    : status.running
      ? "Starting…"
      : "Offline";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 9px 2px",
        fontSize: 10.5,
        color: tokens.textFaint,
      }}
      title={`Rook Node ${label} · v${status.version ?? __APP_VERSION__}`}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: dotColor,
        }}
      />
      <span>{label}</span>
      <span style={{ opacity: 0.6 }}>·</span>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>
        v{__APP_VERSION__}
      </span>
    </div>
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

export { cn };

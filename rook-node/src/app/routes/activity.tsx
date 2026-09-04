import { useMemo } from "react";
import { Activity as ActivityIcon, Check, XCircle } from "lucide-react";

import { Card, EmptyState, Pill } from "@/components/primitives";
import { useTheme } from "@/lib/theme";
import { useWorkroom } from "@/lib/workroom";

type Event = {
  id: string;
  title: string;
  detail: string;
  at: string;
  tone: "mint" | "coral" | "muted";
};

/**
 * Running log of what Bots did on this computer — the desktop counterpart
 * of the web app's Activity tab. Derived from the workroom store (tasks,
 * approval decisions, and result messages) so it stays live with no extra
 * backend plumbing.
 */
export function ActivityPage() {
  const { tokens } = useTheme();
  const { tasks, approvals, messages, bots } = useWorkroom();

  const events = useMemo<Event[]>(() => {
    const out: Event[] = [];
    for (const t of tasks) {
      out.push({
        id: `task-${t.id}`,
        title: `${t.title} — ${t.status}`,
        detail: t.summary || t.nextAction,
        at: t.startedAt,
        tone: t.status === "Completed" ? "mint" : t.status === "Cancelled" ? "coral" : "muted",
      });
    }
    for (const a of approvals) {
      if (a.state === "pending") continue;
      const bot = bots.find((b) => b.id === a.botId);
      out.push({
        id: `approval-${a.id}`,
        title: `${a.state === "approved" ? "Approved" : "Declined"}: ${a.summary}`,
        detail: `${bot?.name ?? "A Bot"} — ${a.reason}`,
        at: a.createdAt,
        tone: a.state === "approved" ? "mint" : "coral",
      });
    }
    for (const m of messages) {
      if (m.kind !== "result" && m.kind !== "activity") continue;
      const bot = bots.find((b) => b.id === m.botId);
      out.push({
        id: `msg-${m.id}`,
        title: m.kind === "result" ? `Result from ${bot?.name ?? "Bot"}` : bot?.name ?? "Rook",
        detail: m.body.slice(0, 220),
        at: m.createdAt,
        tone: m.kind === "result" ? "mint" : "muted",
      });
    }
    return out.sort((a, b) => (a.at < b.at ? 1 : -1));
  }, [tasks, approvals, messages, bots]);

  return (
    <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
      <header>
        <h1
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 750,
            letterSpacing: -0.4,
            color: tokens.text,
          }}
        >
          Activity
        </h1>
        <p style={{ margin: "6px 0 0", color: tokens.textSoft, fontSize: 13 }}>
          Everything your Bots have done on this computer, newest first.
        </p>
      </header>

      {events.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ActivityIcon size={20} strokeWidth={2} />}
            title="No activity yet"
            body="Start a conversation in the Workroom — completed tasks, approval decisions, and results will show up here."
          />
        </Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {events.map((e) => (
            <Card key={e.id}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <div
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 10,
                    display: "grid",
                    placeItems: "center",
                    background:
                      e.tone === "mint"
                        ? tokens.accentSoft
                        : e.tone === "coral"
                          ? tokens.surfaceAlt
                          : tokens.surfaceAlt,
                    color:
                      e.tone === "mint" ? tokens.accent : e.tone === "coral" ? "#DC2626" : tokens.textSoft,
                    flexShrink: 0,
                  }}
                >
                  {e.tone === "coral" ? <XCircle size={15} /> : <Check size={15} />}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                    }}
                  >
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: tokens.text }}>
                      {e.title}
                    </div>
                    <div style={{ fontSize: 11.5, color: tokens.textFaint, flexShrink: 0 }}>
                      {new Date(e.at).toLocaleString()}
                    </div>
                  </div>
                  {e.detail ? (
                    <div
                      style={{
                        marginTop: 3,
                        fontSize: 12.5,
                        lineHeight: 1.5,
                        color: tokens.textSoft,
                        wordBreak: "break-word",
                      }}
                    >
                      {e.detail}
                    </div>
                  ) : null}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

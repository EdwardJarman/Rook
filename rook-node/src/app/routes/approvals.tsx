import { useState } from "react";
import { CheckCircle2, XCircle, Clock, ShieldCheck } from "lucide-react";

import { Button, Card, EmptyState, Pill, Segmented } from "@/components/primitives";
import { useTheme } from "@/lib/theme";
import { useWorkroom } from "@/lib/workroom";

type Filter = "all" | "pending" | "approved" | "declined";

export function ApprovalsPage() {
  const { tokens } = useTheme();
  const { approvals, decideApproval } = useWorkroom();
  const [filter, setFilter] = useState<Filter>("pending");

  const filtered = approvals.filter((a) =>
    filter === "all" ? true : filter === "pending" ? a.state === "pending" : a.state === filter,
  );

  return (
    <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h1
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 750,
            letterSpacing: -0.4,
            color: tokens.text,
          }}
        >
          Approvals
        </h1>
        <Pill label={`${approvals.filter((a) => a.state === "pending").length} pending`} tone="amber" />
        <div style={{ flex: 1 }} />
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: "pending", label: "Pending" },
            { value: "approved", label: "Approved" },
            { value: "declined", label: "Declined" },
            { value: "all", label: "All" },
          ]}
        />
      </header>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck size={20} />}
          title="Nothing waiting on you"
          body="Sensitive actions — uploads, purchases, deletions — show up here for your review."
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map((a) => (
            <Card key={a.id}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {a.state === "pending" ? (
                  <Clock size={18} color={tokens.amber} />
                ) : a.state === "approved" ? (
                  <CheckCircle2 size={18} color={tokens.accent} />
                ) : (
                  <XCircle size={18} color={tokens.coral} />
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{a.summary}</div>
                  <div style={{ fontSize: 12.5, color: tokens.textSoft }}>{a.reason}</div>
                </div>
                <Pill
                  label={a.state}
                  tone={
                    a.state === "approved"
                      ? "mint"
                      : a.state === "declined"
                        ? "coral"
                        : a.state === "expired"
                          ? "muted"
                          : "amber"
                  }
                />
                {a.state === "pending" ? (
                  <>
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => decideApproval(a.id, "approved")}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => decideApproval(a.id, "declined")}
                    >
                      Decline
                    </Button>
                  </>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

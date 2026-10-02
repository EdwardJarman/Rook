import { useState } from "react";
import { CheckCircle2, XCircle, Clock, ShieldCheck } from "lucide-react";

import { Button, Card, EmptyState, Pill, Segmented } from "@/components/primitives";
import { useTheme } from "@/lib/theme";
import { useWorkroom, workroom, type Approval } from "@/lib/workroom";
import { getTrpcClient } from "@/lib/trpc";
import { currentToken } from "@/lib/send-bridge";

type Filter = "all" | "pending" | "approved" | "declined";

type ExcelResolveResult = {
  executed: boolean;
  declined?: boolean;
  summary?: string;
};

export function ApprovalsPage() {
  const { tokens } = useTheme();
  const { approvals } = useWorkroom();
  const [filter, setFilter] = useState<Filter>("pending");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Agent-turn approvals (Excel writes) execute server-side, mirroring the
   * mobile Updates flow. Node-command and computer-proposal approvals stay
   * local acknowledges — node commands run through the sidecar relay, and
   * computer proposals run from the Computer panel.
   */
  const decide = async (approval: Approval, decision: "approved" | "declined") => {
    if (approval.state !== "pending" || busyId) return;
    setError(null);
    if (approval.agentKind === "excel" && approval.externalActionId) {
      setBusyId(approval.id);
      try {
        const client = getTrpcClient(currentToken);
        const excel = (
          client as unknown as {
            excel: {
              resolveAction: {
                mutate: (input: { actionId: string; decision: "approve" | "decline" }) => Promise<ExcelResolveResult>;
              };
            };
          }
        ).excel;
        const result = await excel.resolveAction.mutate({
          actionId: approval.externalActionId,
          decision: decision === "approved" ? "approve" : "decline",
        });
        workroom.decideApproval(approval.id, decision);
        if (result.executed) {
          workroom.updateTask(approval.taskId, {
            status: "Completed",
            summary: "The approved Excel change was applied successfully.",
            nextAction: "Review the result and decide what happens next.",
          });
          workroom.addMessage({
            id: `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            botId: approval.botId,
            author: "bot",
            body: `Excel updated. ${result.summary ?? approval.summary}`,
            createdAt: new Date().toISOString(),
            kind: "result",
            taskId: approval.taskId,
          });
        } else {
          workroom.updateTask(approval.taskId, {
            status: "Cancelled",
            summary: "The proposed Excel change was declined.",
            nextAction: "Ask the Bot to prepare it again if needed.",
          });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Rook could not complete this Excel action. Nothing was changed.");
      } finally {
        setBusyId(null);
      }
      return;
    }
    workroom.decideApproval(approval.id, decision);
    if (decision === "declined" && approval.taskId) {
      workroom.updateTask(approval.taskId, {
        status: "Cancelled",
        summary: "Discarded before acting. Nothing was attempted.",
        nextAction: "Send a new message to start over.",
      });
    }
  };

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

      {error ? (
        <div style={{ fontSize: 12.5, color: tokens.coral }}>{error}</div>
      ) : null}
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
                      variant="danger"
                      disabled={busyId === a.id}
                      onClick={() => void decide(a, "declined")}
                    >
                      Decline
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={busyId === a.id}
                      onClick={() => void decide(a, "approved")}
                    >
                      {busyId === a.id ? "Working…" : "Approve"}
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

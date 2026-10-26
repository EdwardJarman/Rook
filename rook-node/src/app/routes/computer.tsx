import { useEffect, useState } from "react";
import {
  Cpu,
  RefreshCcw,
  Power,
  PowerOff,
  Eye,
  PlayCircle,
  XCircle,
  CheckCircle2,
  Hand,
  Bot as BotIcon,
} from "lucide-react";

import { Button, Card, EmptyState, IconButton, Pill } from "@/components/primitives";
import { useTheme } from "@/lib/theme";
import { useNodeStatus } from "@/lib/use-node-status";
import {
  startSidecar,
  stopSidecar,
  openConnect,
  disconnect,
  listLeases,
  takeOverBot,
  releaseBot,
  type LeaseRecord,
} from "@/lib/node-bridge";
import { useWorkroom } from "@/lib/workroom";

const LEASE_POLL_MS = 2_000;

/** Polls /api/leases so the takeover banner reflects the sidecar's real state. */
function useLeases(): LeaseRecord[] {
  const [leases, setLeases] = useState<LeaseRecord[]>([]);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (cancelled) return;
      const next = await listLeases();
      if (!cancelled) setLeases(next);
      timer = setTimeout(tick, LEASE_POLL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);
  return leases;
}

export function ComputerPage() {
  const { tokens } = useTheme();
  const status = useNodeStatus();
  const { bots } = useWorkroom();
  const leases = useLeases();
  const [busy, setBusy] = useState(false);
  const [leaseBusyId, setLeaseBusyId] = useState<string | null>(null);

  /** Bots the Bot itself is actively driving right now — candidates for takeover. */
  const workingLeases = leases.filter((lease) => lease.state === "BOT");
  /** A Bot this desktop window has already taken control of. */
  const humanLeases = leases.filter((lease) => lease.state === "HUMAN");

  const botName = (botId: string) =>
    bots.find((bot) => bot.id === botId)?.name ?? "A Bot";

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
          Computer
        </h1>
        <Pill
          label={
            !status.listening
              ? "Offline"
              : status.paired
                ? "Connected"
                : "Listening"
          }
          tone={
            !status.listening
              ? "muted"
              : status.paired
                ? "mint"
                : "amber"
          }
        />
        <div style={{ flex: 1 }} />
        {!status.paired ? (
          <Button onClick={openConnect}>
            <Power size={14} /> Connect account
          </Button>
        ) : (
          <Button
            variant="danger"
            onClick={async () => {
              setBusy(true);
              await disconnect();
              setBusy(false);
            }}
            loading={busy}
          >
            <PowerOff size={14} /> Disconnect
          </Button>
        )}
      </header>

      {workingLeases.length || humanLeases.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {workingLeases.map((lease) => (
            <div
              key={lease.botId}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 14px",
                borderRadius: 14,
                background: tokens.amberSoft,
                border: `1px solid ${tokens.amber}22`,
              }}
            >
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 11,
                  background: `${tokens.amber}22`,
                  color: tokens.amber,
                  display: "grid",
                  placeItems: "center",
                  flexShrink: 0,
                }}
              >
                <BotIcon size={17} />
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700 }}>
                  {botName(lease.botId)} is working
                </div>
                <div style={{ fontSize: 12, color: tokens.textSoft, marginTop: 1 }}>
                  Take over if it needs a CAPTCHA solved, a login confirmed,
                  or you just want to step in.
                </div>
              </div>
              <Button
                variant="secondary"
                loading={leaseBusyId === lease.botId}
                onClick={async () => {
                  setLeaseBusyId(lease.botId);
                  await takeOverBot(lease.botId);
                  setLeaseBusyId(null);
                }}
              >
                <Hand size={14} /> Take over
              </Button>
            </div>
          ))}
          {humanLeases.map((lease) => (
            <div
              key={lease.botId}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 14px",
                borderRadius: 14,
                background: tokens.accentSoft,
                border: `1px solid ${tokens.accent}22`,
              }}
            >
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 11,
                  background: `${tokens.accent}22`,
                  color: tokens.accent,
                  display: "grid",
                  placeItems: "center",
                  flexShrink: 0,
                }}
              >
                <Hand size={17} />
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700 }}>
                  You're in control of {botName(lease.botId)}
                </div>
                <div style={{ fontSize: 12, color: tokens.textSoft, marginTop: 1 }}>
                  The Bot's input is paused. Release when you're done so it
                  can continue.
                </div>
              </div>
              <Button
                variant="primary"
                loading={leaseBusyId === lease.botId}
                onClick={async () => {
                  setLeaseBusyId(lease.botId);
                  await releaseBot(lease.botId);
                  setLeaseBusyId(null);
                }}
              >
                <PlayCircle size={14} /> Release to Bot
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      <Card>
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "flex-start",
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              background: tokens.accentSoft,
              color: tokens.accent,
              display: "grid",
              placeItems: "center",
              flexShrink: 0,
            }}
          >
            <Cpu size={20} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700 }}>
              This computer
            </div>
            <p
              style={{
                margin: "4px 0 0",
                fontSize: 13,
                color: tokens.textSoft,
                lineHeight: 1.55,
              }}
            >
              {status.listening
                ? status.paired
                  ? "Your Rook Node is connected. Bots can run here under your control. Close the window — Rook stays connected in the background."
                  : "Rook is running. Press Connect account and sign in to pair this computer with your Rook account."
                : "Rook Node is offline. Restart it to bring your Bot computer back online."}
            </p>
            <div
              style={{
                marginTop: 12,
                display: "flex",
                gap: 12,
                fontSize: 12,
                color: tokens.textSoft,
                fontVariantNumeric: "tabular-nums",
                flexWrap: "wrap",
              }}
            >
              <Stat label="Node ID" value={status.nodeId ?? "—"} mono />
              <Stat label="Server" value={status.serverUrl ?? "—"} />
              <Stat label="Version" value={status.version ?? "—"} />
            </div>
            {status.error ? (
              <div
                style={{
                  marginTop: 10,
                  fontSize: 12,
                  color: tokens.coral,
                }}
              >
                {status.error}
              </div>
            ) : null}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            gap: 8,
            marginTop: 14,
            borderTop: `1px solid ${tokens.line}`,
            paddingTop: 14,
          }}
        >
          <Button
            variant="secondary"
            onClick={async () => {
              setBusy(true);
              await startSidecar();
              setBusy(false);
            }}
            loading={busy}
          >
            <RefreshCcw size={14} /> Restart node
          </Button>
          <Button
            variant="ghost"
            onClick={async () => {
              setBusy(true);
              await stopSidecar();
              setBusy(false);
            }}
            loading={busy}
          >
            <PowerOff size={14} /> Stop node
          </Button>
        </div>
      </Card>

      <Card>
        <div style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 4 }}>
          Live screen
        </div>
        <p
          style={{
            margin: 0,
            fontSize: 13,
            color: tokens.textSoft,
            lineHeight: 1.55,
          }}
        >
          When a Bot opens a browser tab here, the page will stream into this
          panel. You can take over with the controls at any time.
        </p>
        <div
          style={{
            marginTop: 14,
            border: `1px dashed ${tokens.lineStrong}`,
            borderRadius: 14,
            padding: 28,
            display: "grid",
            placeItems: "center",
            color: tokens.textFaint,
            background: tokens.surfaceAlt,
          }}
        >
          <Eye size={28} />
          <div style={{ marginTop: 8, fontSize: 13 }}>
            No live screen. Start a task in the Workroom that opens a browser.
          </div>
        </div>
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  const { tokens } = useTheme();
  return (
    <div
      style={{
        background: tokens.surfaceAlt,
        border: `1px solid ${tokens.line}`,
        borderRadius: 10,
        padding: "6px 10px",
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 0.6,
          textTransform: "uppercase",
          color: tokens.textFaint,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 12,
          color: tokens.text,
          fontFamily: mono ? "var(--rook-mono)" : undefined,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          maxWidth: 200,
        }}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

import { useState } from "react";
import { Sun, Moon, Monitor, Copy, LogOut } from "lucide-react";

import { Button, Card, Field, Input, Pill, Segmented, Switch } from "@/components/primitives";
import { useTheme, type Scheme } from "@/lib/theme";
import { useNodeStatus } from "@/lib/use-node-status";
import { useAuth } from "@clerk/clerk-react";

export function SettingsPage() {
  const { tokens, scheme, setScheme } = useTheme();
  const status = useNodeStatus();
  const { signOut } = useAuth();
  const [runOnLogin, setRunOnLogin] = useState(false);
  const [serverUrl, setServerUrl] = useState<string>(status.serverUrl ?? "");

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
          Settings
        </h1>
        <p style={{ margin: "6px 0 0", color: tokens.textSoft, fontSize: 13 }}>
          Preferences for the desktop app and the local Rook Node.
        </p>
      </header>

      <Card>
        <h2 style={{ margin: 0, fontSize: 14.5, fontWeight: 700 }}>Appearance</h2>
        <p style={{ margin: "4px 0 12px", fontSize: 12.5, color: tokens.textSoft }}>
          Pick how Rook looks. System follows your OS theme.
        </p>
        <Segmented<Scheme>
          value={scheme}
          onChange={setScheme}
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      </Card>

      <Card>
        <h2 style={{ margin: 0, fontSize: 14.5, fontWeight: 700 }}>Rook Node</h2>
        <p style={{ margin: "4px 0 12px", fontSize: 12.5, color: tokens.textSoft }}>
          The local sidecar that runs your Bots on this computer.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="Server URL">
            <Input
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="https://www.rook.lighting"
            />
          </Field>
          <Field label="Node ID">
            <Input value={status.nodeId ?? ""} readOnly />
          </Field>
        </div>
        <div
          style={{
            marginTop: 14,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <Switch
            checked={runOnLogin}
            onChange={setRunOnLogin}
            label="Start Rook when I sign in"
          />
          <Pill
            label={status.listening ? (status.paired ? "Connected" : "Listening") : "Offline"}
            tone={status.listening ? (status.paired ? "mint" : "amber") : "muted"}
          />
        </div>
      </Card>

      <Card>
        <h2 style={{ margin: 0, fontSize: 14.5, fontWeight: 700 }}>About</h2>
        <div
          style={{
            marginTop: 8,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 8,
          }}
        >
          <Info label="Version" value={status.version ?? "—"} />
          <Info label="Data folder" value={status.dataHome ?? "—"} mono />
          <Info label="Gateway" value=":37831" mono />
        </div>
        <div style={{ marginTop: 14 }}>
          <Button
            variant="secondary"
            onClick={() => {
              void signOut({ redirectUrl: "/sign-in" });
            }}
          >
            <LogOut size={14} /> Sign out
          </Button>
        </div>
      </Card>
    </div>
  );
}

function Info({
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
        padding: "8px 10px",
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
          fontSize: 12.5,
          fontFamily: mono ? "var(--rook-mono)" : undefined,
          color: tokens.text,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

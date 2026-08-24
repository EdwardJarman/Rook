import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";

import { Card, PrimaryButton, SectionHeader, StatusPill } from "@/components/rook-primitives";
import { useRookTheme } from "@/lib/ui";
import { trpc } from "@/lib/trpc";

/** The server base URL the node should dial. Web uses the current origin; native falls back to production. */
function serverOrigin(): string {
  if (Platform.OS === "web" && typeof window !== "undefined") return window.location.origin;
  return process.env.EXPO_PUBLIC_API_ORIGIN?.replace(/\/$/, "") || "https://www.rook.lighting";
}
function confirmRemoval(name: string, onConfirm: () => void): void {
  const message = `Remove ${name}? This computer will immediately lose access to your account until it is paired again.`;
  if (Platform.OS === "web") {
    if (window.confirm(message)) onConfirm();
    return;
  }
  import("react-native").then(({ Alert }) =>
    Alert.alert(`Remove ${name}?`, message, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: onConfirm },
    ]),
  );
}

/**
 * Your computers: the Rook Node desktop sidecars paired to this account.
 * Pairing mints a one-time code; the node exchanges it for a durable
 * credential. Sensitive commands queue here for approval before any node
 * can act on them.
 */
export function ComputersCard() {
  const { colors } = useRookTheme();
  const nodes = trpc.nodes.list.useQuery(undefined, { retry: 1 });
  const commands = trpc.nodes.commands.useQuery(undefined, {
    retry: 1,
    refetchInterval: 10_000,
  });
  const createPairing = trpc.nodes.createPairing.useMutation();
  const removeNode = trpc.nodes.remove.useMutation();
  const decideCommand = trpc.nodes.decideCommand.useMutation();
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pendingApprovals = (commands.data ?? []).filter((command) => command.state === "awaiting_approval");

  // Queries failing usually means the computers schema was never pushed to
  // the InstantDB backend; show it instead of pretending nothing is wrong.
  const backendError =
    nodes.isError || commands.isError
      ? "Your computers couldn't load — the computers backend may not be initialized yet (run `pnpm db:push` from the repo once)."
      : null;

  const startPairing = () => {
    setError(null);
    setPairingCode(null);
    void createPairing.mutateAsync().then((result) => {
      setPairingCode(result.token);
    }).catch(() => {
      setError("Rook could not mint a pairing code right now. If this keeps happening, the computers backend may still be initializing — try again in a minute.");
    });
  };

  const copyCode = async () => {
    if (!pairingCode) return;
    try {
      if (Platform.OS === "web") {
        await navigator.clipboard.writeText(pairingCode);
      }
    } catch {
      // Clipboard may be blocked; the code stays visible to copy manually.
    }
  };

  const confirmRemove = (nodeId: string, name: string) =>
    confirmRemoval(name, () => {
      setError(null);
      void removeNode.mutateAsync({ nodeId }).then(() => nodes.refetch()).catch(() => {
        setError("Rook could not remove that computer right now. Please try again.");
      });
    });

  const decide = (commandId: string, decision: "approved" | "declined") => {
    void decideCommand
      .mutateAsync({ commandId, decision })
      .then(() => commands.refetch())
      .catch(() => undefined);
  };

  return (
    <View style={{ gap: 12 }}>
      <SectionHeader
        title="Your computers"
        caption="Run Bots on your own machine. Press “Connect account” in the Rook Node app — no codes needed."
        action={
          <PrimaryButton label="Pair a computer" icon="computer" onPress={startPairing} disabled={createPairing.isPending} />
        }
      />

      {error || backendError ? (
        <Card style={{ gap: 6, flexDirection: "row", alignItems: "center" }}>
          <MaterialIcons name="shield" size={18} color={colors.coral} />
          <Text style={{ color: colors.text, fontSize: 12.5, flex: 1 }}>{error ?? backendError}</Text>
          <Pressable accessibilityRole="button" onPress={() => setError(null)}>
            <Text style={{ color: colors.textFaint, fontSize: 12 }}>Dismiss</Text>
          </Pressable>
        </Card>
      ) : null}

      {pendingApprovals.length > 0 ? (
        <View style={{ gap: 8 }}>
          {pendingApprovals.slice(0, 5).map((command) => (
            <Card key={command.commandId} style={{ gap: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <StatusPill label="Approval needed" tone="amber" />
                <Text style={{ color: colors.textFaint, fontSize: 11.5 }} numberOfLines={1}>
                  {new Date(command.createdAt).toLocaleTimeString()}
                </Text>
              </View>
              <Text style={{ color: colors.text, fontSize: 13.5, lineHeight: 19 }}>{command.summary}</Text>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => decide(command.commandId, "approved")}
                  style={{
                    backgroundColor: colors.ink,
                    borderRadius: 12,
                    paddingVertical: 9,
                    paddingHorizontal: 18,
                  }}
                >
                  <Text style={{ color: colors.onInk, fontWeight: "600", fontSize: 13 }}>Approve</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => decide(command.commandId, "declined")}
                  style={{
                    borderWidth: 1,
                    borderColor: colors.line ?? colors.surfaceAlt,
                    borderRadius: 12,
                    paddingVertical: 9,
                    paddingHorizontal: 18,
                  }}
                >
                  <Text style={{ color: colors.textSoft, fontWeight: "600", fontSize: 13 }}>Decline</Text>
                </Pressable>
              </View>
            </Card>
          ))}
        </View>
      ) : null}

      {pairingCode ? (
        <Card style={{ gap: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <MaterialIcons name="shield" size={18} color={colors.textSoft} />
            <Text style={{ color: colors.text, fontWeight: "600", fontSize: 13.5 }}>One-time pairing code</Text>
            <StatusPill label="Expires in 10 min" tone="amber" />
          </View>
          <Text style={{ color: colors.textFaint, fontSize: 12.5, lineHeight: 18 }}>
            In the rook-node folder on your computer, run:
          </Text>
          <Pressable accessibilityRole="button" onLongPress={copyCode}>
            <View
              style={{
                backgroundColor: colors.surfaceAlt,
                borderRadius: 12,
                paddingHorizontal: 12,
                paddingVertical: 10,
              }}
            >
              <Text style={{ color: colors.text, fontFamily: Platform.select({ web: "monospace" }), fontSize: 12 }} selectable>
                npx tsx src/index.ts --pair {pairingCode} --server {serverOrigin()}
              </Text>
            </View>
          </Pressable>
          <Text style={{ color: colors.textFaint, fontSize: 11.5 }}>
            The code works once and only pairs with your account.
          </Text>
        </Card>
      ) : null}

      {(nodes.data ?? []).length === 0 && !pairingCode && !backendError ? (
        <Card style={{ gap: 6, alignItems: "center", paddingVertical: 22 }}>
          <MaterialIcons name="devices" size={22} color={colors.textFaint} />
          <Text style={{ color: colors.text, fontWeight: "600", fontSize: 13.5 }}>No computers yet</Text>
          <Text style={{ color: colors.textFaint, fontSize: 12, textAlign: "center" }}>
            Pair your Windows, macOS, or Linux machine and your Bots can browse it safely under your control.
          </Text>
        </Card>
      ) : null}

      <View style={{ gap: 8 }}>
        {(nodes.data ?? []).map((node) => (
          <Card key={node.id} style={{ gap: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
              <MaterialIcons name="computer" size={20} color={colors.textSoft} />
              <Text style={{ color: colors.text, fontWeight: "600", fontSize: 14.5, flex: 1 }} numberOfLines={1}>
                {node.name}
              </Text>
              {node.status === "online" ? (
                <StatusPill label="Online" tone="mint" />
              ) : node.status === "revoked" ? (
                <StatusPill label="Revoked" tone="coral" />
              ) : (
                <StatusPill label="Offline" tone="muted" />
              )}
            </View>
            <Text style={{ color: colors.textFaint, fontSize: 11.5 }}>
              Last seen{" "}
              {node.lastSeenAt ? new Date(node.lastSeenAt).toLocaleString() : "never"}
              {node.version ? ` · node ${node.version}` : ""}
            </Text>
            {node.status !== "revoked" ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => confirmRemove(node.nodeId, node.name)}
                style={{ alignSelf: "flex-start", marginTop: 2 }}
              >
                <Text style={{ color: colors.coral, fontWeight: "600", fontSize: 12.5 }}>Remove computer</Text>
              </Pressable>
            ) : null}
          </Card>
        ))}
      </View>
    </View>
  );
}

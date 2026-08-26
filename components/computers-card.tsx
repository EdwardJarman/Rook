import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
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

function isAndroidClient(): boolean {
  if (Platform.OS === "android") return true;
  return Platform.OS === "web" && typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
}

/**
 * Primary download action: Android receives the mobile app; desktop clients
 * receive the platform-matched Rook Node installer. Users never see GitHub.
 */
function startDownload(): void {
  const url = `${serverOrigin()}${isAndroidClient() ? "/api/download/android" : "/api/download/node"}`;
  if (Platform.OS === "web") {
    window.location.href = url;
    return;
  }
  void import("react-native").then(({ Linking }) => void Linking.openURL(url));
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
  const router = useRouter();
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
  const [showCodeFlow, setShowCodeFlow] = useState(false);

  const pendingApprovals = (commands.data ?? []).filter((command) => command.state === "awaiting_approval");
  const isAndroid = isAndroidClient();

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
        title={isAndroid ? "Rook for Android" : "Your computers"}
        caption={isAndroid ? "Take your workroom, approvals, files, and Bot updates with you." : "Run Bots on your own machine. Download Rook Node, press Connect — done."}
        action={
          <PrimaryButton label={isAndroid ? "Download Rook for Android" : "Download Rook Node"} icon={isAndroid ? "phone-android" : "computer"} onPress={startDownload} />
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
            Advanced — for computers running Rook Node from source. In the rook-node folder, run:
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
            Download Rook Node on your Windows, macOS, or Linux machine, open it, and press “Connect account”. Your Bots browse safely under your control.
          </Text>
        </Card>
      ) : null}

      {!pairingCode ? (
        <View style={{ flexDirection: "row", gap: 16 }}>
          <Pressable accessibilityRole="button" onPress={() => router.push("/download")} style={{ alignSelf: "flex-start" }}>
            <Text style={{ color: colors.textFaint, fontSize: 12 }}>Other platforms</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => setShowCodeFlow((value) => !value)}
            style={{ alignSelf: "flex-start" }}
          >
            <Text style={{ color: colors.textFaint, fontSize: 12 }}>
              {showCodeFlow ? "Hide pairing code" : "Advanced: pair with a one-time code"}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {showCodeFlow && !pairingCode ? (
        <Card style={{ gap: 10, alignItems: "flex-start" }}>
          <Text style={{ color: colors.textFaint, fontSize: 12.5, lineHeight: 18 }}>
            For headless machines where the browser flow isn't available.
          </Text>
          <PrimaryButton label="Mint a pairing code" onPress={startPairing} disabled={createPairing.isPending} />
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

import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, Text, View } from "react-native";

import { Card, PrimaryButton, ScreenHeader, StatusPill } from "@/components/rook-primitives";
import { ScreenContainer } from "@/components/screen-container";
import { useAuth } from "@/hooks/use-auth";
import { useRookTheme } from "@/lib/ui";
import { trpc } from "@/lib/trpc";

/**
 * Browser-pairing landing page for Rook Node.
 *
 * The desktop app opens this page with ?state=…&port=…. Once the visitor is
 * signed in, we mint a one-time pairing token for their account and redirect
 * back to the node's loopback callback, which completes the handshake.
 */
export default function ConnectNodeScreen() {
  const params = useLocalSearchParams<{ state?: string | string[]; port?: string | string[] }>();
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const { colors } = useRookTheme();
  const createPairing = trpc.nodes.createPairing.useMutation();
  const [status, setStatus] = useState<"ready" | "working" | "redirecting" | "error">("ready");
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ state: string; port: number } | null>(null);

  const fromUrl = (() => {
    const state = Array.isArray(params.state) ? params.state[0] : params.state;
    const portRaw = Array.isArray(params.port) ? params.port[0] : params.port;
    const port = Number.parseInt(portRaw ?? "", 10);
    if (state && state.length >= 16 && Number.isInteger(port) && port >= 1024 && port <= 65535) {
      return { state, port };
    }
    return null;
  })();

  // The handshake must survive the sign-in detour: params are stashed in
  // localStorage and restored here even after the auth round-trip.
  useEffect(() => {
    if (fromUrl) {
      setLink(fromUrl);
      try {
        window.localStorage.removeItem("rook-connect-pending");
      } catch { }
      return;
    }
    if (Platform.OS === "web") {
      try {
        const stored = window.localStorage.getItem("rook-connect-pending");
        if (stored) {
          const parsed = JSON.parse(stored) as { state?: string; port?: number };
          if (parsed.state && typeof parsed.port === "number") setLink({ state: parsed.state, port: parsed.port });
        }
      } catch { }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const validLink = Boolean(link);

  useEffect(() => {
    if (isAuthenticated && status === "ready" && validLink && Platform.OS === "web") {
      void connect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, validLink]);

  const connect = async (): Promise<void> => {
    setError(null);
    if (Platform.OS !== "web") {
      setError("Open this connect link in your computer's browser, not on your phone.");
      return;
    }
    if (!link) {
      setError("This connect link is invalid or incomplete. Press “Connect account” in the Rook Node app and try again.");
      return;
    }
    setStatus("working");
    try {
      const { token } = await createPairing.mutateAsync();
      setStatus("redirecting");
      try {
        window.localStorage.removeItem("rook-connect-pending");
      } catch { }
      window.location.href = `http://localhost:${link.port}/pair?token=${encodeURIComponent(token)}&state=${encodeURIComponent(link.state)}`;
    } catch {
      setStatus("error");
      setError("Rook could not start the pairing handshake right now. Please try again in a moment.");
    }
  };

  const busy = status === "working" || status === "redirecting";

  return (
    <ScreenContainer containerClassName="bg-background" className="flex-1" edges={["top", "left", "right"]}>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <View style={{ width: "100%", maxWidth: 460, gap: 16 }}>
          <ScreenHeader title="Connect your computer" lead="Rook Node is asking to join your account." />

          <Card style={{ gap: 12 }}>
            {error ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <StatusPill label="Problem" tone="coral" />
                <Text style={{ color: colors.text, fontSize: 13, flex: 1, lineHeight: 19 }}>{error}</Text>
              </View>
            ) : status === "redirecting" ? (
              <StatusPill label="Returning to Rook Node…" tone="mint" />
            ) : busy ? (
              <StatusPill label="Starting handshake…" tone="amber" />
            ) : null}

            {!isAuthenticated ? (
              <>
                <Text style={{ color: colors.text, fontSize: 14, lineHeight: 20 }}>
                  Sign in to Rook first — then this page will hand the connection straight to your computer.
                </Text>
                <PrimaryButton
                  label="Sign in to Rook"
                  onPress={() => {
                    // Stash the handshake so the return from sign-in resumes it.
                    if (link && Platform.OS === "web") {
                      try {
                        window.localStorage.setItem("rook-connect-pending", JSON.stringify(link));
                      } catch { }
                    }
                    router.push("/sign-in");
                  }}
                />
                <Text style={{ color: colors.textFaint, fontSize: 12, lineHeight: 17 }}>
                  After signing in you'll come right back here automatically.
                </Text>
              </>
            ) : (
              <>
                <Text style={{ color: colors.text, fontSize: 14, lineHeight: 20 }}>
                  {busy
                    ? "Hold on — we're handing this connection back to your computer."
                    : "Confirm below and we'll hand this connection straight back to your computer. No codes, nothing to type."}
                </Text>
                <PrimaryButton label={busy ? "Connecting…" : "Connect this computer"} onPress={() => void connect()} disabled={busy || !validLink} />
              </>
            )}

            <Text style={{ color: colors.textFaint, fontSize: 11.5, lineHeight: 16 }}>
              This page only pairs computers you started from the Rook Node app. Pairing codes are single-use and never leave your account.
            </Text>
          </Card>
        </View>
      </View>
    </ScreenContainer>
  );
}

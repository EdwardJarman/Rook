import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";

import { Card, PrimaryButton, ScreenHeader, StatusPill } from "@/components/rook-primitives";
import { ScreenContainer } from "@/components/screen-container";
import { useAuth } from "@/hooks/use-auth";
import { useRookTheme } from "@/lib/ui";
import { trpc } from "@/lib/trpc";

/**
 * Browser-pairing landing page for Rook Node.
 *
 * The desktop app opens this page with ?state=…&port=…. We mint a one-time
 * pairing token for the signed-in account and redirect back to the node's
 * loopback callback. If the visitor isn't signed in yet, the handshake is
 * stashed in localStorage and resumed automatically after sign-in.
 */

const PENDING_KEY = "rook-connect-pending";

function readPendingLink(): { state: string; port: number } | null {
  if (Platform.OS !== "web") return null;
  try {
    const stored = window.localStorage.getItem(PENDING_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as { state?: string; port?: number };
    if (parsed.state && typeof parsed.port === "number") {
      return { state: parsed.state, port: parsed.port };
    }
  } catch { }
  return null;
}

export default function ConnectNodeScreen() {
  const params = useLocalSearchParams<{ state?: string | string[]; port?: string | string[] }>();
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const { colors } = useRookTheme();
  const createPairing = trpc.nodes.createPairing.useMutation();

  const [link, setLink] = useState<{ state: string; port: number } | null>(null);
  const [phase, setPhase] = useState<"boot" | "need-auth" | "working" | "redirecting" | "error">("boot");
  const [error, setError] = useState<string | null>(null);
  const [diag, setDiag] = useState("reading link…");
  const attemptedRef = useRef(false);

  // 1. Resolve the link from the URL, falling back to a stashed handshake.
  useEffect(() => {
    const state = Array.isArray(params.state) ? params.state[0] : params.state;
    const portRaw = Array.isArray(params.port) ? params.port[0] : params.port;
    const port = Number.parseInt(portRaw ?? "", 10);
    if (state && state.length >= 16 && Number.isInteger(port) && port >= 1024 && port <= 65535) {
      setLink({ state, port });
      setDiag("link received from Rook Node ✓");
      try {
        window.localStorage.removeItem(PENDING_KEY);
      } catch { }
      return;
    }
    const pending = readPendingLink();
    if (pending) {
      setLink(pending);
      setDiag("resuming your interrupted handshake ✓");
      return;
    }
    setDiag("no link parameters found — press “Connect account” in the Rook Node app");
  }, [params.state, params.port]);

  // 2. Mint a token and redirect. Auth is enforced by the server: a 401 just
  //    flips the page into sign-in mode — no client-side auth gating races.
  const connect = useCallback(async (): Promise<void> => {
    if (Platform.OS !== "web") {
      setError("Open this connect link in your computer's browser, not on your phone.");
      return;
    }
    if (!link) {
      setError("This connect link is invalid or incomplete. Press “Connect account” in the Rook Node app and try again.");
      return;
    }
    setPhase("working");
    setDiag("minting a one-time pairing token…");
    try {
      const { token } = await createPairing.mutateAsync();
      setDiag("token minted ✓ — returning to your computer…");
      setPhase("redirecting");
      try {
        window.localStorage.removeItem(PENDING_KEY);
      } catch { }
      window.location.href = `http://localhost:${link.port}/pair?token=${encodeURIComponent(token)}&state=${encodeURIComponent(link.state)}`;
    } catch (mutationError) {
      const message = mutationError instanceof Error ? mutationError.message : String(mutationError);
      if (/UNAUTHORIZED|not authenticated|401/i.test(message)) {
        setDiag("signed out — sign in to continue");
        setPhase("need-auth");
        attemptedRef.current = false; // retry automatically after sign-in
        return;
      }
      setDiag(`minting failed: ${message.slice(0, 140)}`);
      setPhase("error");
      setError("Rook could not start the pairing handshake right now. Please try again in a moment.");
    }
  }, [link, createPairing]);

  // 3. Auto-run once the link is known. If we end up in need-auth, the same
  //    effect retries automatically once the user is signed in.
  useEffect(() => {
    if (!link) return;
    if (attemptedRef.current) return;
    if (phase === "error") return;
    if (phase === "need-auth" && !isAuthenticated) return;
    attemptedRef.current = true;
    void connect();
  }, [link, phase, isAuthenticated, connect]);

  const busy = phase === "working" || phase === "redirecting";

  return (
    <ScreenContainer containerClassName="bg-background" className="flex-1" edges={["top", "left", "right"]}>
      <View style={{ flex: 1, alignItems: "center", padding: 24 }}>
        <View style={{ width: "100%", maxWidth: 520, gap: 16 }}>
          <ScreenHeader title="Connect your computer" lead="Rook Node is asking to join your account." />

          <Card style={{ gap: 12 }}>
            {phase === "need-auth" ? (
              <>
                <StatusPill label="Sign in to continue" tone="amber" />
                <Text style={{ color: colors.text, fontSize: 14, lineHeight: 20 }}>
                  Sign in below — you'll come straight back here and the connection will finish automatically.
                </Text>
                <PrimaryButton
                  label="Sign in to Rook"
                  onPress={() => {
                    if (link && Platform.OS === "web") {
                      try {
                        window.localStorage.setItem(PENDING_KEY, JSON.stringify(link));
                      } catch { }
                    }
                    router.push("/sign-in");
                  }}
                />
              </>
            ) : phase === "redirecting" ? (
              <StatusPill label="Returning to Rook Node…" tone="mint" />
            ) : busy ? (
              <StatusPill label="Connecting…" tone="amber" />
            ) : phase === "error" ? (
              <StatusPill label="Problem" tone="coral" />
            ) : (
              <StatusPill label="Ready" tone="mint" />
            )}

            {error ? (
              <Text style={{ color: colors.coral, fontSize: 13, lineHeight: 19 }}>{error}</Text>
            ) : null}

            {!busy && link ? (
              <PrimaryButton
                label="Connect this computer"
                onPress={() => {
                  attemptedRef.current = false;
                  void connect();
                }}
                disabled={busy}
              />
            ) : null}

            <Text style={{ color: colors.textFaint, fontSize: 11.5, lineHeight: 16 }}>
              This page only pairs computers you started from the Rook Node app. Pairing codes are single-use and never leave your account.
            </Text>

            {/* Self-diagnostics: if pairing stalls, this line says where. */}
            <Text style={{ color: colors.textFaint, fontSize: 10.5, fontFamily: Platform.select({ web: "monospace" }) }}>
              diag: {diag} · auth: {isAuthenticated ? "in" : "out"} · link: {link ? "ok" : "none"} · phase: {phase}
            </Text>
          </Card>
        </View>
      </View>
    </ScreenContainer>
  );
}

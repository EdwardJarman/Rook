import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";

import { Card, PrimaryButton, ScreenHeader, StatusPill } from "@/components/rook-primitives";
import { ScreenContainer } from "@/components/screen-container";
import { useAuth } from "@/hooks/use-auth";
import { useRookTheme } from "@/lib/ui";
import { trpc } from "@/lib/trpc";

/**
 * Desktop pairing confirmation page.
 *
 * Rook Node opens this page with an opaque request id. The user signs into an
 * existing Rook account here, then receives a short-lived code to enter back
 * into the desktop app. No token, localhost callback, or durable secret is
 * placed in the browser URL.
 */
// Keep this key aligned with SessionNavigator, which restores this handoff after Clerk sign-in.
const PENDING_KEY = "rook-connect-pending";
const REQUEST_PATTERN = /^rkd-[a-f0-9]{48}$/i;

type Phase = "boot" | "need-auth" | "issuing" | "ready" | "expired" | "error";

function readPendingRequest(): string | null {
  if (Platform.OS !== "web") return null;
  try {
    const requestId = window.localStorage.getItem(PENDING_KEY);
    return requestId && REQUEST_PATTERN.test(requestId) ? requestId.toLowerCase() : null;
  } catch {
    return null;
  }
}

function formatCode(code: string) {
  const compact = code.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  return compact.length === 8 ? `${compact.slice(0, 4)}-${compact.slice(4)}` : code;
}

export default function ConnectNodeScreen() {
  const params = useLocalSearchParams<{ request?: string | string[] }>();
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const { colors } = useRookTheme();
  const issueCode = trpc.nodes.issueDesktopPairingCode.useMutation();

  const [requestId, setRequestId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("boot");
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const attemptedRef = useRef(false);

  useEffect(() => {
    const fromParams = Array.isArray(params.request) ? params.request[0] : params.request;
    let candidate = fromParams;
    if (!candidate && Platform.OS === "web") {
      try { candidate = new URLSearchParams(window.location.search).get("request") ?? undefined; } catch { }
    }
    const normalized = candidate && REQUEST_PATTERN.test(candidate) ? candidate.toLowerCase() : readPendingRequest();
    if (normalized) {
      attemptedRef.current = false;
      setRequestId(normalized);
      setPhase("boot");
    } else {
      setPhase("error");
      setError("This computer connection link is missing or has expired. Start again from the Rook desktop app.");
    }
  }, [params.request]);

  const mintCode = useCallback(async () => {
    if (!requestId) return;
    if (!isAuthenticated) {
      setPhase("need-auth");
      return;
    }
    setPhase("issuing");
    setError(null);
    try {
      const issued = await issueCode.mutateAsync({ requestId });
      setCode(formatCode(issued.code));
      setExpiresAt(new Date(issued.expiresAt).getTime());
      setPhase("ready");
      try { window.localStorage.removeItem(PENDING_KEY); } catch { }
    } catch (mutationError) {
      const message = mutationError instanceof Error ? mutationError.message : String(mutationError);
      if (/UNAUTHORIZED|not authenticated|401/i.test(message)) {
        setPhase("need-auth");
        return;
      }
      setPhase("error");
      setError("Rook could not generate a desktop code. Return to the desktop app and start a fresh connection.");
    }
  }, [isAuthenticated, issueCode, requestId]);

  useEffect(() => {
    if (!requestId || attemptedRef.current) return;
    if (!isAuthenticated) {
      setPhase("need-auth");
      return;
    }
    attemptedRef.current = true;
    void mintCode();
  }, [isAuthenticated, mintCode, requestId]);

  useEffect(() => {
    if (!expiresAt || phase !== "ready") return;
    const tick = () => {
      const next = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setSecondsLeft(next);
      if (next === 0) setPhase("expired");
    };
    tick();
    const timer = setInterval(tick, 1_000);
    return () => clearInterval(timer);
  }, [expiresAt, phase]);

  const copyCode = useCallback(async () => {
    if (!code || Platform.OS !== "web") return;
    try { await navigator.clipboard.writeText(code); } catch { }
  }, [code]);

  const signIn = useCallback(() => {
    if (requestId && Platform.OS === "web") {
      try { window.localStorage.setItem(PENDING_KEY, requestId); } catch { }
    }
    router.push("/sign-in");
  }, [requestId, router]);

  const busy = phase === "issuing";
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = String(secondsLeft % 60).padStart(2, "0");

  return (
    <ScreenContainer containerClassName="bg-background" className="flex-1" edges={["top", "left", "right"]}>
      <View style={{ flex: 1, alignItems: "center", padding: 24 }}>
        <View style={{ width: "100%", maxWidth: 520, gap: 16 }}>
          <ScreenHeader title="Connect your computer" lead="Sign in to Rook, then enter the one-time code in the desktop app." />
          <Card style={{ gap: 14 }}>
            {phase === "need-auth" ? <StatusPill label="Sign in to continue" tone="amber" /> : null}
            {phase === "issuing" ? <StatusPill label="Generating secure code…" tone="amber" /> : null}
            {phase === "ready" ? <StatusPill label="Code ready" tone="mint" /> : null}
            {phase === "expired" ? <StatusPill label="Code expired" tone="amber" /> : null}
            {phase === "error" ? <StatusPill label="Problem" tone="coral" /> : null}

            {phase === "need-auth" ? (
              <>
                <Text style={{ color: colors.text, fontSize: 14, lineHeight: 20 }}>
                  Sign in with the same Rook account you use on the web. You will return here automatically and Rook will generate a code for this computer.
                </Text>
                <PrimaryButton label="Sign in to Rook" onPress={signIn} />
              </>
            ) : null}

            {phase === "ready" && code ? (
              <>
                <Text style={{ color: colors.text, fontSize: 14, lineHeight: 20 }}>
                  Enter this code in the Rook desktop app. It works once and expires in {minutes}:{seconds}.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Copy desktop connection code"
                  onPress={() => void copyCode()}
                  style={({ pressed }) => ({
                    alignSelf: "center",
                    minWidth: 236,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: colors.lineStrong,
                    backgroundColor: colors.surfaceAlt,
                    paddingHorizontal: 20,
                    paddingVertical: 16,
                    opacity: pressed ? 0.72 : 1,
                  })}
                >
                  <Text selectable style={{ color: colors.text, textAlign: "center", fontFamily: Platform.select({ web: "monospace" }), fontSize: 26, fontWeight: "800", letterSpacing: 3 }}>
                    {code}
                  </Text>
                  <Text style={{ color: colors.textSoft, textAlign: "center", fontSize: 11.5, marginTop: 7 }}>Select or click to copy</Text>
                </Pressable>
                <Text style={{ color: colors.textFaint, fontSize: 12, lineHeight: 17 }}>
                  Keep this window open until the desktop app says Connected. Never share this code.
                </Text>
              </>
            ) : null}

            {phase === "expired" ? (
              <>
                <Text style={{ color: colors.text, fontSize: 14, lineHeight: 20 }}>For your security, each desktop code is valid for a few minutes and can be used only once.</Text>
                <PrimaryButton label="Generate a new code" onPress={() => void mintCode()} />
              </>
            ) : null}

            {phase === "error" && error ? <Text style={{ color: colors.coral, fontSize: 13, lineHeight: 19 }}>{error}</Text> : null}
            {phase === "error" && requestId ? <PrimaryButton label="Try again" onPress={() => { attemptedRef.current = true; void mintCode(); }} /> : null}
            {busy ? <Text style={{ color: colors.textFaint, fontSize: 12 }}>Checking your signed-in Rook account…</Text> : null}
          </Card>
        </View>
      </View>
    </ScreenContainer>
  );
}

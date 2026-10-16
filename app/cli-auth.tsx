import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useAuth as useClerkAuth } from "@clerk/expo";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { getApiBaseUrl } from "@/constants/oauth";
import { deliverCliApproval, isTerminalAlive, parseCallbackPort } from "@/lib/cli-auth";
import { trpc } from "@/lib/trpc";
import { useRookTheme } from "@/lib/ui";

async function copyText(value: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(value);
      return true;
    }
    const Clipboard = await import("expo-clipboard");
    await Clipboard.setStringAsync(value);
    return true;
  } catch {
    return false;
  }
}

type Phase =
  | { name: "review" }
  | { name: "working" }
  | { name: "done" }
  | { name: "failed"; message: string; token?: string };

/**
 * Device approval for `rook login`.
 *
 * Two branches, split on the query string:
 * - `?code=XXXX-XXXX` (current CLIs): the code is shown for verification
 *   and approval attaches the token to the server-side challenge. The
 *   terminal polls and picks it up — no localhost listener anywhere.
 * - `?port=&key=` (legacy CLIs): the original localhost-callback delivery
 *   with liveness probing and a manual-token fallback.
 */
export default function CliAuthScreen() {
  const { colors } = useRookTheme();
  const router = useRouter();
  const { isSignedIn } = useClerkAuth();
  const params = useLocalSearchParams<{ port?: string; key?: string; code?: string }>();
  const [phase, setPhase] = useState<Phase>({ name: "review" });
  const [tokenCopied, setTokenCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const createToken = trpc.auth.createCliToken.useMutation();
  const approveDevice = trpc.auth.deviceApprove.useMutation();

  const rawCode = typeof params.code === "string" ? params.code.trim() : "";
  const deviceCode = rawCode ? rawCode : null;
  const port = deviceCode ? null : parseCallbackPort(params.port);
  const key = !deviceCode && typeof params.key === "string" && params.key ? params.key : null;
  const apiUrl = getApiBaseUrl() || (typeof window !== "undefined" ? window.location.origin : "");
  // Liveness (legacy branch only): a terminal that already exited
  // (timeout, closed window) cannot receive the approval — say so before
  // the user approves into the void. Polls lightly while pending.
  const [terminalGone, setTerminalGone] = useState(false);
  useEffect(() => {
    if (!port || phase.name !== "review") return;
    let cancelled = false;
    const check = async () => {
      try {
        if (!(await isTerminalAlive(port)) && !cancelled) setTerminalGone(true);
      } catch {
        // A failed probe must never break the page; approving still mints.
      }
    };
    void check();
    const timer = setInterval(() => void check(), 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [port, phase.name]);

  const approveLegacy = async () => {
    if (!port || !key || phase.name === "working") return;
    setPhase({ name: "working" });
    let token: string | undefined;
    try {
      ({ token } = await createToken.mutateAsync({
        label: `CLI (${Platform.OS})`,
      }));
      // The terminal may be starting up or briefly unreachable: retry
      // before falling back to a manual paste.
      await deliverCliApproval(port, { key, token, apiUrl });
      setPhase({ name: "done" });
    } catch {
      // Terminal gone (closed tab, timeout): hand the token over
      // manually instead of failing the whole approval.
      setPhase(
        token
          ? { name: "failed", message: "The terminal stopped listening.", token }
          : { name: "failed", message: "Rook could not mint a CLI token right now. Please try again." },
      );
    }
  };

  const approve = async () => {
    if (phase.name === "working") return;
    if (deviceCode) {
      // Device branch: approval happens server-side on the challenge.
      // There is no terminal listener to strand — a closed terminal
      // simply stops polling, and an unknown/expired code fails here
      // with a re-run hint instead of stranding anything.
      setPhase({ name: "working" });
      try {
        await approveDevice.mutateAsync({
          code: deviceCode,
          label: `CLI (${Platform.OS})`,
        });
        setPhase({ name: "done" });
      } catch (error) {
        setPhase({
          name: "failed",
          message:
            error instanceof Error && error.message
              ? error.message
              : "Rook could not approve that code right now. Please try again.",
        });
      }
      return;
    }
    await approveLegacy();
  };

  const copyToken = async (token: string) => {
    setTokenCopied(await copyText(token));
    setTimeout(() => setTokenCopied(false), 1800);
  };

  const copyCode = async (code: string) => {
    setCodeCopied(await copyText(code));
    setTimeout(() => setCodeCopied(false), 1800);
  };

  const busy = phase.name === "working" || createToken.isPending || approveDevice.isPending;
  const canApprove = deviceCode ? !!deviceCode && !busy : !!port && !!key && !busy;
  const headline = deviceCode ? "Connect this device?" : "Connect the Rook CLI?";
  const intro = deviceCode
    ? "Your terminal asked to sign in with this account. Check the code matches, then approve — your terminal picks up the sign-in on its own."
    : port && key
      ? "Your terminal asked to sign in with this account. Approving mints a CLI token for that device only."
      : "This page pairs a terminal running `rook login`. Start there first — it opens this page for you.";

  return (
    <ScreenContainer containerClassName="bg-background" className="flex-1">
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 24,
          gap: 14,
          maxWidth: 480,
          width: "100%",
          alignSelf: "center",
        }}
      >
        <MaterialIcons name="terminal" size={30} color={colors.accent} />
        <Text style={{ color: colors.text, fontSize: 21, fontWeight: "700", textAlign: "center" }}>
          {headline}
        </Text>
        <Text style={{ color: colors.textSoft, fontSize: 13.5, lineHeight: 19, textAlign: "center" }}>
          {intro}
        </Text>
        {deviceCode ? (
          <View style={{ gap: 8, alignItems: "center" }}>
            <Text selectable style={{ color: colors.text, fontSize: 26, fontWeight: "800", letterSpacing: 3, fontFamily: "monospace" }}>
              {deviceCode.toUpperCase()}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={codeCopied ? "Code copied" : "Copy code"}
              onPress={() => void copyCode(deviceCode)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                paddingHorizontal: 14,
                paddingVertical: 9,
                borderRadius: 11,
                backgroundColor: colors.surfaceAlt,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <MaterialIcons
                name={codeCopied ? "check" : "content-copy"}
                size={15}
                color={codeCopied ? colors.mint : colors.textSoft}
              />
              <Text style={{ color: colors.textSoft, fontSize: 12.5, fontWeight: "700" }}>
                {codeCopied ? "Copied" : "Copy code"}
              </Text>
            </Pressable>
          </View>
        ) : null}
        {terminalGone && port && key ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: colors.surfaceAlt }}>
            <MaterialIcons name="warning-amber" size={16} color={colors.amber} />
            <Text style={{ color: colors.textSoft, fontSize: 12, lineHeight: 17, flex: 1 }}>
              That terminal looks closed — approving cannot reach it. Re-run `rook login` for a fresh code, or approve below and paste the token manually.
            </Text>
          </View>
        ) : null}

        {!isSignedIn ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sign in first"
            onPress={() => router.navigate("/sign-in" as never)}
            style={{ minHeight: 46, borderRadius: 15, paddingHorizontal: 22, backgroundColor: colors.ink, alignItems: "center", justifyContent: "center" }}
          >
            <Text style={{ color: colors.onInk, fontSize: 14, fontWeight: "700" }}>Sign in first</Text>
          </Pressable>
        ) : phase.name === "done" ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <MaterialIcons name="check-circle" size={18} color={colors.mint} />
            <Text style={{ color: colors.text, fontSize: 14, fontWeight: "600" }}>
              Device connected — return to your terminal.
            </Text>
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Approve this device"
            disabled={!canApprove}
            onPress={() => void approve()}
            style={{ minHeight: 46, borderRadius: 15, paddingHorizontal: 22, backgroundColor: colors.ink, alignItems: "center", justifyContent: "center", opacity: !canApprove ? 0.5 : 1 }}
          >
            <Text style={{ color: colors.onInk, fontSize: 14, fontWeight: "700" }}>
              {busy ? "Approving…" : "Approve this device"}
            </Text>
          </Pressable>
        )}

        {phase.name === "failed" ? (
          <View style={{ gap: 8, alignItems: "center" }}>
            <Text style={{ color: colors.coral, fontSize: 13, textAlign: "center" }}>
              {phase.message}
            </Text>
            {phase.token ? (
              <Text selectable style={{ color: colors.text, fontSize: 12, fontFamily: "monospace" }}>
                {phase.token}
              </Text>
            ) : null}
            {phase.token ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={tokenCopied ? "Token copied" : "Copy token"}
                onPress={() => void copyToken(phase.token as string)}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  paddingHorizontal: 14,
                  paddingVertical: 9,
                  borderRadius: 11,
                  backgroundColor: colors.surfaceAlt,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <MaterialIcons
                  name={tokenCopied ? "check" : "content-copy"}
                  size={15}
                  color={tokenCopied ? colors.mint : colors.textSoft}
                />
                <Text style={{ color: colors.textSoft, fontSize: 12.5, fontWeight: "700" }}>
                  {tokenCopied ? "Copied" : "Copy token"}
                </Text>
              </Pressable>
            ) : null}
            {phase.token ? (
              <Text style={{ color: colors.textFaint, fontSize: 11.5, textAlign: "center" }}>
                Paste it with: rook login --token (server: {apiUrl || "this Rook"})
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
    </ScreenContainer>
  );
}

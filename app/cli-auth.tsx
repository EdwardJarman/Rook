import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useAuth as useClerkAuth } from "@clerk/expo";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { getApiBaseUrl } from "@/constants/oauth";
import { parseCallbackPort, postCliCallback } from "@/lib/cli-auth";
import { trpc } from "@/lib/trpc";
import { useRookTheme } from "@/lib/ui";

type Phase =
  | { name: "review" }
  | { name: "working" }
  | { name: "done" }
  | { name: "failed"; message: string; token?: string };

/** Device approval for `rook login`: mints a CLI token and hands it to the waiting terminal. */
export default function CliAuthScreen() {
  const { colors } = useRookTheme();
  const router = useRouter();
  const { isSignedIn } = useClerkAuth();
  const params = useLocalSearchParams<{ port?: string; key?: string }>();
  const [phase, setPhase] = useState<Phase>({ name: "review" });
  const createToken = trpc.auth.createCliToken.useMutation();

  const port = parseCallbackPort(params.port);
  const key = typeof params.key === "string" && params.key ? params.key : null;
  const apiUrl = getApiBaseUrl() || (typeof window !== "undefined" ? window.location.origin : "");

  const approve = async () => {
    if (!port || !key || phase.name === "working") return;
    setPhase({ name: "working" });
    try {
      const { token } = await createToken.mutateAsync({
        label: `CLI (${Platform.OS})`,
      });
      try {
        await postCliCallback(port, { key, token, apiUrl });
        setPhase({ name: "done" });
      } catch {
        // Terminal gone (closed tab, timeout): hand the token over
        // manually instead of failing the whole approval.
        setPhase({ name: "failed", message: "The terminal stopped listening.", token });
      }
    } catch {
      setPhase({
        name: "failed",
        message: "Rook could not mint a CLI token right now. Please try again.",
      });
    }
  };

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
          Connect the Rook CLI?
        </Text>
        <Text style={{ color: colors.textSoft, fontSize: 13.5, lineHeight: 19, textAlign: "center" }}>
          {port && key
            ? "Your terminal asked to sign in with this account. Approving mints a CLI token for that device only."
            : "This page pairs a terminal running `rook login`. Start there first — it opens this page for you."}
        </Text>

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
            disabled={!port || !key || phase.name === "working" || createToken.isPending}
            onPress={() => void approve()}
            style={{ minHeight: 46, borderRadius: 15, paddingHorizontal: 22, backgroundColor: colors.ink, alignItems: "center", justifyContent: "center", opacity: !port || !key ? 0.5 : 1 }}
          >
            <Text style={{ color: colors.onInk, fontSize: 14, fontWeight: "700" }}>
              {phase.name === "working" || createToken.isPending ? "Approving…" : "Approve this device"}
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

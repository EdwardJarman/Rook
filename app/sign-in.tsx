import { useHostedAuth } from "@clerk/expo/hosted-auth";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as Linking from "expo-linking";
import { useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { RookLogo } from "@/components/rook-logo";
import { useRookTheme } from "@/components/rook-primitives";
import { ScreenContainer } from "@/components/screen-container";

type AuthMode = "sign-in" | "sign-up";

export default function SignInScreen() {
  const { colors } = useRookTheme();
  const { startHostedAuth } = useHostedAuth();
  const [mode, setMode] = useState<AuthMode | null>(null);

  const begin = async (nextMode: AuthMode) => {
    setMode(nextMode);
    try {
      // Use an explicit application route instead of a bare scheme (`manusrook:///`).
      // Expo Router can resume this route, after which Clerk activates the session and
      // the session navigator immediately opens the user's workroom.
      const redirectUrl = Platform.OS === "web" ? undefined : Linking.createURL("/sign-in");
      await startHostedAuth({
        mode: nextMode,
        ...(redirectUrl ? { redirectUrl } : {}),
        authSessionOptions: { showInRecents: false },
      });
    } catch {
      Alert.alert("Sign-in unavailable", "Rook could not complete secure sign-in. Please check your connection and try again.");
    } finally {
      setMode(null);
    }
  };

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]} containerClassName="bg-background" className="flex-1">
      <View style={styles.screen}>
        <View style={[styles.mark, { backgroundColor: colors.ink }]}>
          <RookLogo size={54} color={colors.onInk} />
        </View>
        <Text style={[styles.wordmark, { color: colors.text }]}>Rook</Text>
        <Text style={[styles.title, { color: colors.text }]}>A small team for{"\n"}your real work.</Text>
        <Text style={[styles.detail, { color: colors.textSoft }]}>
          Make every Bot your own. Keep conversations, decisions, and files close without the noise.
        </Text>
        <View style={styles.actions}>
          <AuthButton
            mode="sign-in"
            label="Sign in"
            icon="login"
            loading={mode}
            onPress={() => void begin("sign-in")}
            primary
          />
          <AuthButton mode="sign-up" label="Create an account" icon="person-add-alt-1" loading={mode} onPress={() => void begin("sign-up")} />
        </View>
        <Text style={[styles.legal, { color: colors.textFaint }]}>
          Secure sign-in is provided by Clerk. Rook never sees your password.
        </Text>
      </View>
    </ScreenContainer>
  );
}

function AuthButton({
  mode,
  label,
  icon,
  loading,
  onPress,
  primary,
}: {
  mode: AuthMode;
  label: string;
  icon: "login" | "person-add-alt-1";
  loading: AuthMode | null;
  onPress: () => void;
  primary?: boolean;
}) {
  const { colors } = useRookTheme();
  const isLoading = loading === mode;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={Boolean(loading)}
      style={({ pressed }) => [
        primary
          ? { ...styles.providerButton, backgroundColor: colors.ink, borderColor: colors.ink }
          : { ...styles.providerButton, backgroundColor: "transparent", borderColor: colors.lineStrong },
        pressed && !loading && styles.pressed,
        Boolean(loading) && styles.disabled,
      ]}
    >
      {isLoading ? (
        <ActivityIndicator color={primary ? colors.onInk : colors.text} />
      ) : (
        <MaterialIcons name={icon} size={19} color={primary ? colors.onInk : colors.text} />
      )}
      <Text style={[styles.providerText, { color: primary ? colors.onInk : colors.text }]}>
        {isLoading ? "Opening secure sign-in…" : label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 27, paddingBottom: 20 },
  mark: { width: 74, height: 74, borderRadius: 25, alignItems: "center", justifyContent: "center", marginBottom: 18 },
  wordmark: { fontSize: 20, letterSpacing: -0.8, fontWeight: "700", marginBottom: 10 },
  title: { fontSize: 29, lineHeight: 35, letterSpacing: -0.9, fontWeight: "700", textAlign: "center" },
  detail: { textAlign: "center", fontSize: 14, lineHeight: 21, marginTop: 11, maxWidth: 335 },
  actions: { width: "100%", maxWidth: 300, gap: 10, marginTop: 30 },
  providerButton: {
    height: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderRadius: 18,
    borderWidth: 1,
  },
  providerText: { fontSize: 15, fontWeight: "600", letterSpacing: -0.1 },
  legal: { fontSize: 11, lineHeight: 16, textAlign: "center", marginTop: 18, maxWidth: 335 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.66 },
});

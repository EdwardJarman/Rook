import { useAuth as useClerkAuth } from "@clerk/expo";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as Clipboard from "expo-clipboard";
import * as Linking from "expo-linking";
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";

import { getApiBaseUrl } from "@/constants/oauth";
import { Card, StatusPill } from "@/components/rook-primitives";
import { tint, useRookTheme } from "@/lib/ui";
import { trpc } from "@/lib/trpc";
import { useWorkroom } from "@/lib/workroom-store";

type ChatGPTUser = { email?: string; name?: string; plan?: string };
type SessionResponse = {
  status: "unauthenticated" | "pending" | "authenticated" | "expired" | "error";
  user?: ChatGPTUser;
};
type LoginResponse = SessionResponse & {
  userCode?: string;
  verificationUrl?: string;
  interval?: number;
};

class ChatGPTRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ChatGPTRequestError";
  }
}

export function ChatGPTConnectionCard() {
  const { colors, dark } = useRookTheme();
  const { getToken } = useClerkAuth();
  const { aiProvider, setAiProvider } = useWorkroom();
  const utils = trpc.useUtils();
  const getTokenRef = useRef(getToken);
  const utilsRef = useRef(utils);
  getTokenRef.current = getToken;
  utilsRef.current = utils;
  const [session, setSession] = useState<SessionResponse>({ status: "unauthenticated" });
  const [loading, setLoading] = useState(true);
  const [consenting, setConsenting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [login, setLogin] = useState<LoginResponse | null>(null);
  const [modelCount, setModelCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const pollFailures = useRef(0);

  const request = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const token = await getTokenRef.current();
    if (!token) throw new Error("Sign in to Rook first.");
    const response = await fetch(`${getApiBaseUrl()}/api/chatgpt${path}`, {
      ...init,
      headers: { Accept: "application/json", Authorization: `Bearer ${token}`, ...init?.headers },
      credentials: "include",
    });
    const body = await response.json().catch(() => ({})) as T & { message?: string };
    if (!response.ok) {
      const retryAfter = Number(response.headers.get("retry-after"));
      throw new ChatGPTRequestError(
        body.message || `ChatGPT request failed (${response.status}).`,
        response.status,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
      );
    }
    return body;
  }, []);

  const loadModels = useCallback(async () => {
    const data = await request<{ models?: string[] }>("/models");
    if (!mounted.current) return;
    setModelCount(data.models?.length ?? 0);
    await utilsRef.current.ai.models.invalidate();
  }, [request]);

  const refreshSession = useCallback(async () => {
    try {
      const data = await request<SessionResponse>("/session");
      if (!mounted.current) return;
      setSession(data.status === "pending" ? { status: "unauthenticated" } : data);
      if (data.status === "authenticated") await loadModels();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ChatGPT connection is unavailable.");
    } finally {
      setLoading(false);
    }
  }, [loadModels, request]);

  useEffect(() => {
    mounted.current = true;
    void refreshSession();
    return () => {
      mounted.current = false;
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [refreshSession]);

  const poll = useCallback(async (intervalSeconds = 3) => {
    try {
      const data = await request<SessionResponse>("/status");
      if (!mounted.current) return;
      pollFailures.current = 0;
      if (data.status === "authenticated") {
        setSession(data);
        setLogin(null);
        setConnecting(false);
        setError(null);
        await loadModels();
        return;
      }
      if (data.status === "expired" || data.status === "error") {
        setConnecting(false);
        setError("The ChatGPT authorization expired. Start again to receive a new code.");
        return;
      }
    } catch (cause) {
      if (!mounted.current) return;
      pollFailures.current += 1;
      const rateLimited = cause instanceof ChatGPTRequestError && (cause.status === 429 || cause.status === 503);
      setError(rateLimited
        ? "ChatGPT is temporarily rate limited. Rook will retry automatically."
        : cause instanceof Error ? cause.message : "Could not check ChatGPT authorization.");
      const retryAfter = cause instanceof ChatGPTRequestError ? cause.retryAfterSeconds : undefined;
      const delaySeconds = rateLimited
        ? Math.max(retryAfter ?? 15, Math.min(60, pollFailures.current * 10))
        : Math.max(intervalSeconds, 5);
      pollTimer.current = setTimeout(() => void poll(intervalSeconds), delaySeconds * 1000);
      return;
    }
    pollTimer.current = setTimeout(() => void poll(intervalSeconds), Math.max(2500, intervalSeconds * 1000));
  }, [loadModels, request]);

  const beginLogin = async () => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollFailures.current = 0;
    setConsenting(false);
    setConnecting(true);
    setError(null);
    const popup = Platform.OS === "web"
      ? window.open("", "rook-chatgpt", "popup=yes,width=520,height=680,menubar=no,toolbar=no,location=yes")
      : null;
    try {
      const data = await request<LoginResponse>("/login", { method: "POST" });
      if (!data.userCode || !data.verificationUrl) throw new Error("OpenAI did not return an authorization code.");
      const verificationUrl = requireSecureVerificationUrl(data.verificationUrl);
      setLogin({ ...data, verificationUrl });
      await Clipboard.setStringAsync(data.userCode).catch(() => undefined);
      if (Platform.OS === "web" && popup) {
        popup.location.href = verificationUrl;
        popup.focus();
      } else {
        await Linking.openURL(verificationUrl);
      }
      void poll(data.interval ?? 3);
    } catch (cause) {
      popup?.close();
      setConnecting(false);
      setError(cause instanceof Error ? cause.message : "Could not start ChatGPT authorization.");
    }
  };

  const disconnect = async () => {
    setLoading(true);
    setError(null);
    try {
      await request<SessionResponse>("/logout", { method: "POST" });
      setSession({ status: "unauthenticated" });
      setLogin(null);
      setModelCount(0);
      if (aiProvider === "chatgpt") setAiProvider("openrouter");
      await utilsRef.current.ai.models.invalidate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not disconnect ChatGPT.");
    } finally {
      setLoading(false);
    }
  };

  const connected = session.status === "authenticated";

  return (
    <Card style={{ gap: 14 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 13 }}>
        <View style={{ width: 44, height: 44, borderRadius: 15, backgroundColor: dark ? "#F4F4F0" : "#121212", alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: dark ? "#111111" : "#FFFFFF", fontSize: 19, fontWeight: "700" }}>C</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: colors.text, fontSize: 14.5, fontWeight: "700" }}>ChatGPT</Text>
          <Text numberOfLines={1} style={{ color: colors.textFaint, fontSize: 11.5, marginTop: 2 }}>
            {connected
              ? `${session.user?.plan ? `${titleCase(session.user.plan)} plan` : "Connected plan"} · ${modelCount} models`
              : "Use your own ChatGPT plan for Rook Bots"}
          </Text>
        </View>
        <StatusPill label={loading ? "Checking" : connected ? "Connected" : connecting ? "Waiting" : "Optional"} tone={connected ? "mint" : connecting ? "amber" : "muted"} />
      </View>

      {connected ? (
        <>
          <View style={{ borderRadius: 14, backgroundColor: colors.surfaceAlt, paddingHorizontal: 13, paddingVertical: 11, flexDirection: "row", alignItems: "center", gap: 10 }}>
            <MaterialIcons name="verified-user" size={17} color={colors.mint} />
            <Text style={{ flex: 1, color: colors.textSoft, fontSize: 11.5, lineHeight: 16 }}>
              Tokens stay encrypted in Rook’s server-only account metadata. Your password is never shared with Rook.
            </Text>
          </View>
          <Pressable accessibilityRole="button" onPress={() => void disconnect()} style={({ pressed }) => ({ alignSelf: "flex-start", paddingVertical: 6, opacity: pressed ? 0.55 : 1 })}>
            <Text style={{ color: colors.coral, fontSize: 12.5, fontWeight: "600" }}>Disconnect ChatGPT</Text>
          </Pressable>
        </>
      ) : consenting ? (
        <View style={{ borderRadius: 16, borderWidth: 1, borderColor: tint(colors.amber, 0.35), backgroundColor: tint(colors.amber, dark ? 0.08 : 0.05), padding: 14, gap: 11 }}>
          <Text style={{ color: colors.text, fontSize: 13.5, fontWeight: "700" }}>Authorize Rook to use your ChatGPT plan?</Text>
          <ConsentLine text="Rook can send AI requests against your plan until you disconnect. Heavy use can exhaust your plan’s limits." />
          <ConsentLine text="Your prompts pass through Rook’s server before reaching OpenAI. Tokens are encrypted and never sent to your browser." />
          <ConsentLine text="Rook never receives your ChatGPT password. Disconnecting deletes the stored session." />
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Pressable onPress={() => setConsenting(false)} style={({ pressed }) => ({ flex: 1, minHeight: 42, borderRadius: 13, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.65 : 1 })}>
              <Text style={{ color: colors.textSoft, fontSize: 12.5, fontWeight: "600" }}>Cancel</Text>
            </Pressable>
            <Pressable onPress={() => void beginLogin()} style={({ pressed }) => ({ flex: 1.5, minHeight: 42, borderRadius: 13, backgroundColor: colors.text, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.75 : 1 })}>
              <Text style={{ color: colors.canvas, fontSize: 12.5, fontWeight: "700" }}>I trust Rook, continue</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={() => setConsenting(true)}
          disabled={loading || connecting}
          style={({ pressed }) => ({ minHeight: 46, borderRadius: 14, backgroundColor: colors.text, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, opacity: loading || connecting ? 0.5 : pressed ? 0.75 : 1 })}
        >
          <MaterialIcons name="login" size={17} color={colors.canvas} />
          <Text style={{ color: colors.canvas, fontSize: 13, fontWeight: "700" }}>{connecting ? "Waiting for ChatGPT…" : "Connect ChatGPT"}</Text>
        </Pressable>
      )}

      {login?.userCode && connecting ? (
        <View style={{ borderRadius: 14, backgroundColor: colors.surfaceAlt, padding: 13, gap: 8 }}>
          <Text style={{ color: colors.textFaint, fontSize: 11 }}>Paste this code in the OpenAI window</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Text selectable style={{ flex: 1, color: colors.text, fontSize: 20, fontWeight: "700", letterSpacing: 2 }}>{login.userCode}</Text>
            <Pressable onPress={() => void Clipboard.setStringAsync(login.userCode || "")} style={({ pressed }) => ({ padding: 8, opacity: pressed ? 0.55 : 1 })}>
              <MaterialIcons name="content-copy" size={18} color={colors.accent} />
            </Pressable>
          </View>
          <Text style={{ color: colors.mint, fontSize: 11 }}>Copied automatically · Rook is checking for completion</Text>
        </View>
      ) : null}

      {error ? <Text style={{ color: colors.coral, fontSize: 11.5, lineHeight: 16 }}>{error}</Text> : null}
    </Card>
  );
}

function requireSecureVerificationUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("ChatGPT returned an invalid verification address. Please try again.");
  }
  if (url.protocol !== "https:") {
    throw new Error("ChatGPT returned an insecure verification address. Please try again.");
  }
  return url.toString();
}

function ConsentLine({ text }: { text: string }) {
  const { colors } = useRookTheme();
  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: colors.amber, marginTop: 6 }} />
      <Text style={{ flex: 1, color: colors.textSoft, fontSize: 11.5, lineHeight: 16 }}>{text}</Text>
    </View>
  );
}

const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

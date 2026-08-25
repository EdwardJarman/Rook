import { ClerkProvider, useAuth as useClerkAuth } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import "@/global.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Platform, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "react-native-reanimated";
import {
  SafeAreaFrameContext,
  SafeAreaInsetsContext,
  SafeAreaProvider,
  initialWindowMetrics,
} from "react-native-safe-area-context";
import type { EdgeInsets, Metrics, Rect } from "react-native-safe-area-context";

import "@/lib/_core/nativewind-pressable";
import { RookNotificationProvider } from "@/lib/rook-notifications";
import { initManusRuntime, subscribeSafeAreaInsets } from "@/lib/_core/manus-runtime";
import { ThemeProvider } from "@/lib/theme-provider";
import { createTRPCClient, trpc } from "@/lib/trpc";
import { BotDragProvider } from "@/lib/bot-drag";
import { WorkroomProvider, useWorkroom } from "@/lib/workroom-store";
import { useAuth } from "@/hooks/use-auth";
import { NotificationNavigationObserver } from "@/components/notification-navigation";
import { authWebAppearance, authWebLocalization } from "@/constants/auth-web";
import { useRookTheme } from "@/lib/ui";

// Expo only inlines EXPO_PUBLIC_* values when referenced directly. The Vercel
// build wrapper maps CLERK_PUBLISHABLE_KEY to this value before static export.
const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";

if (!publishableKey) {
  throw new Error("Missing EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY. Configure Clerk before starting Rook.");
}

const DEFAULT_WEB_INSETS: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const DEFAULT_WEB_FRAME: Rect = { x: 0, y: 0, width: 0, height: 0 };

export const unstable_settings = { anchor: "(tabs)" };

function SessionNavigator() {
  const router = useRouter();
  const segments = useSegments();
  const { loading, isAuthenticated } = useAuth();
  const { ready: workroomReady, onboardingComplete } = useWorkroom();
  const { colors } = useRookTheme();

  useEffect(() => {
    const route = segments[0] as string | undefined;
    const isAuthRoute = route === "sign-in" || route === "sign-up";
    const isOnboardingRoute = route === "onboarding";
    // Rook Node pairing pages handle their own sign-in prompt.
    const isSelfManagedRoute = route === "connect-node" || route === "download";
    if (loading) return;
    if (!isAuthenticated && !isAuthRoute && !isSelfManagedRoute) router.replace("/sign-in");
    if (!isAuthenticated || !workroomReady) return;
    if (!onboardingComplete && !isOnboardingRoute) router.replace("/onboarding" as never);
    if (onboardingComplete && (isAuthRoute || isOnboardingRoute)) router.replace("/(tabs)" as never);
  }, [isAuthenticated, loading, onboardingComplete, router, segments, workroomReady]);

  // Resume an interrupted Rook Node pairing: the user signed in mid-handshake
  // and landed on home instead of the connect page.
  useEffect(() => {
    const route = segments[0] as string | undefined;
    if (loading || !isAuthenticated) return;
    if (Platform.OS !== "web") return;
    if (route === "connect-node") return;
    try {
      if (window.localStorage.getItem("rook-connect-pending")) {
        router.replace("/connect-node" as never);
      }
    } catch {
      // localStorage unavailable — skip.
    }
  }, [isAuthenticated, loading, router, segments]);

  const routeForGate = segments[0] as string | undefined;
  const isSelfManagedRouteForGate = routeForGate === "connect-node" || routeForGate === "download";
  if (loading || (isAuthenticated && !workroomReady && !isSelfManagedRouteForGate)) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.canvas, gap: 12 }}>
        <ActivityIndicator color={colors.text} />
        <Text style={{ color: colors.textSoft, fontSize: 13 }}>
          {loading ? "Checking your secure session…" : "Opening your workroom…"}
        </Text>
      </View>
    );
  }

  return (
      <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="sign-up" />
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="connect-node" />
      <Stack.Screen name="download" />
      <Stack.Screen name="(tabs)" />
    </Stack>
  );
}

function RookApplication() {
  const { getToken } = useClerkAuth();
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  const initialInsets = initialWindowMetrics?.insets ?? DEFAULT_WEB_INSETS;
  const initialFrame = initialWindowMetrics?.frame ?? DEFAULT_WEB_FRAME;
  const [insets, setInsets] = useState<EdgeInsets>(initialInsets);
  const [frame, setFrame] = useState<Rect>(initialFrame);
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } } }));
  const [trpcClient] = useState(() => createTRPCClient(() => getTokenRef.current()));

  useEffect(() => {
    initManusRuntime();
  }, []);

  const handleSafeAreaUpdate = useCallback((metrics: Metrics) => {
    setInsets(metrics.insets);
    setFrame(metrics.frame);
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    return subscribeSafeAreaInsets(handleSafeAreaUpdate);
  }, [handleSafeAreaUpdate]);

  const providerInitialMetrics = useMemo(() => {
    const metrics = initialWindowMetrics ?? { insets: initialInsets, frame: initialFrame };
    return {
      ...metrics,
      insets: { ...metrics.insets, top: Math.max(metrics.insets.top, 16), bottom: Math.max(metrics.insets.bottom, 12) },
    };
  }, [initialFrame, initialInsets]);

  const content = (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <WorkroomProvider>
            <BotDragProvider>
              <RookNotificationProvider>
                <NotificationNavigationObserver />
                <SessionNavigator />
                <StatusBar style="auto" />
              </RookNotificationProvider>
            </BotDragProvider>
          </WorkroomProvider>
        </QueryClientProvider>
      </trpc.Provider>
    </GestureHandlerRootView>
  );

  return (
    <ThemeProvider>
      <SafeAreaProvider initialMetrics={providerInitialMetrics}>
        {Platform.OS === "web" ? (
          <SafeAreaFrameContext.Provider value={frame}>
            <SafeAreaInsetsContext.Provider value={insets}>{content}</SafeAreaInsetsContext.Provider>
          </SafeAreaFrameContext.Provider>
        ) : content}
      </SafeAreaProvider>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  // Apply Rook-branded localization + appearance to the web Clerk components.
  // On native these props are harmlessly ignored by @clerk/expo.
  const clerkProps = Platform.OS === "web"
    ? { appearance: authWebAppearance, localization: authWebLocalization }
    : undefined;

  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache} {...(clerkProps as object)}>
      <RookApplication />
    </ClerkProvider>
  );
}

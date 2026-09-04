import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";

import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";

const PREFERENCES_KEY = "rook-notification-preferences-v1";
const INSTALLATION_KEY = "rook-installation-id-v1";
export type NotificationKind = "approval" | "completion";
export type NotificationPreferences = { approval: boolean; completion: boolean };
export type NotificationStatus = "Not enabled" | "Enabled" | "Permission denied" | "Native build required" | "Unavailable on web";
type NotificationContextValue = { ready: boolean; status: NotificationStatus; expoPushToken: string | null; installationId: string | null; preferences: NotificationPreferences; enableAlerts: () => Promise<void>; setPreference: (kind: NotificationKind, enabled: boolean) => void; sendTaskAlert: (event: { kind: NotificationKind; title: string; body: string; url: string }) => Promise<void> };
const NotificationContext = createContext<NotificationContextValue | undefined>(undefined);

if (Platform.OS !== "web") Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }) });

async function createAndroidChannel() { if (Platform.OS === "android") await Notifications.setNotificationChannelAsync("workroom-alerts", { name: "Rook alerts", description: "Task completions and approval requests from Rook.", importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 160, 110, 160], lightColor: "#77F3C4" }); }
async function requestToken(): Promise<{ status: NotificationStatus; token: string | null }> { if (Platform.OS === "web") return { status: "Unavailable on web", token: null }; await createAndroidChannel(); const existing = await Notifications.getPermissionsAsync(); const request = existing.status === "granted" ? existing : await Notifications.requestPermissionsAsync(); if (request.status !== "granted") return { status: "Permission denied", token: null }; const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId; if (!projectId) return { status: "Native build required", token: null }; try { return { status: "Enabled", token: (await Notifications.getExpoPushTokenAsync({ projectId })).data }; } catch { return { status: "Native build required", token: null }; } }
async function presentLocalAlert(event: { kind: NotificationKind; title: string; body: string; url: string }) { if (Platform.OS !== "web") await Notifications.scheduleNotificationAsync({ content: { title: event.title, body: event.body, data: { kind: event.kind, url: event.url }, sound: "default" }, trigger: null }); }

export function RookNotificationProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const registerMutation = trpc.notifications.register.useMutation();
  const deliveryMutation = trpc.notifications.deliver.useMutation();
  const preferencesQuery = trpc.preferences.get.useQuery(undefined, { enabled: isAuthenticated, retry: 1, refetchOnWindowFocus: false });
  const savePreferences = trpc.preferences.save.useMutation();
  const [ready, setReady] = useState(false); const [status, setStatus] = useState<NotificationStatus>(Platform.OS === "web" ? "Unavailable on web" : "Not enabled"); const [expoPushToken, setExpoPushToken] = useState<string | null>(null); const [installationId, setInstallationId] = useState<string | null>(null); const [preferences, setPreferences] = useState<NotificationPreferences>({ approval: true, completion: true });

  useEffect(() => { void (async () => { const [raw, storedId] = await Promise.all([AsyncStorage.getItem(PREFERENCES_KEY), AsyncStorage.getItem(INSTALLATION_KEY)]); const nextId = storedId ?? `rook-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`; if (!storedId) await AsyncStorage.setItem(INSTALLATION_KEY, nextId); setInstallationId(nextId); if (raw) { try { setPreferences({ approval: true, completion: true, ...JSON.parse(raw) }); } catch { /* retain safe local defaults */ } } if (Platform.OS !== "web") { await createAndroidChannel(); const permission = await Notifications.getPermissionsAsync(); if (permission.status === "granted") setStatus("Native build required"); } setReady(true); })(); }, []);
  useEffect(() => { if (!preferencesQuery.data) return; const next = { approval: preferencesQuery.data.approval, completion: preferencesQuery.data.completion }; setPreferences(next); void AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify(next)); }, [preferencesQuery.data]);

  const registerDevice = useCallback(async (token: string, next: NotificationPreferences) => { if (!installationId || !isAuthenticated) return false; const result = await registerMutation.mutateAsync({ installationId, expoPushToken: token, approvalEnabled: next.approval, completionEnabled: next.completion }); return result.registered; }, [installationId, isAuthenticated, registerMutation]);

  // Do not prompt unexpectedly, but if the user has already allowed alerts,
  // register this Android installation as soon as an authenticated session is available.
  useEffect(() => {
    if (!ready || !isAuthenticated || Platform.OS === "web") return;
    let cancelled = false;
    void (async () => {
      const permission = await Notifications.getPermissionsAsync();
      if (permission.status !== "granted") return;
      const result = await requestToken();
      if (cancelled) return;
      setStatus(result.status);
      setExpoPushToken(result.token);
      if (result.token && await registerDevice(result.token, preferences) && !cancelled) setStatus("Enabled");
    })();
    return () => { cancelled = true; };
  }, [installationId, isAuthenticated, preferences, ready, registerDevice]);

  const enableAlerts = useCallback(async () => { const result = await requestToken(); setStatus(result.status); setExpoPushToken(result.token); if (result.token && await registerDevice(result.token, preferences)) setStatus("Enabled"); }, [preferences, registerDevice]);
  const setPreference = useCallback((kind: NotificationKind, enabled: boolean) => { const next = { ...preferences, [kind]: enabled }; setPreferences(next); void AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify(next)); if (isAuthenticated) void savePreferences.mutateAsync(next).catch(() => undefined); if (expoPushToken) void registerDevice(expoPushToken, next).catch(() => undefined); }, [expoPushToken, isAuthenticated, preferences, registerDevice, savePreferences]);
  const sendTaskAlert = useCallback(async (event: { kind: NotificationKind; title: string; body: string; url: string }) => { if (!preferences[event.kind]) return; if (isAuthenticated) { try { const remote = await deliveryMutation.mutateAsync(event); if (remote.accepted) return; } catch { /* native local alert below remains a best-effort fallback */ } } await presentLocalAlert(event); }, [deliveryMutation, isAuthenticated, preferences]);
  const value = useMemo<NotificationContextValue>(() => ({ ready, status, expoPushToken, installationId, preferences, enableAlerts, setPreference, sendTaskAlert }), [ready, status, expoPushToken, installationId, preferences, enableAlerts, setPreference, sendTaskAlert]);
  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}
export function useRookNotifications() { const context = useContext(NotificationContext); if (!context) throw new Error("useRookNotifications must be used inside RookNotificationProvider"); return context; }

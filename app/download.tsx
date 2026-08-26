import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";

import { Card, ScreenHeader, StatusPill, useRookTheme } from "@/components/rook-primitives";
import { ScreenContainer } from "@/components/screen-container";

type DownloadTarget = "android" | "windows" | "macArm64" | "linux" | "unsupported";

function downloadTarget(): DownloadTarget {
  if (Platform.OS === "android") return "android";
  if (Platform.OS !== "web" || typeof navigator === "undefined") return "unsupported";

  const agent = navigator.userAgent;
  if (/Android/i.test(agent)) return "android";
  if (/Windows NT/i.test(agent)) return "windows";
  // Apple-Silicon is the safe default for modern Macs, matching the existing
  // server-side desktop download route.
  if (/Macintosh|Mac OS X/i.test(agent)) return "macArm64";
  if (/Linux/i.test(agent)) return "linux";
  return "unsupported";
}

function serverOrigin(): string {
  if (Platform.OS === "web" && typeof window !== "undefined") return window.location.origin;
  return process.env.EXPO_PUBLIC_API_ORIGIN?.replace(/\/$/, "") || "https://www.rook.lighting";
}

function open(url: string): void {
  if (Platform.OS === "web") {
    window.location.assign(url);
    return;
  }
  void import("react-native").then(({ Linking }) => void Linking.openURL(url));
}

const DETAILS: Record<Exclude<DownloadTarget, "unsupported">, { title: string; label: string; note: string; endpoint: string; afterInstall: string }> = {
  android: {
    title: "Download Rook for Android",
    label: "Download the Rook Android app",
    note: "Android APK · Rook on your phone, with Bots, approvals, files, and updates in one place.",
    endpoint: "/api/download/android",
    afterInstall: "Install the app, open Rook, and sign in. Your Bots, approvals, and connected computers will be ready on your phone.",
  },
  windows: {
    title: "Download Rook Node for Windows",
    label: "Download Rook Node for Windows",
    note: "Rook-Node-Setup.exe · SmartScreen may show a warning for this unsigned build — choose “More info → Run anyway”.",
    endpoint: "/api/download/node",
    afterInstall: "Open Rook Node and press Connect account. Your browser opens, you sign in, and this computer appears under Your computers — online and ready for your Bots.",
  },
  macArm64: {
    title: "Download Rook Node for Mac",
    label: "Download Rook Node for Apple Silicon",
    note: 'Rook-Node-arm64.dmg · After installing, run once in Terminal: xattr -cr "/Applications/Rook Node.app"',
    endpoint: "/api/download/node",
    afterInstall: "Open Rook Node and press Connect account. Your browser opens, you sign in, and this computer appears under Your computers — online and ready for your Bots.",
  },
  linux: {
    title: "Download Rook Node for Linux",
    label: "Download Rook Node for Linux",
    note: "Rook-Node-x86_64.AppImage · chmod +x, then run.",
    endpoint: "/api/download/node",
    afterInstall: "Open Rook Node and press Connect account. Your browser opens, you sign in, and this computer appears under Your computers — online and ready for your Bots.",
  },
};

export default function DownloadScreen() {
  const { colors } = useRookTheme();
  const { back } = useRouter();
  const params = useLocalSearchParams<{ pending?: string | string[] }>();
  const pending = Array.isArray(params.pending) ? params.pending[0] : params.pending;
  const target = downloadTarget();
  const detail = target === "unsupported" ? null : DETAILS[target];
  const isAndroid = target === "android";
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [checkingDownload, setCheckingDownload] = useState(false);

  const beginDownload = async () => {
    if (!detail || checkingDownload) return;
    const url = `${serverOrigin()}${detail.endpoint}`;
    setDownloadError(null);

    // Android visitors get an observable result. On web, verify the same-origin
    // endpoint before leaving this route; an unpublished APK stays here with a
    // clear message instead of taking the browser through an app fallback.
    if (target === "android" && Platform.OS === "web") {
      setCheckingDownload(true);
      try {
        const response = await fetch(`${url}?format=json`, { headers: { Accept: "application/json" } });
        const payload = await response.json().catch(() => null) as { available?: boolean; url?: string; message?: string } | null;
        if (!response.ok || !payload?.available || !payload.url) {
          setDownloadError(payload?.message ?? "The Rook Android app is not published yet. Please try again shortly.");
          return;
        }

        // A real anchor click preserves the browser's download semantics. The
        // resolved release-asset URL skips the intermediate GitHub document
        // that leaves some Android browsers showing a stuck completed file.
        const link = document.createElement("a");
        link.href = payload.url;
        link.download = "Rook.apk";
        link.rel = "noopener";
        document.body.appendChild(link);
        link.click();
        link.remove();
      } catch (error) {
        setDownloadError(error instanceof Error ? error.message : "Rook could not start the Android download. Please try again shortly.");
      } finally {
        setCheckingDownload(false);
      }
      return;
    }

    open(url);
  };

  return (
    <ScreenContainer containerClassName="bg-background" className="flex-1" edges={["top", "left", "right"]}>
      <View style={{ flex: 1, alignItems: "center", padding: 24 }}>
        <View style={{ width: "100%", maxWidth: 520, gap: 16 }}>
          <ScreenHeader
            title={detail?.title ?? "Rook downloads"}
            lead={isAndroid ? "Your Rook workroom, wherever you are." : detail ? "Your computer, as a Bot computer. Forever free." : "Choose a supported device to continue."}
          />

          {pending ? (
            <Card style={{ gap: 6, flexDirection: "row", alignItems: "center" }}>
              <StatusPill label="Publishing" tone="amber" />
              <Text style={{ color: colors.text, fontSize: 12.5, flex: 1 }}>
                The {pending === "android" ? "Android app" : pending} download is being published right now. Please try again shortly.
              </Text>
            </Card>
          ) : null}

          {downloadError ? (
            <Card style={{ gap: 6, flexDirection: "row", alignItems: "center" }}>
              <StatusPill label="Not available yet" tone="amber" />
              <Text style={{ color: colors.text, fontSize: 12.5, flex: 1 }}>{downloadError}</Text>
            </Card>
          ) : null}

          {detail ? (
            <Card style={{ gap: 8 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={detail.label}
                onPress={() => void beginDownload()}
                disabled={checkingDownload}
                style={({ pressed }) => ({
                  minHeight: 54,
                  justifyContent: "center",
                  borderRadius: 14,
                  backgroundColor: colors.ink,
                  paddingHorizontal: 16,
                  opacity: checkingDownload ? 0.55 : pressed ? 0.78 : 1,
                })}
              >
                <Text style={{ color: colors.onInk, fontWeight: "700", fontSize: 15 }}>{checkingDownload ? "Checking Android download…" : detail.label}</Text>
                <Text style={{ color: colors.onInk, opacity: 0.74, fontSize: 12, marginTop: 3, lineHeight: 17 }}>{detail.note}</Text>
              </Pressable>
            </Card>
          ) : (
            <Card style={{ gap: 8 }}>
              <StatusPill label="Android only for mobile" tone="amber" />
              <Text style={{ color: colors.text, fontSize: 14, lineHeight: 20 }}>
                Rook mobile is currently available for Android. Open this page from an Android phone to download the app, or use a Windows, Mac, or Linux computer to install Rook Node.
              </Text>
            </Card>
          )}

          {detail ? (
            <Card style={{ gap: 6 }}>
              <Text style={{ color: colors.text, fontWeight: "600", fontSize: 13.5 }}>After downloading</Text>
              <Text style={{ color: colors.textFaint, fontSize: 12.5, lineHeight: 18 }}>{detail.afterInstall}</Text>
              {Platform.OS !== "web" ? (
                <Pressable accessibilityRole="button" onPress={() => back()} style={{ alignSelf: "flex-start", paddingVertical: 4 }}>
                  <Text style={{ color: colors.textSoft, fontWeight: "600", fontSize: 12.5 }}>Back</Text>
                </Pressable>
              ) : null}
            </Card>
          ) : null}

          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <StatusPill label="Forever free" tone="mint" />
            <Text style={{ color: colors.textFaint, fontSize: 11.5, flex: 1 }}>
              {isAndroid ? "Rook keeps you close to the work without moving your Bots off your own computer." : "Rook runs Bots on your own computer, under your control."}
            </Text>
          </View>
        </View>
      </View>
    </ScreenContainer>
  );
}

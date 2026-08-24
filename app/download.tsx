import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Platform, Pressable, Text, View } from "react-native";

import { Card, ScreenHeader, StatusPill } from "@/components/rook-primitives";
import { ScreenContainer } from "@/components/screen-container";
import { useRookTheme } from "@/lib/ui";

/** Stable, version-free asset URLs — always resolve to the latest published release. */
const ASSETS = {
  windows: "https://github.com/EdwardJarman/Rook/releases/latest/download/Rook-Node-Setup.exe",
  macArm64: "https://github.com/EdwardJarman/Rook/releases/latest/download/Rook-Node-arm64.dmg",
  macIntel: "https://github.com/EdwardJarman/Rook/releases/latest/download/Rook-Node-intel.dmg",
  linux: "https://github.com/EdwardJarman/Rook/releases/latest/download/Rook-Node-x86_64.AppImage",
} as const;

function open(url: string): void {
  if (Platform.OS === "web") {
    window.location.href = url;
    return;
  }
  void import("react-native").then(({ Linking }) => void Linking.openURL(url));
}

export default function DownloadNodeScreen() {
  const { colors } = useRookTheme();
  const { back } = useRouter();

  const PlatformButton = ({ label, url, note }: { label: string; url: string; note: string }): ReactNode => (
    <Card style={{ gap: 6 }}>
      <Pressable accessibilityRole="button" onPress={() => open(url)} style={{ alignItems: "flex-start" }}>
        <Text style={{ color: colors.text, fontWeight: "700", fontSize: 15 }}>{label}</Text>
        <Text style={{ color: colors.textFaint, fontSize: 12.5, marginTop: 3, lineHeight: 17 }}>{note}</Text>
      </Pressable>
    </Card>
  );

  return (
    <ScreenContainer containerClassName="bg-background" className="flex-1" edges={["top", "left", "right"]}>
      <View style={{ flex: 1, alignItems: "center", padding: 24 }}>
        <View style={{ width: "100%", maxWidth: 520, gap: 16 }}>
          <ScreenHeader title="Download Rook Node" lead="Your computer, as a Bot computer. Forever free." />

          <PlatformButton
            label="Windows"
            url={ASSETS.windows}
            note="Rook-Node-Setup.exe · SmartScreen may show a warning (unsigned build) — choose “More info → Run anyway”."
          />
          <PlatformButton
            label="macOS — Apple Silicon"
            url={ASSETS.macArm64}
            note={'Rook-Node-arm64.dmg · After installing, run once in Terminal: xattr -cr "/Applications/Rook Node.app"'}
          />
          <PlatformButton
            label="macOS — Intel"
            url={ASSETS.macIntel}
            note="Rook-Node-intel.dmg · Same xattr step applies."
          />
          <PlatformButton
            label="Linux"
            url={ASSETS.linux}
            note="Rook-Node-x86_64.AppImage · chmod +x, then run."
          />

          <Card style={{ gap: 6 }}>
            <Text style={{ color: colors.text, fontWeight: "600", fontSize: 13.5 }}>After installing</Text>
            <Text style={{ color: colors.textFaint, fontSize: 12.5, lineHeight: 18 }}>
              Open Rook Node and press “Connect account”. Your browser opens, you sign in, and this computer appears
              under Your computers — online and ready for your Bots.
            </Text>
            {Platform.OS !== "web" ? (
              <Pressable accessibilityRole="button" onPress={() => back()} style={{ alignSelf: "flex-start" }}>
                <Text style={{ color: colors.textSoft, fontWeight: "600", fontSize: 12.5 }}>Back</Text>
              </Pressable>
            ) : null}
          </Card>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <StatusPill label="Forever free" tone="mint" />
            <Text style={{ color: colors.textFaint, fontSize: 11.5 }}>
              Rook never runs Bots on our servers — they run on your machine, under your control.
            </Text>
          </View>
        </View>
      </View>
    </ScreenContainer>
  );
}

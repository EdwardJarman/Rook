import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { EarthGlobe } from "@/components/earth-globe";
import { RookLogo } from "@/components/rook-logo";
import { tint, useRookTheme } from "@/lib/ui";

const POSIX_INSTALL_COMMAND =
  "curl -fsSL https://www.rook.lighting/api/download/cli/install.sh | sh";
const POWERSHELL_INSTALL_COMMAND =
  "irm https://www.rook.lighting/api/download/cli/install.ps1 | iex";

type InstallShell = "posix" | "powershell";

/**
 * The public landing page. Kept in the same warm/ink token system and
 * rounded language as the signed-in workroom so the very first thing a
 * visitor sees doesn't feel like a different product.
 */
export default function RookLandingPage() {
  const router = useRouter();
  const { colors } = useRookTheme();
  const { width } = useWindowDimensions();
  const isWide = width >= 980;
  const [shell] = useState<InstallShell>(
    Platform.OS === "web" &&
      typeof navigator !== "undefined" &&
      /Windows NT/i.test(navigator.userAgent)
      ? "powershell"
      : "posix",
  );
  const [copied, setCopied] = useState(false);
  const installCommand =
    shell === "posix" ? POSIX_INSTALL_COMMAND : POWERSHELL_INSTALL_COMMAND;

  const copyInstaller = async () => {
    if (
      Platform.OS !== "web" ||
      typeof navigator === "undefined" ||
      !navigator.clipboard
    ) {
      return;
    }

    try {
      await navigator.clipboard.writeText(installCommand);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ScrollView
        contentContainerStyle={{ minHeight: "100%" }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ flex: 1, overflow: "hidden" }}>
          <View
            style={{
              width: "100%",
              maxWidth: 1180,
              minHeight: isWide ? 800 : 860,
              alignSelf: "center",
              paddingHorizontal: isWide ? 32 : 20,
              paddingTop: 20,
              paddingBottom: 34,
            }}
          >
            <LandingHeader
              onSignIn={() => router.push("/sign-in" as never)}
              onSignUp={() => router.push("/sign-up" as never)}
            />

            <View
              style={{
                position: "absolute",
                top: isWide ? 70 : 372,
                right: isWide ? -10 : -95,
                width: isWide ? "56%" : 480,
                height: isWide ? 620 : 480,
                opacity: isWide ? 0.92 : 0.7,
              }}
              pointerEvents="none"
            >
              <EarthGlobe />
            </View>

            <View
              style={{
                flex: 1,
                position: "relative",
                paddingTop: isWide ? 84 : 52,
                justifyContent: "space-between",
              }}
            >
              <View style={{ maxWidth: isWide ? 640 : 600 }}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    alignSelf: "flex-start",
                    backgroundColor: colors.surfaceAlt,
                    borderRadius: 999,
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                  }}
                >
                  <View
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: colors.accent,
                    }}
                  />
                  <Text
                    style={{
                      color: colors.textSoft,
                      fontSize: 11.5,
                      fontWeight: "700",
                      letterSpacing: 0.3,
                    }}
                  >
                    Your Bot-first AI workroom
                  </Text>
                </View>

                <Text
                  style={{
                    color: colors.text,
                    fontSize: isWide ? 60 : 42,
                    lineHeight: isWide ? 62 : 46,
                    fontWeight: "800",
                    letterSpacing: isWide ? -2.4 : -1.4,
                    marginTop: 22,
                    maxWidth: isWide ? 580 : 480,
                  }}
                >
                  Calm Bots.{"\n"}
                  <Text style={{ color: colors.accent }}>Real work.</Text>
                </Text>

                <Text
                  style={{
                    color: colors.textSoft,
                    fontSize: 16,
                    lineHeight: 25,
                    marginTop: 20,
                    maxWidth: 440,
                  }}
                >
                  A deliberate workspace for capable Bots. Keep real work
                  close, direct every meaningful step, and bring your own
                  computer in only when it matters.
                </Text>

                <View
                  style={{
                    flexDirection: isWide ? "row" : "column",
                    alignItems: isWide ? "center" : "stretch",
                    gap: 10,
                    marginTop: 28,
                    maxWidth: isWide ? 640 : 480,
                  }}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Get started with Rook"
                    onPress={() => router.push("/sign-up" as never)}
                    style={({ pressed }) => ({
                      height: 54,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      paddingHorizontal: 22,
                      borderRadius: 18,
                      backgroundColor: colors.ink,
                      opacity: pressed ? 0.82 : 1,
                    })}
                  >
                    <Text
                      style={{
                        color: colors.onInk,
                        fontSize: 15,
                        fontWeight: "700",
                        letterSpacing: -0.2,
                      }}
                    >
                      Get started free
                    </Text>
                    <MaterialIcons
                      name="arrow-forward"
                      size={17}
                      color={colors.onInk}
                    />
                  </Pressable>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Open Rook downloads"
                    onPress={() => router.push("/download" as never)}
                    style={({ pressed }) => ({
                      height: 54,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      paddingHorizontal: 20,
                      borderRadius: 18,
                      borderWidth: 1,
                      borderColor: colors.lineStrong,
                      backgroundColor: colors.surface,
                      opacity: pressed ? 0.72 : 1,
                    })}
                  >
                    <MaterialIcons
                      name="download"
                      size={18}
                      color={colors.text}
                    />
                    <Text
                      style={{
                        color: colors.text,
                        fontSize: 14.5,
                        fontWeight: "700",
                        letterSpacing: -0.1,
                      }}
                    >
                      Download Rook
                    </Text>
                  </Pressable>
                </View>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Copy Rook CLI install command"
                  onPress={() => void copyInstaller()}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 9,
                    alignSelf: "flex-start",
                    marginTop: 14,
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    borderRadius: 14,
                    backgroundColor: colors.surfaceAlt,
                    maxWidth: "100%",
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <MaterialIcons
                    name={copied ? "check" : "terminal"}
                    size={15}
                    color={copied ? colors.accent : colors.textFaint}
                  />
                  <Text
                    selectable
                    numberOfLines={1}
                    style={{
                      flexShrink: 1,
                      color: colors.textSoft,
                      fontFamily: Platform.select({
                        ios: "Menlo",
                        android: "monospace",
                        default:
                          "ui-monospace, SFMono-Regular, Menlo, monospace",
                      }),
                      fontSize: 11.5,
                    }}
                  >
                    {installCommand}
                  </Text>
                  <Text
                    style={{
                      color: copied ? colors.accent : colors.textFaint,
                      fontSize: 10.5,
                      fontWeight: "800",
                      letterSpacing: 0.4,
                    }}
                  >
                    {copied ? "COPIED" : "COPY"}
                  </Text>
                </Pressable>
              </View>

              <View
                style={{
                  marginTop: isWide ? 76 : 56,
                  flexDirection: isWide ? "row" : "column",
                  gap: 12,
                }}
              >
                <FeatureCard
                  icon="badge"
                  title="A clear role"
                  detail="Shape focused teammates around the context and tools they need."
                />
                <FeatureCard
                  icon="shield"
                  title="Control stays close"
                  detail="Bring Rook Node into the loop when work needs your own machine."
                />
                <FeatureCard
                  icon="fact-check"
                  title="Intent before action"
                  detail="Review consequential external steps before they leave your workspace."
                />
              </View>
            </View>

            <View
              style={{
                marginTop: 32,
                paddingTop: 18,
                borderTopWidth: 1,
                borderTopColor: colors.line,
                flexDirection: "row",
                justifyContent: "space-between",
                gap: 20,
              }}
            >
              <Text style={{ color: colors.textFaint, fontSize: 11.5 }}>
                © {new Date().getFullYear()} Rook
              </Text>
              <Text style={{ color: colors.textFaint, fontSize: 11.5 }}>
                Built for deliberate work
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function LandingHeader({
  onSignIn,
  onSignUp,
}: {
  onSignIn: () => void;
  onSignUp: () => void;
}) {
  const { colors } = useRookTheme();
  return (
    <View
      style={{
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 11,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.ink,
          }}
        >
          <RookLogo size={20} color={colors.onInk} />
        </View>
        <Text
          style={{
            color: colors.text,
            fontSize: 15,
            fontWeight: "800",
            letterSpacing: -0.4,
          }}
        >
          Rook
        </Text>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sign in to Rook"
          onPress={onSignIn}
          style={({ pressed }) => ({
            minHeight: 36,
            justifyContent: "center",
            paddingHorizontal: 12,
            borderRadius: 12,
            opacity: pressed ? 0.62 : 1,
          })}
        >
          <Text style={{ color: colors.textSoft, fontSize: 13, fontWeight: "700" }}>
            Sign in
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Get started with Rook"
          onPress={onSignUp}
          style={({ pressed }) => ({
            minHeight: 36,
            justifyContent: "center",
            paddingHorizontal: 14,
            borderRadius: 12,
            backgroundColor: colors.surfaceAlt,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text style={{ color: colors.text, fontSize: 13, fontWeight: "700" }}>
            Get started
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function FeatureCard({
  icon,
  title,
  detail,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  title: string;
  detail: string;
}) {
  const { colors } = useRookTheme();
  return (
    <View
      style={{
        flex: 1,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.surface,
        padding: 18,
      }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 12,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: tint(colors.accent, 0.12),
        }}
      >
        <MaterialIcons name={icon} size={17} color={colors.accent} />
      </View>
      <Text
        style={{
          color: colors.text,
          fontSize: 14.5,
          fontWeight: "700",
          letterSpacing: -0.2,
          marginTop: 14,
        }}
      >
        {title}
      </Text>
      <Text
        style={{
          color: colors.textFaint,
          fontSize: 12.5,
          lineHeight: 18,
          marginTop: 6,
        }}
      >
        {detail}
      </Text>
    </View>
  );
}

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";

import { RookLogo } from "@/components/rook-logo";
import { useRookTheme } from "@/lib/ui";

const POSIX_INSTALL_COMMAND =
  "curl -fsSL https://www.rook.lighting/api/download/cli/install.sh | sh";
const POWERSHELL_INSTALL_COMMAND =
  "irm https://www.rook.lighting/api/download/cli/install.ps1 | iex";

/**
 * GitHub's `releases/latest/download/<asset>` URL always resolves to the
 * newest published release. Linking the download page straight at GitHub
 * means a download works even when the Vercel function is down — the
 * server endpoint was only ever a thin 302 anyway.
 */
const GITHUB_RELEASE_BASE =
  "https://github.com/EdwardJarman/Rook/releases/latest/download";

function directDownloadUrl(artifact: string): string {
  return `${GITHUB_RELEASE_BASE}/${artifact}`;
}

type DownloadTarget = "android" | "windows" | "macArm64" | "macIntel" | "linux";
type InstallShell = "posix" | "powershell";

function detectedTarget(): DownloadTarget | null {
  if (Platform.OS === "android") return "android";
  if (Platform.OS !== "web" || typeof navigator === "undefined") return null;
  const agent = navigator.userAgent;
  if (/Android/i.test(agent)) return "android";
  if (/Windows NT/i.test(agent)) return "windows";
  if (/Macintosh|Mac OS X/i.test(agent)) return "macArm64";
  if (/Linux/i.test(agent)) return "linux";
  return null;
}

function open(url: string): void {
  if (Platform.OS === "web") {
    window.location.assign(url);
    return;
  }
  void import("react-native").then(({ Linking }) => void Linking.openURL(url));
}

const DETAILS: Record<
  DownloadTarget,
  {
    platform: string;
    title: string;
    artifact: string;
    note: string;
    icon: string;
    afterInstall: string;
  }
> = {
  windows: {
    platform: "Windows",
    title: "Rook Node for Windows",
    artifact: "Rook-Node-Setup.exe",
    note: "A guided desktop installer for Windows 10 and later.",
    icon: "window",
    afterInstall:
      "Open Rook Node, choose Connect account, then enter the short-lived code shown in your browser.",
  },
  macArm64: {
    platform: "macOS · Apple Silicon",
    title: "Rook Node for Mac",
    artifact: "Rook-Node-arm64.dmg",
    note: "For Mac computers with Apple silicon: M1, M2, M3, and newer.",
    icon: "laptop-mac",
    afterInstall:
      "Move Rook Node to Applications, then open it and use Connect account. If macOS blocks the unsigned app, run the displayed one-time xattr command once.",
  },
  macIntel: {
    platform: "macOS · Intel",
    title: "Rook Node for Mac",
    artifact: "Rook-Node-intel.dmg",
    note: "For Intel-based Mac computers.",
    icon: "laptop-mac",
    afterInstall:
      "Move Rook Node to Applications, then open it and use Connect account. If macOS blocks the unsigned app, run the displayed one-time xattr command once.",
  },
  linux: {
    platform: "Linux · x64",
    title: "Rook Node for Linux",
    artifact: "Rook-Node-x86_64.AppImage",
    note: "A portable AppImage for 64-bit Linux desktops.",
    icon: "terminal",
    afterInstall:
      "Mark the AppImage executable, run it, then use Connect account to pair your computer.",
  },
  android: {
    platform: "Android",
    title: "Rook for Android",
    artifact: "Rook.apk",
    note: "Your Rook workroom, approvals, and Bots on your phone.",
    icon: "phone-android",
    afterInstall:
      "Install the Android app, open Rook, and sign in to your existing account.",
  },
};

export default function DownloadScreen() {
  const router = useRouter();
  const { colors } = useRookTheme();
  const currentTarget = useMemo(detectedTarget, []);
  const [shell, setShell] = useState<InstallShell>(
    Platform.OS === "web" &&
      typeof navigator !== "undefined" &&
      /Windows NT/i.test(navigator.userAgent)
      ? "powershell"
      : "posix",
  );
  const [copied, setCopied] = useState(false);
  const command =
    shell === "posix" ? POSIX_INSTALL_COMMAND : POWERSHELL_INSTALL_COMMAND;

  const copyInstaller = async () => {
    if (
      Platform.OS !== "web" ||
      typeof navigator === "undefined" ||
      !navigator.clipboard
    )
      return;
    try {
      await navigator.clipboard.writeText(command);
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
        <View
          style={{
            width: "100%",
            maxWidth: 1110,
            alignSelf: "center",
            paddingHorizontal: 22,
            paddingTop: 20,
            paddingBottom: 48,
          }}
        >
          <View
            style={{
              minHeight: 52,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go to Rook home"
              onPress={() => router.push("/" as never)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                opacity: pressed ? 0.65 : 1,
              })}
            >
              <View
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 11,
                  backgroundColor: colors.ink,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <RookLogo size={23} color={colors.onInk} />
              </View>
              <Text
                style={{
                  color: colors.text,
                  fontSize: 16,
                  fontWeight: "800",
                  letterSpacing: -0.5,
                }}
              >
                Rook
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sign in to Rook"
              onPress={() => router.push("/sign-in" as never)}
              style={({ pressed }) => ({
                paddingHorizontal: 13,
                paddingVertical: 9,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: colors.lineStrong,
                opacity: pressed ? 0.65 : 1,
              })}
            >
              <Text
                style={{ color: colors.text, fontSize: 13, fontWeight: "800" }}
              >
                Sign in
              </Text>
            </Pressable>
          </View>

          <View
            style={{
              position: "absolute",
              top: 136,
              left: -170,
              width: 360,
              height: 360,
              borderRadius: 180,
              backgroundColor: colors.mintSoft,
              opacity: 0.65,
            }}
          />
          <View style={{ position: "relative", paddingTop: 73 }}>
            <View style={{ maxWidth: 700 }}>
              <Text
                style={{
                  color: colors.accent,
                  fontSize: 11.5,
                  fontWeight: "900",
                  letterSpacing: 1.1,
                }}
              >
                GET ROOK
              </Text>
              <Text
                style={{
                  color: colors.text,
                  fontSize: 43,
                  lineHeight: 47,
                  letterSpacing: -2,
                  fontWeight: "800",
                  marginTop: 13,
                }}
              >
                Use Rook wherever the work happens.
              </Text>
              <Text
                style={{
                  color: colors.textSoft,
                  fontSize: 16,
                  lineHeight: 24,
                  marginTop: 15,
                  maxWidth: 610,
                }}
              >
                Install the desktop Node to let your Rook workspace work with
                your own computer. Or use the mobile app to stay close to the
                work.
              </Text>
            </View>

            <View
              style={{
                marginTop: 38,
                flexDirection: "row",
                flexWrap: "wrap",
                gap: 12,
              }}
            >
              {(Object.keys(DETAILS) as DownloadTarget[]).map((target) => (
                <DownloadCard
                  key={target}
                  target={target}
                  recommended={target === currentTarget}
                  onPress={() => open(directDownloadUrl(DETAILS[target].artifact))}
                />
              ))}
            </View>

            <View
              style={{
                marginTop: 46,
                borderWidth: 1,
                borderColor: colors.lineStrong,
                borderRadius: 18,
                backgroundColor: colors.surface,
                overflow: "hidden",
              }}
            >
              <View
                style={{
                  paddingHorizontal: 18,
                  paddingTop: 17,
                  paddingBottom: 14,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.line,
                  flexDirection: "row",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: 16,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      color: colors.text,
                      fontSize: 18,
                      letterSpacing: -0.55,
                      fontWeight: "800",
                    }}
                  >
                    Prefer the terminal?
                  </Text>
                  <Text
                    style={{
                      color: colors.textFaint,
                      fontSize: 12.5,
                      lineHeight: 18,
                      marginTop: 4,
                    }}
                  >
                    Install Rook CLI for your current user. It includes the
                    isolated Rook Node runtime and opens the secure connection
                    flow when you run{" "}
                    <Text style={{ fontWeight: "800" }}>rook</Text>.
                  </Text>
                </View>
                <MaterialIcons
                  name="terminal"
                  size={22}
                  color={colors.accent}
                />
              </View>
              <View style={{ padding: 14 }}>
                <View
                  style={{
                    alignSelf: "flex-start",
                    flexDirection: "row",
                    gap: 4,
                    borderRadius: 9,
                    padding: 3,
                    backgroundColor: colors.canvas,
                  }}
                >
                  <ShellTab
                    active={shell === "posix"}
                    label="macOS / Linux"
                    onPress={() => setShell("posix")}
                  />
                  <ShellTab
                    active={shell === "powershell"}
                    label="Windows PowerShell"
                    onPress={() => setShell("powershell")}
                  />
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Copy Rook CLI installer"
                  onPress={() => void copyInstaller()}
                  style={({ pressed }) => ({
                    marginTop: 11,
                    minHeight: 62,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    paddingHorizontal: 13,
                    borderRadius: 12,
                    backgroundColor: colors.canvas,
                    borderWidth: 1,
                    borderColor: colors.line,
                    opacity: pressed ? 0.72 : 1,
                  })}
                >
                  <Text
                    selectable
                    style={{
                      flex: 1,
                      color: colors.text,
                      fontFamily: Platform.select({
                        ios: "Menlo",
                        android: "monospace",
                        default:
                          "ui-monospace, SFMono-Regular, Menlo, monospace",
                      }),
                      fontSize: 13,
                    }}
                  >
                    $ {command}
                  </Text>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 5,
                      paddingHorizontal: 8,
                      paddingVertical: 6,
                      borderRadius: 8,
                      backgroundColor: copied
                        ? colors.mintSoft
                        : colors.surface,
                    }}
                  >
                    <MaterialIcons
                      name={copied ? "check" : "content-copy"}
                      size={15}
                      color={copied ? colors.mint : colors.textSoft}
                    />
                    <Text
                      style={{
                        color: copied ? colors.mint : colors.textSoft,
                        fontSize: 11.5,
                        fontWeight: "800",
                      }}
                    >
                      {copied ? "Copied" : "Copy"}
                    </Text>
                  </View>
                </Pressable>
                <Text
                  style={{
                    color: colors.textFaint,
                    fontSize: 11.5,
                    lineHeight: 16,
                    marginTop: 9,
                  }}
                >
                  The installer uses HTTPS, installs in your user folder without
                  sudo or administrator access, and checks that the installed
                  CLI runs before reporting success.
                </Text>
              </View>
            </View>

            <View
              style={{
                marginTop: 43,
                borderTopWidth: 1,
                borderColor: colors.line,
                paddingTop: 22,
                gap: 11,
              }}
            >
              <Text
                style={{ color: colors.text, fontSize: 16, fontWeight: "800" }}
              >
                What happens next
              </Text>
              <Step
                label="1"
                text="Install Rook Node or the CLI on the computer you want to connect."
              />
              <Step
                label="2"
                text="Choose Connect account and sign in to your existing Rook account."
              />
              <Step
                label="3"
                text="Enter the browser’s one-time code in Rook Node. The uplink starts immediately."
              />
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function DownloadCard({
  target,
  recommended,
  onPress,
}: {
  target: DownloadTarget;
  recommended: boolean;
  onPress: () => void;
}) {
  const { colors } = useRookTheme();
  const detail = DETAILS[target];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Download ${detail.title}`}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 208,
        minHeight: 195,
        padding: 15,
        borderWidth: 1,
        borderColor: recommended ? colors.accent : colors.line,
        borderRadius: 16,
        backgroundColor: colors.surface,
        opacity: pressed ? 0.72 : 1,
      })}
    >
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 8,
        }}
      >
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: recommended ? colors.mintSoft : colors.canvas,
          }}
        >
          <MaterialIcons
            name={detail.icon as never}
            size={19}
            color={recommended ? colors.mint : colors.textSoft}
          />
        </View>
        {recommended ? (
          <Text
            style={{
              color: colors.accent,
              fontSize: 10,
              fontWeight: "900",
              letterSpacing: 0.6,
            }}
          >
            FOR THIS DEVICE
          </Text>
        ) : null}
      </View>
      <Text
        style={{
          color: colors.text,
          fontSize: 14,
          lineHeight: 19,
          fontWeight: "800",
          marginTop: 21,
        }}
      >
        {detail.platform}
      </Text>
      <Text
        style={{
          color: colors.textFaint,
          fontSize: 11.5,
          lineHeight: 16,
          marginTop: 5,
        }}
      >
        {detail.artifact}
      </Text>
      <Text
        style={{
          color: colors.textSoft,
          fontSize: 11.5,
          lineHeight: 16,
          marginTop: 11,
        }}
      >
        {detail.note}
      </Text>
    </Pressable>
  );
}

function ShellTab({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  const { colors } = useRookTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => ({
        paddingHorizontal: 8,
        paddingVertical: 6,
        borderRadius: 7,
        backgroundColor: active ? colors.surface : "transparent",
        opacity: pressed ? 0.65 : 1,
      })}
    >
      <Text
        style={{
          color: active ? colors.text : colors.textFaint,
          fontSize: 11,
          fontWeight: "800",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Step({ label, text }: { label: string; text: string }) {
  const { colors } = useRookTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
      <View
        style={{
          width: 21,
          height: 21,
          borderRadius: 10.5,
          backgroundColor: colors.ink,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ color: colors.onInk, fontSize: 10, fontWeight: "900" }}>
          {label}
        </Text>
      </View>
      <Text
        style={{
          color: colors.textSoft,
          flex: 1,
          fontSize: 13,
          lineHeight: 19,
          paddingTop: 1,
        }}
      >
        {text}
      </Text>
    </View>
  );
}

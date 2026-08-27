import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";

import { RookLogo } from "@/components/rook-logo";
import { useRookTheme } from "@/lib/ui";

const POSIX_INSTALL_COMMAND =
  "curl -fsSL https://www.rook.lighting/install.sh | sh";
const POWERSHELL_INSTALL_COMMAND =
  "irm https://www.rook.lighting/install.ps1 | iex";

type InstallShell = "posix" | "powershell";

export default function RookLandingPage() {
  const router = useRouter();
  const { colors } = useRookTheme();
  const [shell, setShell] = useState<InstallShell>("posix");
  const [copied, setCopied] = useState(false);
  const installCommand =
    shell === "posix" ? POSIX_INSTALL_COMMAND : POWERSHELL_INSTALL_COMMAND;

  const copyInstaller = async () => {
    if (
      Platform.OS !== "web" ||
      typeof navigator === "undefined" ||
      !navigator.clipboard
    )
      return;
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
        <View
          style={{
            flex: 1,
            width: "100%",
            maxWidth: 1200,
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
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
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
            </View>
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 7 }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Sign in to Rook"
                onPress={() => router.push("/sign-in" as never)}
                style={({ pressed }) => ({
                  paddingHorizontal: 12,
                  paddingVertical: 9,
                  opacity: pressed ? 0.62 : 1,
                })}
              >
                <Text
                  style={{
                    color: colors.textSoft,
                    fontSize: 13,
                    fontWeight: "700",
                  }}
                >
                  Sign in
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Get started with Rook"
                onPress={() => router.push("/sign-up" as never)}
                style={({ pressed }) => ({
                  paddingHorizontal: 13,
                  paddingVertical: 9,
                  borderRadius: 10,
                  backgroundColor: colors.ink,
                  opacity: pressed ? 0.78 : 1,
                })}
              >
                <Text
                  style={{
                    color: colors.onInk,
                    fontSize: 13,
                    fontWeight: "800",
                  }}
                >
                  Get started
                </Text>
              </Pressable>
            </View>
          </View>

          <View
            style={{
              position: "absolute",
              top: 126,
              right: -100,
              width: 420,
              height: 420,
              borderRadius: 210,
              backgroundColor: colors.mintSoft,
              opacity: 0.68,
            }}
          />
          <View
            style={{
              position: "absolute",
              top: 410,
              left: -180,
              width: 350,
              height: 350,
              borderRadius: 175,
              backgroundColor: colors.amberSoft,
              opacity: 0.62,
            }}
          />

          <View style={{ flex: 1, paddingTop: 88, position: "relative" }}>
            <View style={{ maxWidth: 760 }}>
              <View
                style={{
                  alignSelf: "flex-start",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 7,
                  borderWidth: 1,
                  borderColor: colors.line,
                  borderRadius: 999,
                  backgroundColor: colors.surface,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                }}
              >
                <View
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: colors.mint,
                  }}
                />
                <Text
                  style={{
                    color: colors.textSoft,
                    fontSize: 11,
                    fontWeight: "800",
                    letterSpacing: 0.5,
                  }}
                >
                  YOUR WORK, IN YOUR CONTROL
                </Text>
              </View>
              <Text
                style={{
                  color: colors.text,
                  fontSize: 52,
                  lineHeight: 55,
                  fontWeight: "800",
                  letterSpacing: -2.9,
                  marginTop: 24,
                  maxWidth: 710,
                }}
              >
                Serious AI work,
                {"\n"}without giving up your computer.
              </Text>
              <Text
                style={{
                  color: colors.textSoft,
                  fontSize: 17,
                  lineHeight: 26,
                  maxWidth: 570,
                  marginTop: 21,
                }}
              >
                Rook is a calm workspace for capable Bots. Keep real work close,
                connect your own computer when you need it, and stay in charge
                of every consequential step.
              </Text>

              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: 11,
                  marginTop: 31,
                }}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Open Rook downloads"
                  onPress={() => router.push("/download" as never)}
                  style={({ pressed }) => ({
                    minHeight: 48,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    paddingHorizontal: 17,
                    borderRadius: 13,
                    backgroundColor: colors.ink,
                    opacity: pressed ? 0.76 : 1,
                  })}
                >
                  <MaterialIcons
                    name="download"
                    size={18}
                    color={colors.onInk}
                  />
                  <Text
                    style={{
                      color: colors.onInk,
                      fontSize: 14,
                      fontWeight: "800",
                    }}
                  >
                    Download Rook
                  </Text>
                </Pressable>
                <Text style={{ color: colors.textFaint, fontSize: 12.5 }}>
                  Windows, macOS, Linux & Android
                </Text>
              </View>

              <View
                style={{
                  marginTop: 24,
                  maxWidth: 720,
                  borderRadius: 16,
                  overflow: "hidden",
                  borderWidth: 1,
                  borderColor: colors.lineStrong,
                  backgroundColor: colors.surface,
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingHorizontal: 13,
                    paddingTop: 11,
                    paddingBottom: 9,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.line,
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      gap: 8,
                      alignItems: "center",
                    }}
                  >
                    <MaterialIcons
                      name="terminal"
                      size={16}
                      color={colors.accent}
                    />
                    <Text
                      style={{
                        color: colors.text,
                        fontSize: 12.5,
                        fontWeight: "800",
                      }}
                    >
                      Install Rook CLI
                    </Text>
                  </View>
                  <View
                    style={{
                      flexDirection: "row",
                      gap: 4,
                      alignItems: "center",
                    }}
                  >
                    <ShellTab
                      active={shell === "posix"}
                      label="macOS / Linux"
                      onPress={() => setShell("posix")}
                    />
                    <ShellTab
                      active={shell === "powershell"}
                      label="Windows"
                      onPress={() => setShell("powershell")}
                    />
                  </View>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Copy Rook CLI install command"
                  onPress={() => void copyInstaller()}
                  style={({ pressed }) => ({
                    minHeight: 58,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    paddingHorizontal: 14,
                    opacity: pressed ? 0.72 : 1,
                  })}
                >
                  <Text
                    selectable
                    style={{
                      color: colors.textFaint,
                      fontFamily: Platform.select({
                        ios: "Menlo",
                        android: "monospace",
                        default:
                          "ui-monospace, SFMono-Regular, Menlo, monospace",
                      }),
                      fontSize: 13.5,
                      flex: 1,
                    }}
                  >
                    $ {installCommand}
                  </Text>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 5,
                      paddingHorizontal: 8,
                      paddingVertical: 6,
                      borderRadius: 8,
                      backgroundColor: copied ? colors.mintSoft : colors.canvas,
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
              </View>
              <Text
                style={{
                  color: colors.textFaint,
                  fontSize: 12,
                  lineHeight: 17,
                  marginTop: 10,
                  maxWidth: 680,
                }}
              >
                The installer downloads the current signed release, installs
                only for your user account, and verifies the CLI before it
                finishes. Run <Text style={{ fontWeight: "800" }}>rook</Text> to
                start your local Rook Node.
              </Text>
            </View>

            <View
              style={{
                marginTop: 82,
                flexDirection: "row",
                flexWrap: "wrap",
                gap: 12,
              }}
            >
              <SignalCard
                number="01"
                title="Create focused teammates"
                detail="Give each Bot a role, a model, and the context it needs."
              />
              <SignalCard
                number="02"
                title="Keep control local"
                detail="Connect Rook Node when a Bot needs your own computer."
              />
              <SignalCard
                number="03"
                title="Approve the important things"
                detail="Review meaningful external actions before they happen."
              />
            </View>
          </View>

          <View
            style={{
              paddingTop: 32,
              flexDirection: "row",
              justifyContent: "space-between",
              gap: 16,
              borderTopWidth: 1,
              borderTopColor: colors.line,
            }}
          >
            <Text style={{ color: colors.textFaint, fontSize: 11.5 }}>
              © {new Date().getFullYear()} Rook
            </Text>
            <Text style={{ color: colors.textFaint, fontSize: 11.5 }}>
              Built for deliberate work.
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
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
        paddingHorizontal: 7,
        paddingVertical: 5,
        borderRadius: 7,
        backgroundColor: active ? colors.canvas : "transparent",
        opacity: pressed ? 0.65 : 1,
      })}
    >
      <Text
        style={{
          color: active ? colors.text : colors.textFaint,
          fontSize: 10.5,
          fontWeight: "800",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function SignalCard({
  number,
  title,
  detail,
}: {
  number: string;
  title: string;
  detail: string;
}) {
  const { colors } = useRookTheme();
  return (
    <View
      style={{
        width: 224,
        minHeight: 144,
        padding: 16,
        borderRadius: 15,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.line,
      }}
    >
      <Text
        style={{
          color: colors.accent,
          fontSize: 11,
          fontWeight: "900",
          letterSpacing: 0.8,
        }}
      >
        {number}
      </Text>
      <Text
        style={{
          color: colors.text,
          fontSize: 14.5,
          lineHeight: 20,
          fontWeight: "800",
          marginTop: 18,
        }}
      >
        {title}
      </Text>
      <Text
        style={{
          color: colors.textFaint,
          fontSize: 12,
          lineHeight: 17,
          marginTop: 6,
        }}
      >
        {detail}
      </Text>
    </View>
  );
}

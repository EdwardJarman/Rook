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

const POSIX_INSTALL_COMMAND =
  "curl -fsSL https://www.rook.lighting/api/download/cli/install.sh | sh";
const POWERSHELL_INSTALL_COMMAND =
  "irm https://www.rook.lighting/api/download/cli/install.ps1 | iex";

type InstallShell = "posix" | "powershell";

export default function RookLandingPage() {
  const router = useRouter();
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
    <View style={{ flex: 1, backgroundColor: "#080808" }}>
      <ScrollView
        contentContainerStyle={{ minHeight: "100%" }}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={{ flex: 1, backgroundColor: "#080808", overflow: "hidden" }}
        >
          <View
            style={{
              width: "100%",
              maxWidth: 1440,
              minHeight: isWide ? 820 : 900,
              alignSelf: "center",
              paddingHorizontal: isWide ? 42 : 20,
              paddingTop: 22,
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
                top: isWide ? 95 : 388,
                right: isWide ? -28 : -105,
                width: isWide ? "61%" : 540,
                height: isWide ? 680 : 540,
                opacity: isWide ? 1 : 0.86,
              }}
            >
              <EarthGlobe />
            </View>

            <View
              style={{
                flex: 1,
                position: "relative",
                paddingTop: isWide ? 98 : 58,
                justifyContent: "space-between",
              }}
            >
              <View style={{ maxWidth: isWide ? 690 : 620 }}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <View
                    style={{ width: 7, height: 7, backgroundColor: "#f1f0eb" }}
                  />
                  <Text
                    style={{
                      color: "#aba9a2",
                      fontSize: 10.5,
                      fontWeight: "800",
                      letterSpacing: 1.7,
                    }}
                  >
                    ROOK / 01 — PERSONAL OPERATIONS
                  </Text>
                </View>

                <Text
                  style={{
                    color: "#f1f0eb",
                    fontSize: isWide ? 74 : 49,
                    lineHeight: isWide ? 70 : 48,
                    fontWeight: "700",
                    letterSpacing: isWide ? -5.2 : -3.3,
                    marginTop: 30,
                    maxWidth: isWide ? 650 : 510,
                  }}
                >
                  WORK WITH{"\n"}
                  <Text style={{ color: "#77756e" }}>GRAVITY.</Text>
                </Text>

                <Text
                  style={{
                    color: "#c9c7c0",
                    fontSize: 16,
                    lineHeight: 25,
                    marginTop: 27,
                    maxWidth: 435,
                  }}
                >
                  A deliberate workspace for capable Bots. Keep real work close,
                  direct every meaningful step, and bring your own computer in
                  only when it matters.
                </Text>

                <View
                  style={{
                    flexDirection: isWide ? "row" : "column",
                    alignItems: isWide ? "center" : "stretch",
                    gap: 10,
                    marginTop: 36,
                    maxWidth: isWide ? 690 : 510,
                  }}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Copy Rook CLI install command"
                    onPress={() => void copyInstaller()}
                    style={({ pressed }) => ({
                      height: 52,
                      flex: 1,
                      minWidth: 0,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 9,
                      paddingHorizontal: 13,
                      borderWidth: 1,
                      borderColor: "#474640",
                      backgroundColor: "#111110",
                      opacity: pressed ? 0.68 : 1,
                    })}
                  >
                    <MaterialIcons
                      name={copied ? "check" : "terminal"}
                      size={16}
                      color={copied ? "#f1f0eb" : "#8f8d86"}
                    />
                    <Text
                      selectable
                      numberOfLines={1}
                      style={{
                        flex: 1,
                        color: "#cfcdc6",
                        fontFamily: Platform.select({
                          ios: "Menlo",
                          android: "monospace",
                          default:
                            "ui-monospace, SFMono-Regular, Menlo, monospace",
                        }),
                        fontSize: 11.5,
                      }}
                    >
                      $ {installCommand}
                    </Text>
                    <Text
                      style={{
                        color: copied ? "#f1f0eb" : "#85837c",
                        fontSize: 10.5,
                        fontWeight: "800",
                        letterSpacing: 0.5,
                      }}
                    >
                      {copied ? "COPIED" : "COPY"}
                    </Text>
                  </Pressable>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Open Rook downloads"
                    onPress={() => router.push("/download" as never)}
                    style={({ pressed }) => ({
                      height: 52,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 9,
                      paddingHorizontal: 18,
                      backgroundColor: "#f1f0eb",
                      opacity: pressed ? 0.76 : 1,
                    })}
                  >
                    <MaterialIcons name="download" size={18} color="#090909" />
                    <Text
                      style={{
                        color: "#090909",
                        fontSize: 13,
                        fontWeight: "900",
                        letterSpacing: -0.2,
                      }}
                    >
                      Download Rook
                    </Text>
                  </Pressable>
                </View>

                <Text
                  style={{
                    color: "#77756e",
                    fontSize: 11.5,
                    lineHeight: 17,
                    marginTop: 11,
                    maxWidth: 620,
                  }}
                >
                  The CLI installer fetches the current published release,
                  installs for your user account, and verifies Rook before it
                  finishes.
                </Text>
              </View>

              <View
                style={{
                  marginTop: isWide ? 92 : 80,
                  borderTopWidth: 1,
                  borderTopColor: "#35342f",
                  flexDirection: isWide ? "row" : "column",
                }}
              >
                <EditorialDetail
                  index="01"
                  title="A clear role"
                  detail="Shape focused teammates around the context and tools they need."
                  bordered={isWide}
                />
                <EditorialDetail
                  index="02"
                  title="Control stays close"
                  detail="Bring Rook Node into the loop when work needs your own machine."
                  bordered={isWide}
                />
                <EditorialDetail
                  index="03"
                  title="Intent before action"
                  detail="Review consequential external steps before they leave your workspace."
                  bordered={false}
                />
              </View>
            </View>

            <View
              style={{
                marginTop: 42,
                paddingTop: 17,
                borderTopWidth: 1,
                borderTopColor: "#35342f",
                flexDirection: "row",
                justifyContent: "space-between",
                gap: 20,
              }}
            >
              <Text
                style={{ color: "#737169", fontSize: 10.5, letterSpacing: 0.3 }}
              >
                © {new Date().getFullYear()} ROOK
              </Text>
              <Text
                style={{ color: "#737169", fontSize: 10.5, letterSpacing: 0.3 }}
              >
                BUILT FOR DELIBERATE WORK
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
  return (
    <View
      style={{
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        borderBottomWidth: 1,
        borderBottomColor: "#35342f",
        paddingBottom: 16,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View
          style={{
            width: 30,
            height: 30,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#f1f0eb",
          }}
        >
          <RookLogo size={20} color="#090909" />
        </View>
        <Text
          style={{
            color: "#f1f0eb",
            fontSize: 15,
            fontWeight: "900",
            letterSpacing: -0.5,
          }}
        >
          ROOK
        </Text>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sign in to Rook"
          onPress={onSignIn}
          style={({ pressed }) => ({
            minHeight: 34,
            justifyContent: "center",
            paddingHorizontal: 10,
            opacity: pressed ? 0.62 : 1,
          })}
        >
          <Text style={{ color: "#c9c7c0", fontSize: 12, fontWeight: "700" }}>
            Sign in
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Get started with Rook"
          onPress={onSignUp}
          style={({ pressed }) => ({
            minHeight: 34,
            justifyContent: "center",
            paddingHorizontal: 11,
            borderWidth: 1,
            borderColor: "#77756e",
            opacity: pressed ? 0.62 : 1,
          })}
        >
          <Text style={{ color: "#f1f0eb", fontSize: 12, fontWeight: "800" }}>
            Get started
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function EditorialDetail({
  index,
  title,
  detail,
  bordered,
}: {
  index: string;
  title: string;
  detail: string;
  bordered: boolean;
}) {
  return (
    <View
      style={{
        flex: 1,
        minHeight: 144,
        paddingTop: 18,
        paddingRight: 24,
        paddingBottom: 18,
        paddingLeft: bordered ? 24 : 0,
        borderLeftWidth: bordered ? 1 : 0,
        borderLeftColor: "#35342f",
      }}
    >
      <Text
        style={{
          color: "#8f8d86",
          fontSize: 10,
          fontWeight: "900",
          letterSpacing: 1.4,
        }}
      >
        {index}
      </Text>
      <Text
        style={{
          color: "#f1f0eb",
          fontSize: 15,
          fontWeight: "800",
          letterSpacing: -0.4,
          marginTop: 27,
        }}
      >
        {title}
      </Text>
      <Text
        style={{ color: "#99978f", fontSize: 12, lineHeight: 18, marginTop: 7 }}
      >
        {detail}
      </Text>
    </View>
  );
}

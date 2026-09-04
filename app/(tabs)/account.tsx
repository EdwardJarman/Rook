import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { type ComponentProps, type ReactNode, useState } from "react";
import { Alert, Platform, Pressable, ScrollView, Text, View } from "react-native";

import { AiBackendCard } from "@/components/ai-backend-card";
import { AiProviderSwitch } from "@/components/ai-provider-switch";
import { ChatGPTConnectionCard } from "@/components/chatgpt-connection-card";
import { ComputersCard } from "@/components/computers-card";
import { ExcelConnectionCard } from "@/components/excel-connection-card";
import { Avatar, Card, ScreenHeader, SectionHeader, StatusPill, Switch } from "@/components/rook-primitives";
import { ScreenContainer } from "@/components/screen-container";
import { useAuth } from "@/hooks/use-auth";
import { useDockScroll } from "@/lib/dock-visibility";
import { tint, useRookTheme } from "@/lib/ui";
import { useThemeContext } from "@/lib/theme-provider";
import { trpc } from "@/lib/trpc";
import { useWorkroom } from "@/lib/workroom-store";

/** A direct home for profile, data, and session controls. */
export default function AccountScreen() {
  const { syncStatus } = useWorkroom();
  const dockScroll = useDockScroll();

  return (
    <ScreenContainer containerClassName="bg-background" className="flex-1" edges={["top", "left", "right"]}>
      <ScrollView
        {...dockScroll}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 34, gap: 20, maxWidth: 720, width: "100%", alignSelf: "center" }}
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader title="Account" lead="Your space, on your terms." />
        <AppearanceCard />
        <View style={{ gap: 12 }}>
          <SectionHeader title="AI backend" caption="Connect your own plan or use Rook’s shared free models." />
          <AiProviderSwitch />
          <ChatGPTConnectionCard />
          <AiBackendCard provider="openrouter" />
          <AiBackendCard provider="orcarouter" />
          <AiBackendCard provider="tokenrouter" />
        </View>
        <View style={{ gap: 12 }}>
          <SectionHeader title="Connected apps" caption="Give your Bots useful access without giving up control." />
          <ExcelConnectionCard />
        </View>
        <ComputersCard />
        <ProfileAndStorage syncStatus={syncStatus} />
      </ScrollView>
    </ScreenContainer>
  );
}

function AppearanceCard() {
  const { colors } = useRookTheme();
  const { colorScheme, setColorScheme } = useThemeContext();
  const dark = colorScheme === "dark";

  return (
    <Card style={{ flexDirection: "row", alignItems: "center", gap: 13 }}>
      <View style={{ width: 42, height: 42, borderRadius: 15, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center" }}>
        <MaterialIcons name={dark ? "dark-mode" : "light-mode"} size={20} color={colors.textSoft} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontSize: 14.5, fontWeight: "600", letterSpacing: -0.1 }}>Appearance</Text>
        <Text style={{ color: colors.textFaint, fontSize: 12, marginTop: 2 }}>{dark ? "Dark mode" : "Light mode"}</Text>
      </View>
      <Switch accessibilityLabel="Dark mode" checked={dark} onToggle={() => setColorScheme(dark ? "light" : "dark")} />
    </Card>
  );
}

function ProfileAndStorage({ syncStatus }: { syncStatus: string }) {
  const { colors } = useRookTheme();
  const { user, logout } = useAuth();
  const { clearWorkroom } = useWorkroom();
  const records = trpc.records.list.useQuery(undefined, { retry: 1 });
  const exportQuery = trpc.accountData.export.useQuery(undefined, { enabled: false });
  const deleteMutation = trpc.accountData.delete.useMutation();
  const [exporting, setExporting] = useState(false);

  const exportData = async () => {
    setExporting(true);
    try {
      const result = await exportQuery.refetch();
      if (!result.data) throw new Error("No account data returned");
      const content = JSON.stringify(result.data, null, 2);
      if (Platform.OS === "web") {
        const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = "rook-account-export.json";
        link.click();
        URL.revokeObjectURL(url);
      } else {
        const uri = `${FileSystem.documentDirectory}rook-account-export.json`;
        await FileSystem.writeAsStringAsync(uri, content, { encoding: FileSystem.EncodingType.UTF8 });
        if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing is unavailable on this device");
        await Sharing.shareAsync(uri, { mimeType: "application/json", dialogTitle: "Export Rook account data" });
      }
    } catch {
      Alert.alert("Export unavailable", "Rook could not prepare your account export right now. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  const confirmDelete = () =>
    Alert.alert(
      "Delete all Rook workroom data?",
      "This permanently removes your Bots, tasks, files, routines, messages, synced alert settings, and registered devices from this account. Your login remains available.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Continue",
          style: "destructive",
          onPress: () =>
            Alert.alert("Final confirmation", "This cannot be undone. Delete your cloud workroom now?", [
              { text: "Keep data", style: "cancel" },
              {
                text: "Delete all data",
                style: "destructive",
                onPress: () => {
                  void deleteMutation
                    .mutateAsync({ confirmation: "DELETE" })
                    .then((deleted) => {
                      if (deleted) {
                        clearWorkroom();
                        Alert.alert("Workroom deleted", "Your account is now an empty Rook workroom.");
                      }
                    })
                    .catch(() => Alert.alert("Deletion unavailable", "Rook could not delete your data right now. Please try again."));
                },
              },
            ]),
        },
      ],
    );

  const signOut = () => {
    if (Platform.OS === "web") {
      void logout();
      return;
    }
    Alert.alert("Sign out of Rook?", "Your cloud workroom stays safely saved to your account.", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => void logout() },
    ]);
  };

  return (
    <View style={{ gap: 18 }}>
      <SectionHeader title="Profile and storage" caption="Everything about your session in one predictable place." />

      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 13 }}>
          <Avatar label={user?.name ?? user?.email ?? "U"} color="#0E7C59" icon="person" size={50} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ color: colors.text, fontSize: 15.5, fontWeight: "700", letterSpacing: -0.2 }}>
              {user?.name || "Rook account"}
            </Text>
            <Text numberOfLines={1} style={{ color: colors.textSoft, fontSize: 12.5, marginTop: 3 }}>
              {user?.email || "Secure account session"}
            </Text>
          </View>
        </View>
        <View style={{ height: 1, backgroundColor: colors.line }} />
        <StorageRow
          title="Signed in with"
          detail={user?.loginMethod === "github" ? "GitHub" : user?.loginMethod === "google" ? "Google" : user?.loginMethod === "apple" ? "Apple" : "Email"}
        >
          <StatusPill label="Connected" tone="mint" />
        </StorageRow>
        <View style={{ height: 1, backgroundColor: colors.line }} />
        <StorageRow title="Cloud workroom" detail="Managed database per authenticated account">
          <StatusPill
            label={syncStatus}
            tone={syncStatus === "Synced" ? "mint" : syncStatus === "Saving" || syncStatus === "Connecting" ? "amber" : "muted"}
          />
        </StorageRow>
        <View style={{ height: 1, backgroundColor: colors.line }} />
        <StorageRow
          title="Cloud index"
          detail={records.data ? `${records.data.bots.length} Bots · ${records.data.tasks.length} tasks · ${records.data.files.length} files` : "Loading independently queryable records"}
        >
          <MaterialIcons name="storage" size={19} color={colors.textFaint} />
        </StorageRow>
      </Card>

      <View style={{ gap: 10 }}>
        <ActionRow
          icon="ios-share"
          label={exporting ? "Preparing export…" : "Export account data"}
          detail="A complete JSON copy of your workroom."
          onPress={() => void exportData()}
        />
        <ActionRow
          icon="delete-outline"
          label={deleteMutation.isPending ? "Deleting workroom…" : "Delete all workroom data"}
          detail="Permanent, and confirmed twice."
          tone="danger"
          onPress={confirmDelete}
        />
        <ActionRow
          icon="logout"
          label="Sign out"
          detail={Platform.OS === "web" ? "End this browser session" : "End this device session"}
          chevron
          onPress={signOut}
        />
      </View>
    </View>
  );
}

function StorageRow({ title, detail, children }: { title: string; detail: string; children?: ReactNode }) {
  const { colors } = useRookTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingVertical: 6 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: colors.text, fontSize: 14, fontWeight: "600" }}>{title}</Text>
        <Text numberOfLines={1} style={{ color: colors.textFaint, fontSize: 11.5, marginTop: 2 }}>
          {detail}
        </Text>
      </View>
      {children}
    </View>
  );
}

function ActionRow({
  icon,
  label,
  detail,
  onPress,
  tone = "default",
  chevron,
}: {
  icon: ComponentProps<typeof MaterialIcons>["name"];
  label: string;
  detail: string;
  onPress: () => void;
  tone?: "default" | "danger";
  chevron?: boolean;
}) {
  const { colors } = useRookTheme();
  const foreground = tone === "danger" ? colors.coral : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: 62,
          flexDirection: "row",
          alignItems: "center",
          gap: 13,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: tone === "danger" ? tint(colors.coral, 0.3) : colors.line,
          borderRadius: 18,
          paddingHorizontal: 15,
          paddingVertical: 12,
        },
        pressed && { opacity: 0.75 },
      ]}
    >
      <MaterialIcons name={icon} size={19} color={tone === "danger" ? colors.coral : colors.textSoft} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: foreground, fontSize: 14, fontWeight: "600" }}>{label}</Text>
        <Text style={{ color: colors.textFaint, fontSize: 11.5, lineHeight: 16, marginTop: 2 }}>{detail}</Text>
      </View>
      {chevron ? <MaterialIcons name="chevron-right" size={19} color={colors.textFaint} /> : null}
    </Pressable>
  );
}

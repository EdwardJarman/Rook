import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import type { ComponentProps } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from "react-native";

import { Sheet, SheetEyebrow } from "@/components/rook-primitives";
import { trpc } from "@/lib/trpc";
import { tint, useRookTheme } from "@/lib/ui";

const excelGreen = "#107C41";

const futureConnectors = [
  { id: "google-drive", name: "Google Drive", detail: "Docs, Sheets and shared files", icon: "add-to-drive" as const, color: "#4285F4" },
  { id: "slack", name: "Slack", detail: "Channels, threads and messages", icon: "tag" as const, color: "#7C3AED" },
  { id: "telegram", name: "Telegram", detail: "Chats, groups and Bot messages", icon: "send" as const, color: "#229ED9" },
  { id: "notion", name: "Notion", detail: "Pages, databases and knowledge", icon: "article" as const, color: "#5B6472" },
];

export function ComposerConnectorsSheet({
  visible,
  onClose,
  onSelectExcel,
}: {
  visible: boolean;
  onClose: () => void;
  onSelectExcel: () => void;
}) {
  const router = useRouter();
  const { colors } = useRookTheme();
  const excel = trpc.excel.status.useQuery(undefined, {
    enabled: visible,
    retry: 1,
    staleTime: 60_000,
  });

  const connected = excel.data?.connected === true;
  const configured = excel.data?.configured === true;
  const excelStatus = connected
    ? "Connected"
    : excel.isError
      ? "Unavailable"
    : excel.data?.needsReauthorization
      ? "Reconnect"
      : configured
        ? "Available"
        : "Setup needed";

  const chooseExcel = () => {
    onClose();
    if (connected) {
      onSelectExcel();
      return;
    }
    router.navigate("/account" as never);
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      maxHeight="72%"
      contentStyle={Platform.OS === "web" ? { width: "100%", maxWidth: 620, alignSelf: "center", borderBottomLeftRadius: 26, borderBottomRightRadius: 26, marginBottom: 14 } : undefined}
    >
      <SheetEyebrow>Connectors</SheetEyebrow>
      <Text style={{ color: colors.text, fontSize: 21, lineHeight: 27, fontWeight: "700", letterSpacing: -0.5 }}>
        Add context
      </Text>
      <Text style={{ color: colors.textFaint, fontSize: 12, lineHeight: 17, marginTop: 5 }}>
        Choose a connected work app for this message. Add Bots by dragging them from the sidebar into the chat.
      </Text>

      <ScrollView contentContainerStyle={{ paddingTop: 16, paddingBottom: 4, gap: 8 }} showsVerticalScrollIndicator={false}>
        <ConnectorRow
          name="Microsoft Excel"
          detail={connected ? "Use live workbooks for this message" : "Connect OneDrive workbooks from Account"}
          icon="grid-on"
          color={excelGreen}
          status={excel.isLoading ? "Loading" : excelStatus}
          active={connected}
          loading={excel.isLoading}
          onPress={chooseExcel}
        />

        <View style={{ height: 1, backgroundColor: colors.line, marginVertical: 5 }} />
        <Text style={{ color: colors.textFaint, fontSize: 10.5, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase", paddingHorizontal: 4 }}>
          Coming soon
        </Text>

        {futureConnectors.map((connector) => (
          <ConnectorRow
            key={connector.id}
            name={connector.name}
            detail={connector.detail}
            icon={connector.icon}
            color={connector.color}
            status="Coming soon"
            disabled
          />
        ))}
      </ScrollView>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 7, marginTop: 12, paddingHorizontal: 3 }}>
        <MaterialIcons name="verified-user" size={14} color={colors.textFaint} />
        <Text style={{ flex: 1, color: colors.textFaint, fontSize: 10.5, lineHeight: 15 }}>
          Connector access follows your Account settings. Excel writes always pause for approval.
        </Text>
      </View>
    </Sheet>
  );
}

function ConnectorRow({
  name,
  detail,
  icon,
  color,
  status,
  active = false,
  loading = false,
  disabled = false,
  onPress,
}: {
  name: string;
  detail: string;
  icon: ComponentProps<typeof MaterialIcons>["name"];
  color: string;
  status: string;
  active?: boolean;
  loading?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}) {
  const { colors, dark } = useRookTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${status}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 64,
        borderRadius: 17,
        borderWidth: 1,
        borderColor: active ? tint(color, 0.3) : colors.line,
        backgroundColor: active ? tint(color, dark ? 0.14 : 0.055) : colors.surfaceAlt,
        paddingHorizontal: 12,
        paddingVertical: 10,
        flexDirection: "row",
        alignItems: "center",
        gap: 11,
        opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
      })}
    >
      <View style={{ width: 38, height: 38, borderRadius: 13, backgroundColor: tint(color, dark ? 0.2 : 0.11), alignItems: "center", justifyContent: "center" }}>
        <MaterialIcons name={icon} size={19} color={color} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: colors.text, fontSize: 13.5, fontWeight: "700" }}>{name}</Text>
        <Text numberOfLines={1} style={{ color: colors.textFaint, fontSize: 11, marginTop: 2 }}>{detail}</Text>
      </View>
      {loading ? (
        <ActivityIndicator size="small" color={colors.textFaint} />
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          {active ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: excelGreen }} /> : null}
          <Text style={{ color: active ? excelGreen : colors.textFaint, fontSize: 10.5, fontWeight: "600" }}>{status}</Text>
          {!disabled ? <MaterialIcons name="chevron-right" size={17} color={colors.textFaint} /> : null}
        </View>
      )}
    </Pressable>
  );
}

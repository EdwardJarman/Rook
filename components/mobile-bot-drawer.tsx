import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";

import { Avatar } from "@/components/rook-primitives";
import { tint, useRookTheme } from "@/lib/ui";
import type { Bot } from "@/lib/workroom-store";

type MobileBotDrawerProps = {
  visible: boolean;
  bots: Bot[];
  chatBotIds: string[];
  activeBotId: string;
  onClose: () => void;
  onNewChat: () => void;
  onCreateBot: () => void;
  onSelectBot: (botId: string) => void;
};

/**
 * Compact-screen bot navigation. It keeps the full roster one tap away without
 * consuming vertical chat space or rendering participant marks before a user
 * intentionally begins a chat.
 */
export function MobileBotDrawer({
  visible,
  bots,
  chatBotIds,
  activeBotId,
  onClose,
  onNewChat,
  onCreateBot,
  onSelectBot,
}: MobileBotDrawerProps) {
  const { colors } = useRookTheme();

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, flexDirection: "row" }}>
        <View
          accessibilityViewIsModal
          style={{
            width: "84%",
            maxWidth: 336,
            height: "100%",
            backgroundColor: colors.canvas,
            borderRightWidth: 1,
            borderRightColor: colors.line,
            paddingTop: 18,
            paddingHorizontal: 14,
            paddingBottom: 18,
            shadowColor: "#000000",
            shadowOpacity: 0.22,
            shadowRadius: 22,
            shadowOffset: { width: 6, height: 0 },
            elevation: 20,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              paddingHorizontal: 3,
            }}
          >
            <View>
              <Text
                style={{
                  color: colors.textFaint,
                  fontSize: 10.5,
                  fontWeight: "700",
                  letterSpacing: 1.15,
                }}
              >
                ROOK
              </Text>
              <Text
                style={{
                  color: colors.text,
                  fontSize: 20,
                  lineHeight: 26,
                  fontWeight: "700",
                  letterSpacing: -0.45,
                  marginTop: 2,
                }}
              >
                Your Bots
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close bot sidebar"
              onPress={onClose}
              hitSlop={8}
              style={({ pressed }) => ({
                width: 38,
                height: 38,
                borderRadius: 19,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: colors.surfaceAlt,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <MaterialIcons name="close" size={21} color={colors.text} />
            </Pressable>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="New chat"
            onPress={onNewChat}
            style={({ pressed }) => ({
              marginTop: 22,
              minHeight: 48,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              borderRadius: 14,
              backgroundColor: colors.ink,
              opacity: pressed ? 0.76 : 1,
            })}
          >
            <MaterialIcons name="edit-square" size={18} color={colors.onInk} />
            <Text
              style={{ color: colors.onInk, fontSize: 14, fontWeight: "700" }}
            >
              New Chat
            </Text>
          </Pressable>

          <View
            style={{
              marginTop: 24,
              marginBottom: 8,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: 4,
            }}
          >
            <Text
              style={{
                color: colors.textSoft,
                fontSize: 12,
                fontWeight: "700",
                letterSpacing: 0.25,
              }}
            >
              ALL BOTS
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Create a new Bot"
              onPress={onCreateBot}
              hitSlop={7}
              style={({ pressed }) => ({
                width: 30,
                height: 30,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 10,
                opacity: pressed ? 0.55 : 1,
              })}
            >
              <MaterialIcons name="add" size={21} color={colors.accent} />
            </Pressable>
          </View>

          {bots.length ? (
            <ScrollView
              contentContainerStyle={{ gap: 4, paddingBottom: 12 }}
              showsVerticalScrollIndicator={false}
            >
              {bots.map((bot) => {
                const active = activeBotId === bot.id;
                const inChat = chatBotIds.includes(bot.id);
                return (
                  <Pressable
                    key={bot.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Open chat with ${bot.name}`}
                    onPress={() => onSelectBot(bot.id)}
                    style={({ pressed }) => ({
                      minHeight: 58,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 11,
                      paddingHorizontal: 10,
                      borderRadius: 14,
                      backgroundColor: active
                        ? tint(colors.accent, 0.12)
                        : pressed
                          ? colors.surfaceAlt
                          : "transparent",
                      borderWidth: active ? 1 : 0,
                      borderColor: active
                        ? tint(colors.accent, 0.28)
                        : "transparent",
                    })}
                  >
                    <Avatar
                      label={bot.avatar}
                      color={bot.color}
                      icon={bot.icon}
                      size={34}
                    />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text
                        numberOfLines={1}
                        style={{
                          color: colors.text,
                          fontSize: 14,
                          fontWeight: "700",
                          letterSpacing: -0.15,
                        }}
                      >
                        {bot.name}
                      </Text>
                      <Text
                        numberOfLines={1}
                        style={{
                          color: colors.textFaint,
                          fontSize: 11.5,
                          marginTop: 2,
                        }}
                      >
                        {bot.status === "Working" ? "Working now" : bot.role}
                      </Text>
                    </View>
                    {inChat ? (
                      <View
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: 4,
                          backgroundColor: colors.accent,
                        }}
                      />
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : (
            <View style={{ paddingHorizontal: 4, paddingTop: 10, gap: 8 }}>
              <Text
                style={{ color: colors.text, fontSize: 14, fontWeight: "700" }}
              >
                No Bots yet
              </Text>
              <Text
                style={{
                  color: colors.textFaint,
                  fontSize: 12.5,
                  lineHeight: 18,
                }}
              >
                Create a Bot and it will appear here, ready for your next chat.
              </Text>
            </View>
          )}
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close bot sidebar"
          onPress={onClose}
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.38)" }}
        />
      </View>
    </Modal>
  );
}

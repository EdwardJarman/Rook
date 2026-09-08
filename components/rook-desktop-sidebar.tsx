import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { BotCreateSheet } from "@/components/bot-create-sheet";
import { RookLogo } from "@/components/rook-logo";
import { Avatar } from "@/components/rook-primitives";
import { useAuth } from "@/hooks/use-auth";
import { botDragSourceProps, useBotDrag } from "@/lib/bot-drag";
import { useDesktopSidebar } from "@/lib/desktop-sidebar-state";
import { tint, useRookTheme } from "@/lib/ui";
import { useWorkroom, type Bot } from "@/lib/workroom-store";

/** Wide-canvas width where web switches from the mobile dock to the Bot panel. */
export const DESKTOP_NAV_BREAKPOINT = 960;
/** Fixed canvas width for the desktop Bot panel. */
export const SIDEBAR_WIDTH = 280;
export const SIDEBAR_MARGIN = 12;
export const STAGE_GUTTER = 12;

/** The stage only reserves room when the desktop panel is actually visible. */
export const DESKTOP_STAGE_INSET = {
  paddingLeft: SIDEBAR_MARGIN + SIDEBAR_WIDTH + STAGE_GUTTER,
  paddingTop: STAGE_GUTTER,
  paddingRight: STAGE_GUTTER,
  paddingBottom: STAGE_GUTTER,
};

/**
 * Desktop's Bot panel is intentionally quiet: it is a compact workroom index,
 * not another destination. A Bot can be clicked to focus it in the room or
 * dragged directly into the stage.
 */
export function RookDesktopSidebar({ navigation }: BottomTabBarProps) {
  const { colors } = useRookTheme();
  const { visible, hide } = useDesktopSidebar();
  const { user } = useAuth();
  const { bots } = useWorkroom();
  const {
    beginDrag,
    endDrag,
    draggingBot,
    chatBotIds,
    addBotToChat,
    focusChatBot,
    startNewChat,
  } = useBotDrag();
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const displayName = user?.name ?? user?.email?.split("@")[0] ?? null;
  const showDragHint = bots.length > 0 && chatBotIds.length === 0;

  const openChat = () => navigation.navigate("index");
  const handleNewChat = () => {
    startNewChat();
    openChat();
  };
  const handleBotPress = (botId: string) => {
    addBotToChat(botId);
    focusChatBot(botId);
    openChat();
  };

  if (!visible) return null;

  return (
    <>
      <View
        style={[
          styles.frame,
          {
            width: SIDEBAR_WIDTH,
            left: SIDEBAR_MARGIN,
            backgroundColor: colors.canvas,
            borderColor: colors.line,
          },
        ]}
        accessibilityLabel="Your Bots"
      >
        <View style={[styles.header, { borderBottomColor: colors.line }]}>
          <View style={styles.brand}>
            <View style={[styles.brandMark, { backgroundColor: colors.ink }]}>
              <RookLogo size={21} color={colors.onInk} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.brandName, { color: colors.text }]}>
                Rook
              </Text>
              <Text style={[styles.brandCaption, { color: colors.textFaint }]}>
                Your workroom
              </Text>
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close your Bots sidebar"
            accessibilityHint="The chat will expand to use this space."
            onPress={hide}
            onHoverIn={() => setHoveredKey("close")}
            onHoverOut={() =>
              setHoveredKey((current) => (current === "close" ? null : current))
            }
            style={({ pressed }) => [
              styles.iconAction,
              hoveredKey === "close" && {
                backgroundColor: tint(colors.text, 0.06),
              },
              pressed && { opacity: 0.65, transform: [{ scale: 0.96 }] },
            ]}
          >
            <MaterialIcons
              name="chevron-left"
              size={20}
              color={colors.textSoft}
            />
          </Pressable>
        </View>

        <View style={styles.content}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Start a new chat"
            accessibilityHint="Begins a new conversation with no Bots selected."
            onPress={handleNewChat}
            onHoverIn={() => setHoveredKey("new-chat")}
            onHoverOut={() =>
              setHoveredKey((current) =>
                current === "new-chat" ? null : current,
              )
            }
            style={({ pressed }) => [
              styles.newChat,
              {
                backgroundColor:
                  hoveredKey === "new-chat"
                    ? tint(colors.ink, 0.92)
                    : colors.ink,
              },
              pressed && { opacity: 0.84, transform: [{ scale: 0.985 }] },
            ]}
          >
            <MaterialIcons name="add" size={18} color={colors.onInk} />
            <Text style={[styles.newChatLabel, { color: colors.onInk }]}>
              New chat
            </Text>
          </Pressable>

          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionLabel, { color: colors.textFaint }]}>
              YOUR BOTS
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Create a Bot"
              onPress={() => setCreateOpen(true)}
              onHoverIn={() => setHoveredKey("new-bot")}
              onHoverOut={() =>
                setHoveredKey((current) =>
                  current === "new-bot" ? null : current,
                )
              }
              style={({ pressed }) => [
                styles.iconAction,
                hoveredKey === "new-bot" && {
                  backgroundColor: tint(colors.text, 0.06),
                },
                pressed && { opacity: 0.65, transform: [{ scale: 0.96 }] },
              ]}
            >
              <MaterialIcons name="add" size={18} color={colors.textSoft} />
            </Pressable>
          </View>

          {bots.length === 0 ? (
            <View style={styles.emptyRoster}>
              <View
                style={[
                  styles.emptyMark,
                  { backgroundColor: tint(colors.accent, 0.12) },
                ]}
              >
                <MaterialIcons
                  name="smart-toy"
                  size={19}
                  color={colors.accent}
                />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>
                No Bots yet
              </Text>
              <Text style={[styles.emptyCopy, { color: colors.textFaint }]}>
                Create a focused teammate to begin.
              </Text>
            </View>
          ) : (
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={styles.roster}
              showsVerticalScrollIndicator={false}
            >
              {bots.map((bot) => (
                <SidebarBotRow
                  key={bot.id}
                  bot={bot}
                  active={chatBotIds.includes(bot.id)}
                  dragging={draggingBot?.id === bot.id}
                  hovered={hoveredKey === bot.id}
                  onHoverChange={(hovered) =>
                    setHoveredKey((current) =>
                      hovered ? bot.id : current === bot.id ? null : current,
                    )
                  }
                  onPress={() => handleBotPress(bot.id)}
                  onDragStart={() => beginDrag(bot)}
                  onDragEnd={endDrag}
                />
              ))}
            </ScrollView>
          )}

          {showDragHint ? (
            <Text style={[styles.dragHint, { color: colors.textFaint }]}>
              Drag a Bot into the chat, or select it here.
            </Text>
          ) : null}
        </View>

        {displayName ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open account"
            onPress={() => navigation.navigate("account")}
            onHoverIn={() => setHoveredKey("account")}
            onHoverOut={() =>
              setHoveredKey((current) =>
                current === "account" ? null : current,
              )
            }
            style={({ pressed }) => [
              styles.account,
              {
                borderTopColor: colors.line,
                backgroundColor:
                  hoveredKey === "account"
                    ? tint(colors.text, 0.04)
                    : "transparent",
              },
              pressed && { opacity: 0.7 },
            ]}
          >
            <View
              style={[
                styles.accountAvatar,
                { backgroundColor: tint(colors.accent, 0.12) },
              ]}
            >
              <Text
                style={{
                  color: colors.accent,
                  fontSize: 13,
                  fontWeight: "700",
                }}
              >
                {displayName.slice(0, 1).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                numberOfLines={1}
                style={[styles.accountName, { color: colors.text }]}
              >
                {displayName}
              </Text>
              <Text
                numberOfLines={1}
                style={[styles.accountCaption, { color: colors.textFaint }]}
              >
                Account settings
              </Text>
            </View>
            <MaterialIcons
              name="more-horiz"
              size={20}
              color={colors.textFaint}
            />
          </Pressable>
        ) : null}
      </View>

      <BotCreateSheet
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(bot) => {
          addBotToChat(bot.id);
          focusChatBot(bot.id);
          openChat();
        }}
      />
    </>
  );
}

/** One focused Bot row, still a real drag source on desktop web. */
function SidebarBotRow({
  bot,
  active,
  dragging,
  hovered,
  onHoverChange,
  onPress,
  onDragStart,
  onDragEnd,
}: {
  bot: Bot;
  active: boolean;
  dragging: boolean;
  hovered: boolean;
  onHoverChange: (hovered: boolean) => void;
  onPress: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const { colors } = useRookTheme();
  const dragProps = botDragSourceProps(bot, {
    onStart: onDragStart,
    onEnd: onDragEnd,
  });

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        active ? `${bot.name}, in this chat` : `Add ${bot.name} to this chat`
      }
      accessibilityHint={
        Platform.OS === "web"
          ? "Drag into the chat, or press to add and focus it."
          : undefined
      }
      onHoverIn={() => onHoverChange(true)}
      onHoverOut={() => onHoverChange(false)}
      onPress={onPress}
      {...dragProps}
      style={({ pressed }) => [
        styles.botRow,
        active && {
          backgroundColor: tint(colors.accent, 0.09),
          borderColor: tint(colors.accent, 0.2),
        },
        !active && hovered && { backgroundColor: tint(colors.text, 0.045) },
        dragging && { opacity: 0.4 },
        pressed && { opacity: 0.72 },
        Platform.OS === "web" ? ({ cursor: "grab" } as never) : null,
      ]}
    >
      <Avatar label={bot.avatar} color={bot.color} icon={bot.icon} size={34} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={[styles.botName, { color: colors.text }]}
        >
          {bot.name}
        </Text>
        <Text
          numberOfLines={1}
          style={[
            styles.botRole,
            { color: active ? colors.accent : colors.textFaint },
          ]}
        >
          {bot.status === "Working" ? "Working now" : bot.role}
        </Text>
      </View>
      {active ? (
        <View style={[styles.presence, { backgroundColor: colors.accent }]} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  frame: {
    position: "absolute",
    top: SIDEBAR_MARGIN,
    bottom: SIDEBAR_MARGIN,
    zIndex: 50,
    borderWidth: 1,
    borderRadius: 20,
    overflow: "hidden",
  },
  header: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  brand: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  brandMark: {
    width: 31,
    height: 31,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  brandName: { fontSize: 15, fontWeight: "700", letterSpacing: -0.25 },
  brandCaption: { marginTop: 1, fontSize: 11, fontWeight: "500" },
  iconAction: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  content: { flex: 1, paddingHorizontal: 10, paddingTop: 12 },
  newChat: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  newChatLabel: { fontSize: 13, fontWeight: "700", letterSpacing: -0.1 },
  sectionHeader: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: 4,
    paddingRight: 1,
  },
  sectionLabel: { fontSize: 10.5, fontWeight: "700", letterSpacing: 0.85 },
  roster: { gap: 3, paddingBottom: 10 },
  botRow: {
    minHeight: 55,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 9,
    paddingVertical: 8,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "transparent",
  },
  botName: { fontSize: 13.5, fontWeight: "600", letterSpacing: -0.15 },
  botRole: { marginTop: 2, fontSize: 11.5, fontWeight: "500" },
  presence: { width: 6, height: 6, borderRadius: 3, marginRight: 2 },
  emptyRoster: { alignItems: "center", paddingHorizontal: 24, paddingTop: 34 },
  emptyMark: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  emptyTitle: { fontSize: 13.5, fontWeight: "700" },
  emptyCopy: {
    marginTop: 5,
    fontSize: 11.5,
    lineHeight: 16,
    textAlign: "center",
  },
  dragHint: {
    paddingHorizontal: 5,
    paddingBottom: 12,
    fontSize: 11,
    lineHeight: 16,
  },
  account: {
    minHeight: 66,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  accountAvatar: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  accountName: { fontSize: 12.5, fontWeight: "600", letterSpacing: -0.1 },
  accountCaption: { marginTop: 2, fontSize: 11 },
});

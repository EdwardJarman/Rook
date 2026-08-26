import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Tabs } from "expo-router";
import { Platform, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HapticTab } from "@/components/haptic-tab";
import {
  DESKTOP_NAV_BREAKPOINT,
  DESKTOP_STAGE_INSET,
  RookDesktopSidebar,
} from "@/components/rook-desktop-sidebar";
import { DockVisibilityProvider } from "@/lib/dock-visibility";
import { useRookTheme } from "@/lib/ui";

export default function TabLayout() {
  return (
    <DockVisibilityProvider>
      <RookTabs />
    </DockVisibilityProvider>
  );
}

/**
 * Desktop keeps the focused workroom rail. Android gets a persistent native
 * bottom bar: Bots, Library, Updates, and Account are all first-class phone
 * destinations rather than hidden routes reachable only from header buttons.
 */
function RookTabs() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { colors } = useRookTheme();
  const isDesktopLayout = Platform.OS === "web" && width >= DESKTOP_NAV_BREAKPOINT;
  const bottomPadding = Math.max(insets.bottom, 8);
  const mobileTabHeight = 56 + bottomPadding;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: isDesktopLayout ? DESKTOP_STAGE_INSET : undefined,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarButton: HapticTab,
        tabBarStyle: isDesktopLayout
          ? { display: "none" }
          : {
              height: mobileTabHeight,
              paddingTop: 7,
              paddingBottom: bottomPadding,
              backgroundColor: colors.canvas,
              borderTopColor: colors.line,
              borderTopWidth: 1,
              elevation: 0,
            },
        tabBarLabelStyle: {
          fontSize: 10.5,
          fontWeight: "600",
          marginTop: 1,
        },
      }}
      tabBar={(props) => (isDesktopLayout ? <RookDesktopSidebar {...props} /> : undefined)}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Chat",
          tabBarAccessibilityLabel: "Open chat",
          tabBarIcon: ({ color, size }) => <MaterialIcons name="forum" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="bots"
        options={{
          title: "Bots",
          tabBarAccessibilityLabel: "Open Bots",
          tabBarIcon: ({ color, size }) => <MaterialIcons name="smart-toy" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          title: "Library",
          tabBarAccessibilityLabel: "Open Library",
          tabBarIcon: ({ color, size }) => <MaterialIcons name="folder-open" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="activity"
        options={{
          title: "Updates",
          tabBarAccessibilityLabel: "Open Updates",
          tabBarBadge: undefined,
          tabBarIcon: ({ color, size }) => <MaterialIcons name="notifications-none" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: "Account",
          tabBarAccessibilityLabel: "Open account",
          tabBarIcon: ({ color, size }) => <MaterialIcons name="person-outline" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}

import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { BlurView } from "expo-blur";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { useDockVisibility } from "@/lib/dock-visibility";
import { useThemeContext } from "@/lib/theme-provider";

const ROUTE_ICONS = {
  index: "message.fill",
  bots: "person.2.fill",
  library: "books.vertical.fill",
  activity: "bell.fill",
  account: "person.crop.circle",
} as const;

const MAX_DOCK_WIDTH = 430;
const DOCK_HEIGHT = 62;
const TRACK_INSET = 5;

export function RookFloatingDock({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { colorScheme } = useThemeContext();
  const { dockVisible, translateY, showDock } = useDockVisibility();
  const [trackWidth, setTrackWidth] = useState(0);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const indicatorX = useRef(new Animated.Value(0)).current;
  const indicatorReady = useRef(false);
  const itemScales = useRef(state.routes.map(() => new Animated.Value(1))).current;

  const dark = colorScheme === "dark";
  const dockWidth = Math.max(0, Math.min(width - 24, MAX_DOCK_WIDTH));
  const itemWidth = trackWidth > 0 ? trackWidth / state.routes.length : 0;
  const dockBottom = Platform.OS === "web" ? 18 : Math.max(insets.bottom, 10);
  const compactLabels = width < 350;

  const glass = useMemo(
    () => ({
      surface: dark ? "rgba(13, 17, 24, 0.78)" : "rgba(255, 255, 255, 0.78)",
      edge: dark ? "rgba(255, 255, 255, 0.10)" : "rgba(23, 26, 32, 0.08)",
      active: dark ? "#222938" : "#FFFFFF",
      activeEdge: dark ? "rgba(255, 255, 255, 0.14)" : "rgba(23, 26, 32, 0.10)",
      activeText: dark ? "#F2F5F8" : "#191C22",
      activeIcon: dark ? "#6FE8BC" : "#0E7C59",
      idleText: dark ? "#96A0AF" : "#6B7280",
      idleIcon: dark ? "#8B95A4" : "#7A8290",
      hover: dark ? "rgba(255, 255, 255, 0.06)" : "rgba(23, 26, 32, 0.05)",
      shadow: dark ? "#01030A" : "#3A4150",
    }),
    [dark],
  );

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!itemWidth) return;
    const target = state.index * itemWidth;
    if (!indicatorReady.current || reduceMotion) {
      indicatorX.setValue(target);
      indicatorReady.current = true;
      return;
    }

    Animated.spring(indicatorX, {
      toValue: target,
      mass: 0.7,
      damping: 19,
      stiffness: 210,
      useNativeDriver: true,
    }).start();
  }, [indicatorX, itemWidth, reduceMotion, state.index]);

  const animatePress = useCallback(
    (index: number) => {
      if (reduceMotion) return;
      const scale = itemScales[index];
      scale.stopAnimation();
      Animated.sequence([
        Animated.timing(scale, {
          toValue: 0.88,
          duration: 70,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.spring(scale, {
          toValue: 1,
          mass: 0.45,
          damping: 8,
          stiffness: 280,
          useNativeDriver: true,
        }),
      ]).start();
    },
    [itemScales, reduceMotion],
  );

  const handleTrackLayout = useCallback((event: LayoutChangeEvent) => {
    setTrackWidth(event.nativeEvent.layout.width);
  }, []);

  return (
    <Animated.View
      pointerEvents={dockVisible ? "box-none" : "none"}
      style={[
        styles.frame,
        {
          bottom: dockBottom,
          transform: [{ translateY }],
        },
      ]}
    >
      <View
        accessibilityRole="tablist"
        renderToHardwareTextureAndroid
        style={[
          styles.shadowShell,
          {
            width: dockWidth,
            shadowColor: glass.shadow,
          },
        ]}
      >
        <BlurView
          intensity={dark ? 64 : 82}
          tint={dark ? "systemUltraThinMaterialDark" : "systemUltraThinMaterialLight"}
          experimentalBlurMethod="dimezisBlurView"
          blurReductionFactor={3}
          style={[
            styles.glassShell,
            {
              backgroundColor: glass.surface,
              borderColor: glass.edge,
            },
          ]}
        >
          <View onLayout={handleTrackLayout} style={styles.track}>
            {itemWidth > 0 ? (
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.activePill,
                  {
                    width: Math.max(0, itemWidth - 6),
                    backgroundColor: glass.active,
                    borderColor: glass.activeEdge,
                    transform: [{ translateX: indicatorX }],
                  },
                ]}
              />
            ) : null}

            {state.routes.map((route, index) => {
              const descriptor = descriptors[route.key];
              const isFocused = state.index === index;
              const icon = ROUTE_ICONS[route.name as keyof typeof ROUTE_ICONS];
              const label = descriptor.options.tabBarAccessibilityLabel ?? descriptor.options.title ?? route.name;
              if (!icon) return null;

              const onPress = () => {
                showDock();
                animatePress(index);
                const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
                if (!isFocused && !event.defaultPrevented) navigation.navigate(route.name);
              };

              return (
                <Pressable
                  key={route.key}
                  accessibilityRole="tab"
                  accessibilityLabel={label}
                  accessibilityState={{ selected: isFocused }}
                  onHoverIn={() => setHoveredIndex(index)}
                  onHoverOut={() => setHoveredIndex((current) => (current === index ? null : current))}
                  onLongPress={() => navigation.emit({ type: "tabLongPress", target: route.key })}
                  onPress={onPress}
                  style={styles.item}
                >
                  {hoveredIndex === index && !isFocused ? (
                    <View pointerEvents="none" style={[styles.hoverWash, { backgroundColor: glass.hover }]} />
                  ) : null}
                  <Animated.View style={[styles.itemContent, { transform: [{ scale: itemScales[index] }] }]}>
                    <IconSymbol size={20} name={icon} color={isFocused ? glass.activeIcon : glass.idleIcon} />
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.label,
                        compactLabels && styles.labelCompact,
                        { color: isFocused ? glass.activeText : glass.idleText },
                        isFocused && styles.labelActive,
                      ]}
                    >
                      {label}
                    </Text>
                  </Animated.View>
                </Pressable>
              );
            })}
          </View>
        </BlurView>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  frame: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 50,
    alignItems: "center",
  },
  shadowShell: {
    height: DOCK_HEIGHT,
    borderRadius: 24,
    shadowOpacity: 0.16,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 24,
    elevation: 14,
  },
  glassShell: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 24,
    overflow: "hidden",
  },
  track: {
    flex: 1,
    flexDirection: "row",
    margin: TRACK_INSET,
  },
  activePill: {
    position: "absolute",
    left: 3,
    top: 0,
    bottom: 0,
    borderRadius: 18,
    borderWidth: 1,
  },
  item: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
  },
  itemContent: {
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  hoverWash: {
    position: "absolute",
    top: 3,
    bottom: 3,
    left: 3,
    right: 3,
    borderRadius: 16,
  },
  label: {
    maxWidth: "100%",
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "600",
    letterSpacing: 0.05,
    paddingHorizontal: 2,
  },
  labelCompact: {
    fontSize: 9,
    letterSpacing: -0.1,
  },
  labelActive: {
    fontWeight: "700",
  },
});

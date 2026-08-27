import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { Avatar } from "@/components/rook-primitives";
import { DRIVE_PIXEL_DELAYS, formatWorkingElapsed } from "@/lib/ai-working";
import { tint, useRookTheme } from "@/lib/ui";
import type { Bot } from "@/lib/workroom-store";

/**
 * A concise live status. It intentionally reports only visible, user-safe
 * stages of the active reply; detailed public sources are added only after a
 * completed server response records them.
 */
export function AiWorkingIndicator({ bot }: { bot: Bot }) {
  const { colors } = useRookTheme();
  const [elapsedMs, setElapsedMs] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const startedAt = useRef(Date.now());
  const stage =
    elapsedMs < 1_400
      ? "Reading your request"
      : elapsedMs < 3_400
        ? "Preparing a response"
        : "Working";

  useEffect(() => {
    startedAt.current = Date.now();
    setElapsedMs(0);
    setExpanded(false);
    const interval = setInterval(
      () => setElapsedMs(Date.now() - startedAt.current),
      100,
    );
    return () => clearInterval(interval);
  }, [bot.id]);

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={`${bot.name} is ${stage.toLowerCase()}`}
      accessibilityLiveRegion="polite"
      style={{ maxWidth: 520, paddingRight: 20, paddingVertical: 3 }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${expanded ? "Hide" : "Show"} live response activity`}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((current) => !current)}
        style={({ pressed }) => [
          {
            minHeight: 30,
            alignSelf: "flex-start",
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingVertical: 3,
            paddingRight: 4,
          },
          pressed && { opacity: 0.68 },
        ]}
      >
        <Avatar
          label={bot.avatar}
          color={bot.color}
          icon={bot.icon}
          size={22}
        />
        <View
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          style={{
            width: 16,
            height: 16,
            flexDirection: "row",
            flexWrap: "wrap",
            gap: 2,
          }}
        >
          {DRIVE_PIXEL_DELAYS.map((delay, index) => (
            <DrivePixel key={index} delay={delay} color={colors.text} />
          ))}
        </View>
        <WorkingLabel label={stage} color={colors.textSoft} />
        <Text
          accessible={false}
          style={{
            color: colors.textFaint,
            fontSize: 11.5,
            lineHeight: 16,
            fontVariant: ["tabular-nums"],
          }}
        >
          {formatWorkingElapsed(elapsedMs)}
        </Text>
        <MaterialChevron expanded={expanded} color={colors.textFaint} />
      </Pressable>

      {expanded ? (
        <View
          style={{
            marginTop: 4,
            marginLeft: 10,
            borderLeftWidth: 1,
            borderLeftColor: tint(colors.text, 0.14),
            gap: 6,
            paddingLeft: 11,
            paddingVertical: 3,
          }}
        >
          <LiveStep
            label="Read the current conversation"
            color={colors.textFaint}
          />
          <LiveStep label={stage} color={colors.textSoft} active />
        </View>
      ) : null}
    </View>
  );
}

function MaterialChevron({
  expanded,
  color,
}: {
  expanded: boolean;
  color: string;
}) {
  return (
    <Text style={{ color, fontSize: 16, lineHeight: 18, marginLeft: -2 }}>
      {expanded ? "⌃" : "⌄"}
    </Text>
  );
}

function LiveStep({
  label,
  color,
  active = false,
}: {
  label: string;
  color: string;
  active?: boolean;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
      <View
        style={{
          width: active ? 6 : 5,
          height: active ? 6 : 5,
          borderRadius: 99,
          backgroundColor: color,
          opacity: active ? 1 : 0.68,
        }}
      />
      <Text
        style={{
          color,
          fontSize: 11.5,
          lineHeight: 16,
          fontWeight: active ? "600" : "500",
        }}
      >
        {label}
      </Text>
    </View>
  );
}

function DrivePixel({ delay, color }: { delay: number; color: string }) {
  const reducedMotion = useReducedMotion();
  const intensity = useSharedValue(0.14);

  useEffect(() => {
    cancelAnimation(intensity);
    if (reducedMotion) {
      intensity.value = 0.22;
      return;
    }
    intensity.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 180, easing: Easing.out(Easing.quad) }),
          withTiming(0.14, {
            duration: 470,
            easing: Easing.inOut(Easing.quad),
          }),
        ),
        -1,
        false,
      ),
    );
    return () => cancelAnimation(intensity);
  }, [delay, intensity, reducedMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: intensity.value,
    transform: [{ scale: 0.9 + intensity.value * 0.1 }],
  }));

  return (
    <Animated.View
      style={[
        {
          width: 4,
          height: 4,
          borderRadius: 1,
          backgroundColor: color,
        },
        animatedStyle,
      ]}
    />
  );
}

function WorkingLabel({ label, color }: { label: string; color: string }) {
  const reducedMotion = useReducedMotion();
  const opacity = useSharedValue(0.68);

  useEffect(() => {
    cancelAnimation(opacity);
    if (reducedMotion) {
      opacity.value = 1;
      return;
    }
    opacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 700, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.58, {
          duration: 700,
          easing: Easing.inOut(Easing.quad),
        }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(opacity);
  }, [opacity, reducedMotion]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.Text
      style={[
        { color, fontSize: 12.5, lineHeight: 18, fontWeight: "600" },
        animatedStyle,
      ]}
    >
      {label}
    </Animated.Text>
  );
}

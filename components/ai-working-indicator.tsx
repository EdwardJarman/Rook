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
import type { AgentTraceStep } from "@/shared/agent-trace";
import { DRIVE_PIXEL_DELAYS, formatWorkingElapsed } from "@/lib/ai-working";
import { tint, useRookTheme } from "@/lib/ui";
import type { Bot } from "@/lib/workroom-store";

/**
 * Live agent activity while the reply runs. The look follows the shared
 * ThinkingState reference: a sparkle header with a shimmer "Working…" label,
 * a chevron expander, and a vertical trace rail of completed tool steps plus
 * one spinner row for the step in flight.
 *
 * Every row is real: completed steps arrive via server progress (kind/title/
 * detail/atMs) and stream in; before the first real step lands, one honest
 * "Sent your message…" placeholder holds the rail. Nothing is mocked.
 */
export function AiWorkingIndicator({
  bot,
  progress = [],
  startedAtMs,
}: {
  bot: Bot;
  progress?: AgentTraceStep[];
  startedAtMs?: number;
}) {
  const { colors } = useRookTheme();
  const [elapsedMs, setElapsedMs] = useState(() =>
    startedAtMs ? Math.max(0, Date.now() - startedAtMs) : 0,
  );
  const [expanded, setExpanded] = useState(true);
  const startRef = useRef(startedAtMs ?? Date.now());
  const open = progress.length > 0;
  const headline = open
    ? workingHeadline(progress[progress.length - 1])
    : phaseHeadline(elapsedMs);

  useEffect(() => {
    startRef.current = startedAtMs ?? Date.now();
    setExpanded(true);
    setElapsedMs(Math.max(0, Date.now() - startRef.current));
    const interval = setInterval(() => {
      setElapsedMs(Math.max(0, Date.now() - startRef.current));
    }, 100);
    return () => clearInterval(interval);
  }, [bot.id, startedAtMs]);

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={`${bot.name} is ${headline.toLowerCase()}`}
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
            paddingHorizontal: 6,
            marginHorizontal: -6,
            borderRadius: 8,
          },
          pressed && { opacity: 0.68 },
        ]}
      >
        <Sparkle working color={colors.textSoft} />
        <WorkingLabel label={headline} color={colors.textSoft} />
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
        <Chevron expanded={expanded} color={colors.textFaint} />
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
          {progress.length === 0 ? (
            <TraceRow
              label="Sent your message to the model"
              color={colors.textSoft}
              active
            />
          ) : (
            progress.map((step, index) => (
              <TraceRow
                key={`${step.kind}-${step.title}-${index}`}
                label={step.title}
                detail={step.detail}
                color={colors.textSoft}
                active={index === progress.length - 1}
              />
            ))
          )}
          <View
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            style={{ flexDirection: "row", gap: 2, marginTop: 2 }}
          >
            {DRIVE_PIXEL_DELAYS.slice(0, 5).map((delay, index) => (
              <DrivePixel key={index} delay={delay} color={colors.textFaint} />
            ))}
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
            <Avatar
              label={bot.avatar}
              color={bot.color}
              icon={bot.icon}
              size={16}
            />
            <Text style={{ color: colors.textFaint, fontSize: 11 }}>
              Live — full steps stay under the reply when it lands.
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function phaseHeadline(elapsedMs: number): string {
  if (elapsedMs < 2_000) return "Working";
  if (elapsedMs < 6_000) return "Thinking";
  if (elapsedMs < 15_000) return "Running tools";
  return "Still working";
}

function workingHeadline(step: AgentTraceStep): string {
  if (step.kind === "search") return "Searching the web";
  if (step.kind === "source") return "Reading sources";
  if (/approv/i.test(step.title)) return "Preparing approval";
  if (/propos/i.test(step.title)) return "Running tools";
  if (/read|list|wrote|found|checked/i.test(step.title)) return "Running tools";
  return "Working";
}

function Sparkle({ working, color }: { working: boolean; color: string }) {
  const pulse = useSharedValue(1);
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    cancelAnimation(pulse);
    if (!working || reducedMotion) {
      pulse.value = 1;
      return;
    }
    pulse.value = withRepeat(
      withSequence(
        withTiming(1.25, { duration: 600, easing: Easing.inOut(Easing.quad) }),
        withTiming(1, { duration: 600, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(pulse);
  }, [pulse, reducedMotion, working]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));
  return (
    <Animated.View style={style}>
      <Text style={{ color, fontSize: 15, lineHeight: 18 }}>✦</Text>
    </Animated.View>
  );
}

function Chevron({ expanded, color }: { expanded: boolean; color: string }) {
  return (
    <Text style={{ color, fontSize: 16, lineHeight: 18, marginLeft: -2 }}>
      {expanded ? "⌃" : "⌄"}
    </Text>
  );
}

function TraceRow({
  label,
  detail,
  color,
  active = false,
}: {
  label: string;
  detail?: string;
  color: string;
  active?: boolean;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
      <View
        style={{
          width: active ? 7 : 5,
          height: active ? 7 : 5,
          borderRadius: 99,
          backgroundColor: color,
          opacity: active ? 1 : 0.62,
        }}
      />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={2}
          style={{ color, fontSize: 11.5, lineHeight: 16, fontWeight: active ? "600" : "500" }}
        >
          {label}
        </Text>
        {detail ? (
          <Text numberOfLines={1} style={{ color, fontSize: 10.5, opacity: 0.75, marginTop: 1 }}>
            {detail}
          </Text>
        ) : null}
      </View>
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
          withTiming(0.14, { duration: 470, easing: Easing.inOut(Easing.quad) }),
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
      style={[{ width: 4, height: 4, borderRadius: 1, backgroundColor: color }, animatedStyle]}
    />
  );
}

function WorkingLabel({ label, color }: { label: string; color: string }) {
  const reducedMotion = useReducedMotion();
  const opacity = useSharedValue(0.68);
  const labelRef = useRef(label);
  labelRef.current = label;

  useEffect(() => {
    cancelAnimation(opacity);
    if (reducedMotion) {
      opacity.value = 1;
      return;
    }
    opacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 700, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.58, { duration: 700, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(opacity);
  }, [opacity, reducedMotion]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.Text
      style={[{ color, fontSize: 12.5, lineHeight: 18, fontWeight: "600" }, animatedStyle]}
    >
      {label}
    </Animated.Text>
  );
}

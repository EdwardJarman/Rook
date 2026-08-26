import { useEffect, useId } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Defs, LinearGradient, RadialGradient, Stop } from "react-native-svg";

export type LiveOrbVariant = "white" | "black" | "webgl" | "custom";

export type LiveOrbProps = {
  className?: string;
  size?: number;
  variant?: LiveOrbVariant;
  color?: string;
  eyeColor?: string;
  colors?: string[];
  interactive?: boolean;
  blink?: boolean;
};

export const WHITE = { color: "#F4F4F5", eyeColor: "#09090B" } as const;
export const BLACK = { color: "#18181B", eyeColor: "#F4F4F5" } as const;
export const CUSTOM_DEFAULT = { color: "#7C5CFF", eyeColor: "#FAFAFA" } as const;
export const WEBGL_COLORS = ["#7C6AF7", "#7DD3C7", "#E8B4D4"];

function resolveVariant(variant: LiveOrbVariant, color?: string, eyeColor?: string, colors?: string[]) {
  if (variant === "black") return { body: BLACK.color, eye: BLACK.eyeColor, palette: WEBGL_COLORS };
  if (variant === "webgl") {
    return { body: WHITE.color, eye: eyeColor ?? "#0C0C10", palette: colors?.length ? colors : WEBGL_COLORS };
  }
  if (variant === "custom") {
    return { body: color ?? CUSTOM_DEFAULT.color, eye: eyeColor ?? CUSTOM_DEFAULT.eyeColor, palette: WEBGL_COLORS };
  }
  return { body: WHITE.color, eye: WHITE.eyeColor, palette: WEBGL_COLORS };
}

/**
 * Native counterpart to the web WebGL orb. It uses a light Reanimated surface
 * rather than a GPU canvas, while preserving the two distinct finishes: matte
 * depth and the living Prism color field, plus the web creator's gaze and blink.
 */
export function LiveOrb({
  size = 280,
  variant = "white",
  color,
  eyeColor,
  colors,
  interactive = true,
  blink = true,
}: LiveOrbProps) {
  const id = useId().replace(/:/g, "");
  const sphereId = `sphere-${id}`;
  const prismId = `prism-${id}`;
  const resolved = resolveVariant(variant, color, eyeColor, colors);
  const idle = useSharedValue(0);
  const blinkValue = useSharedValue(0);
  const lookX = useSharedValue(0);
  const lookY = useSharedValue(0);
  const prism = variant === "webgl";
  const orbSize = size * 0.86;
  const eyeWidth = Math.max(4, orbSize * 0.1);
  const eyeHeight = Math.max(10, orbSize * 0.255);

  useEffect(() => {
    idle.value = 0;
    if (!interactive && !prism) return;
    idle.value = withRepeat(
      withTiming(1, { duration: prism ? 5600 : 7200, easing: Easing.linear }),
      -1,
      false,
    );
  }, [idle, interactive, prism]);

  useEffect(() => {
    blinkValue.value = 0;
    if (!blink) return;
    const closeEyes = () => {
      blinkValue.value = withSequence(
        withTiming(1, { duration: 58, easing: Easing.out(Easing.quad) }),
        withDelay(42, withTiming(0, { duration: 86, easing: Easing.in(Easing.quad) })),
      );
    };
    const initial = setTimeout(closeEyes, 1800);
    const timer = setInterval(closeEyes, 3600);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [blink, blinkValue]);

  const orbMotionStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: prism ? Math.sin(idle.value * Math.PI * 2) * -1.4 : 0 }],
  }));
  const prismBloomStyle = useAnimatedStyle(() => ({
    opacity: prism ? interpolate(Math.sin(idle.value * Math.PI * 2), [-1, 1], [0.1, 0.34]) : 0,
    transform: [{ translateX: prism ? Math.cos(idle.value * Math.PI * 2) * orbSize * 0.16 : 0 }],
  }));
  const prismSheenStyle = useAnimatedStyle(() => ({
    opacity: prism ? interpolate(Math.sin(idle.value * Math.PI * 2 + 1.2), [-1, 1], [0.14, 0.44]) : 0.2,
    transform: [{ translateX: prism ? Math.sin(idle.value * Math.PI * 2 + 0.8) * orbSize * 0.055 : 0 }],
  }));
  const eyeMotionStyle = useAnimatedStyle(() => {
    const wanderX = interactive ? Math.sin(idle.value * Math.PI * 2) * orbSize * 0.023 : 0;
    const wanderY = interactive ? Math.cos(idle.value * Math.PI * 2 * 0.72) * orbSize * 0.014 : 0;
    return {
      transform: [
        { translateX: wanderX + lookX.value * orbSize * 0.042 },
        { translateY: wanderY - lookY.value * orbSize * 0.03 },
        { scaleY: 1 - blinkValue.value * 0.92 },
      ],
    };
  });

  const setGaze = (locationX: number, locationY: number) => {
    if (!interactive) return;
    lookX.value = Math.max(-1, Math.min(1, (locationX - size / 2) / (size / 2)));
    lookY.value = Math.max(-1, Math.min(1, (size / 2 - locationY) / (size / 2)));
  };
  const releaseGaze = () => {
    if (!interactive) return;
    lookX.value = withTiming(0, { duration: 360, easing: Easing.out(Easing.quad) });
    lookY.value = withTiming(0.08, { duration: 360, easing: Easing.out(Easing.quad) });
  };

  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel={prism ? "Animated Prism orb character" : "Animated matte orb character"}
      onTouchMove={(event) => setGaze(event.nativeEvent.locationX, event.nativeEvent.locationY)}
      onTouchEnd={releaseGaze}
      onTouchCancel={releaseGaze}
      style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}
    >
      <Animated.View
        style={[
          styles.clip,
          { width: orbSize, height: orbSize, borderRadius: orbSize / 2, backgroundColor: resolved.body },
          orbMotionStyle,
        ]}
      >
        <Svg width="100%" height="100%" viewBox="0 0 100 100">
          <Defs>
            <RadialGradient id={sphereId} cx="34%" cy="26%" rx="70%" ry="70%">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity={variant === "black" ? 0.24 : 0.7} />
              <Stop offset="0.48" stopColor={resolved.body} />
              <Stop offset="1" stopColor="#07080A" stopOpacity={variant === "white" ? 0.22 : 0.5} />
            </RadialGradient>
            <LinearGradient id={prismId} x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={resolved.palette[0] ?? WEBGL_COLORS[0]} />
              <Stop offset="0.52" stopColor={resolved.palette[1] ?? WEBGL_COLORS[1]} />
              <Stop offset="1" stopColor={resolved.palette[2] ?? WEBGL_COLORS[2]} />
            </LinearGradient>
          </Defs>
          <Circle cx="50" cy="50" r="50" fill={prism ? `url(#${prismId})` : `url(#${sphereId})`} />
          <Circle cx="31" cy="23" r="17" fill="#FFFFFF" opacity={variant === "black" ? 0.08 : 0.2} />
        </Svg>
        {prism ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.bloom,
              {
                width: orbSize * 0.54,
                height: orbSize * 0.54,
                borderRadius: orbSize,
                backgroundColor: resolved.palette[1] ?? WEBGL_COLORS[1],
                top: orbSize * 0.11,
                left: orbSize * 0.16,
              },
              prismBloomStyle,
            ]}
          />
        ) : null}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.sheen,
            { width: orbSize * 0.33, height: orbSize * 0.14, borderRadius: orbSize, top: orbSize * 0.12, left: orbSize * 0.22 },
            prismSheenStyle,
          ]}
        />
        <Animated.View
          style={[
            styles.eye,
            { width: eyeWidth, height: eyeHeight, borderRadius: eyeWidth / 2, left: orbSize * 0.315, top: orbSize * 0.355, backgroundColor: resolved.eye },
            eyeMotionStyle,
          ]}
        />
        <Animated.View
          style={[
            styles.eye,
            { width: eyeWidth, height: eyeHeight, borderRadius: eyeWidth / 2, right: orbSize * 0.315, top: orbSize * 0.355, backgroundColor: resolved.eye },
            eyeMotionStyle,
          ]}
        />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  clip: {
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  bloom: {
    position: "absolute",
  },
  sheen: {
    position: "absolute",
    backgroundColor: "#FFFFFF",
  },
  eye: {
    position: "absolute",
  },
});

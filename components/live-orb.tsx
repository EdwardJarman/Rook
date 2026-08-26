import { useEffect, useId } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
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
 * Android counterpart to the web live orb. The iridescent finish uses a small
 * Reanimated color sweep and float rather than WebGL, keeping the mobile bot
 * creator lively without a heavy rendering surface.
 */
export function LiveOrb({
  size = 280,
  variant = "white",
  color,
  eyeColor,
  colors,
  interactive = false,
  blink = false,
}: LiveOrbProps) {
  const id = useId().replace(/:/g, "");
  const sphereId = `sphere-${id}`;
  const webglId = `webgl-${id}`;
  const resolved = resolveVariant(variant, color, eyeColor, colors);
  const motion = useSharedValue(0);
  const isAlive = variant === "webgl" && (interactive || blink);

  useEffect(() => {
    motion.value = 0;
    if (!isAlive) return;
    motion.value = withRepeat(
      withTiming(1, { duration: 3200, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [isAlive, motion]);

  const orbMotionStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: isAlive ? interpolate(motion.value, [0, 1], [-1.5, 1.5]) : 0 },
      { scale: isAlive ? interpolate(motion.value, [0, 1], [0.99, 1.015]) : 1 },
    ],
  }));
  const colorSweepStyle = useAnimatedStyle(() => ({
    opacity: isAlive ? interpolate(motion.value, [0, 1], [0.08, 0.32]) : 0,
    transform: [{ translateX: isAlive ? interpolate(motion.value, [0, 1], [-size * 0.18, size * 0.18]) : 0 }],
  }));
  const highlightStyle = useAnimatedStyle(() => ({
    opacity: isAlive ? interpolate(motion.value, [0, 1], [0.15, 0.45]) : 0.18,
    transform: [{ translateX: isAlive ? interpolate(motion.value, [0, 1], [-size * 0.035, size * 0.035]) : 0 }],
  }));

  const eyeWidth = Math.max(4, size * 0.08);
  const eyeHeight = Math.max(12, size * 0.24);

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={isAlive ? "Animated iridescent orb character" : "Orb character"}
      style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}
    >
      <Animated.View
        style={[
          styles.clip,
          { width: size * 0.86, height: size * 0.86, borderRadius: size, backgroundColor: resolved.body },
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
            <LinearGradient id={webglId} x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={resolved.palette[0] ?? WEBGL_COLORS[0]} />
              <Stop offset="0.52" stopColor={resolved.palette[1] ?? WEBGL_COLORS[1]} />
              <Stop offset="1" stopColor={resolved.palette[2] ?? WEBGL_COLORS[2]} />
            </LinearGradient>
          </Defs>
          <Circle cx="50" cy="50" r="50" fill={variant === "webgl" ? `url(#${webglId})` : `url(#${sphereId})`} />
          <Circle cx="31" cy="23" r="17" fill="#FFFFFF" opacity={variant === "black" ? 0.08 : 0.2} />
        </Svg>
        {variant === "webgl" ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.colorBloom,
              {
                width: size * 0.54,
                height: size * 0.54,
                borderRadius: size,
                backgroundColor: resolved.palette[1] ?? WEBGL_COLORS[1],
                top: size * 0.11,
                left: size * 0.16,
              },
              colorSweepStyle,
            ]}
          />
        ) : null}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.highlight,
            { width: size * 0.32, height: size * 0.14, borderRadius: size, top: size * 0.12, left: size * 0.22 },
            highlightStyle,
          ]}
        />
        <View style={[styles.eye, { width: eyeWidth, height: eyeHeight, borderRadius: eyeWidth / 2, left: size * 0.33, top: size * 0.36, backgroundColor: resolved.eye }]} />
        <View style={[styles.eye, { width: eyeWidth, height: eyeHeight, borderRadius: eyeWidth / 2, right: size * 0.33, top: size * 0.36, backgroundColor: resolved.eye }]} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: {
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  colorBloom: {
    position: "absolute",
  },
  highlight: {
    position: "absolute",
    backgroundColor: "#FFFFFF",
  },
  eye: {
    position: "absolute",
  },
});

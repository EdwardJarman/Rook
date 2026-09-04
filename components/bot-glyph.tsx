import { useId } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from "react-native-svg";

export const BOT_SHAPES = ["orb", "drop", "capsule", "soft-square", "kite", "hex", "cloud"] as const;
export type BotShape = (typeof BOT_SHAPES)[number];

export const BOT_SHAPE_PREFIX = "bot-shape:";
export const DEFAULT_BOT_SHAPE: BotShape = "orb";

export function botShapeIcon(shape: BotShape) {
  return `${BOT_SHAPE_PREFIX}${shape}`;
}

export function getBotShape(icon?: string): BotShape | null {
  if (!icon?.startsWith(BOT_SHAPE_PREFIX)) return null;
  const shape = icon.slice(BOT_SHAPE_PREFIX.length) as BotShape;
  return BOT_SHAPES.includes(shape) ? shape : null;
}

function ShapePath({ shape, fill }: { shape: BotShape; fill: string }) {
  if (shape === "drop") {
    return <Path d="M27 5C37 17 44 26 44 36c0 11-8 19-20 19S4 47 4 36C4 25 13 14 27 5Z" fill={fill} />;
  }
  if (shape === "capsule") {
    return <Rect x="4" y="14" width="48" height="34" rx="17" fill={fill} />;
  }
  if (shape === "soft-square") {
    return <Path d="M10 7c8-4 28-4 36 1 6 5 7 30 1 38-6 8-31 8-39 1-7-7-6-33 2-40Z" fill={fill} />;
  }
  if (shape === "kite") {
    return <Path d="M28 4c6 0 22 18 22 30 0 11-9 19-22 19S6 45 6 34C6 22 22 4 28 4Z" fill={fill} />;
  }
  if (shape === "hex") {
    return <Path d="M18 5h20l14 14v20L38 53H18L4 39V19L18 5Z" fill={fill} />;
  }
  if (shape === "cloud") {
    return <Path d="M15 49C8 49 3 44 3 37c0-6 4-11 10-12 1-10 8-17 18-17 9 0 16 6 18 14 5 2 8 7 8 13 0 8-6 14-14 14H15Z" fill={fill} />;
  }
  return <Path d="M29 4c15 0 24 8 24 23S44 52 29 52 4 43 4 28 14 4 29 4Z" fill={fill} />;
}

export function BotGlyph({ shape, color, size = 56, showEyes = true }: { shape: BotShape; color: string; size?: number; showEyes?: boolean }) {
  const gradientId = `rook-bot-${useId()}`;
  const eyeHeight = shape === "capsule" ? 11 : 12;
  const eyeY = shape === "drop" ? 29 : 23;

  return (
    <View style={[styles.frame, { width: size, height: size }]} accessibilityElementsHidden>
      <Svg width={size} height={size} viewBox="0 0 56 56">
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity="1" />
            <Stop offset="1" stopColor={color} stopOpacity="0.78" />
          </LinearGradient>
        </Defs>
        <ShapePath shape={shape} fill={`url(#${gradientId})`} />
        {showEyes ? (
          <>
            <Rect x="20" y={eyeY} width="4.5" height={eyeHeight} rx="2.25" fill="rgba(255,255,255,0.92)" transform="rotate(-5 22 28)" />
            <Rect x="31.5" y={eyeY - 0.8} width="4.5" height={eyeHeight} rx="2.25" fill="rgba(255,255,255,0.92)" transform="rotate(5 34 28)" />
          </>
        ) : null}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignItems: "center",
    justifyContent: "center",
  },
});

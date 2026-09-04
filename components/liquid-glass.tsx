import { BlurView } from "expo-blur";
import { useId, type ReactNode } from "react";
import { Platform, StyleSheet, View, type ViewStyle } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { useRookTheme } from "@/lib/ui";

/**
 * Apple-style liquid glass.
 *
 * Real glass is not a translucent rectangle — it is a stack: a blurred,
 * saturation-lifted refraction of whatever sits behind it, a diagonal specular
 * sheen, a bright rim where light catches the top edge, a darker rim where the
 * bottom edge shades, and a soft ambient shadow that lifts the whole slab off
 * the canvas. These primitives compose those layers in that order so the result
 * reads as one continuous piece of glass rather than a frosted panel.
 *
 * Everything is platform-safe: `expo-blur` handles native, and web gets an
 * explicit `backdropFilter` with a saturation lift (the part that makes glass
 * look wet rather than milky).
 */

type GlassTone = {
  /** Translucent body fill layered over the blur. */
  fill: string;
  /** Bright specular rim along the top edge. */
  rimLight: string;
  /** Shaded rim along the bottom edge. */
  rimShade: string;
  /** Diagonal sheen stops, brightest to invisible. */
  sheenTop: string;
  sheenMid: string;
  sheenBottom: string;
  /** Ambient + contact shadow colors. */
  ambient: string;
  contact: string;
};

const LIGHT_GLASS: GlassTone = {
  fill: "rgba(255, 255, 255, 0.56)",
  rimLight: "rgba(255, 255, 255, 0.92)",
  rimShade: "rgba(23, 26, 32, 0.07)",
  sheenTop: "rgba(255, 255, 255, 0.72)",
  sheenMid: "rgba(255, 255, 255, 0.06)",
  sheenBottom: "rgba(255, 255, 255, 0.28)",
  ambient: "rgba(38, 44, 54, 0.14)",
  contact: "rgba(38, 44, 54, 0.06)",
};

const DARK_GLASS: GlassTone = {
  fill: "rgba(16, 20, 27, 0.58)",
  rimLight: "rgba(255, 255, 255, 0.24)",
  rimShade: "rgba(0, 0, 0, 0.34)",
  sheenTop: "rgba(255, 255, 255, 0.20)",
  sheenMid: "rgba(255, 255, 255, 0.03)",
  sheenBottom: "rgba(255, 255, 255, 0.08)",
  ambient: "rgba(0, 0, 0, 0.46)",
  contact: "rgba(0, 0, 0, 0.28)",
};

export function useGlassTone(): GlassTone & { dark: boolean } {
  const { dark } = useRookTheme();
  return { ...(dark ? DARK_GLASS : LIGHT_GLASS), dark };
}

/** Web-only refraction: blur plus the saturation lift that reads as glass. */
function webRefraction(blur: number, dark: boolean): ViewStyle {
  if (Platform.OS !== "web") return {};
  return {
    backdropFilter: `blur(${blur}px) saturate(${dark ? 150 : 185}%)`,
    WebkitBackdropFilter: `blur(${blur}px) saturate(${dark ? 150 : 185}%)`,
  } as unknown as ViewStyle;
}

/**
 * The diagonal specular sheen. Bright at the top-left shoulder, invisible
 * through the body, faintly returning at the bottom so the slab has thickness.
 */
function Sheen({ radius }: { radius: number }) {
  const tone = useGlassTone();
  const gradientId = `glass-sheen-${useId()}`;
  return (
    <Svg pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Defs>
        <LinearGradient id={gradientId} x1="0%" y1="0%" x2="72%" y2="100%">
          <Stop offset="0" stopColor={tone.sheenTop} />
          <Stop offset="0.42" stopColor={tone.sheenMid} />
          <Stop offset="1" stopColor={tone.sheenBottom} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" rx={radius} ry={radius} fill={`url(#${gradientId})`} />
    </Svg>
  );
}

export type GlassSurfaceProps = {
  children?: ReactNode;
  /** Corner radius; the sheen and both rims follow it exactly. */
  radius?: number;
  /** Blur strength. 28–40 for panels, 18–24 for chips. */
  blur?: number;
  /** Outer frame style (position, size, margins). */
  style?: ViewStyle | ViewStyle[];
  /** Inner content padding and layout. */
  contentStyle?: ViewStyle | ViewStyle[];
  /** Drop the ambient shadow for glass that sits inside other glass. */
  flat?: boolean;
};

/**
 * A slab of liquid glass. Layer order, back to front: ambient shadow, blurred
 * refraction, translucent fill, specular sheen, shaded bottom rim, bright top
 * rim, content.
 */
export function GlassSurface({
  children,
  radius = 24,
  blur = 32,
  style,
  contentStyle,
  flat = false,
}: GlassSurfaceProps) {
  const tone = useGlassTone();

  return (
    <View
      style={[
        { borderRadius: radius },
        !flat && {
          // Two shadows: a wide ambient lift and a tight contact shadow.
          boxShadow: `0 18px 44px ${tone.ambient}, 0 2px 8px ${tone.contact}`,
        },
        style as ViewStyle,
      ]}
    >
      <View style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: "hidden" }]} pointerEvents="none">
        <BlurView
          intensity={tone.dark ? 58 : 74}
          tint={tone.dark ? "systemUltraThinMaterialDark" : "systemUltraThinMaterialLight"}
          experimentalBlurMethod="dimezisBlurView"
          blurReductionFactor={3}
          style={[StyleSheet.absoluteFill, webRefraction(blur, tone.dark)]}
        />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: tone.fill }]} />
        <Sheen radius={radius} />
      </View>

      {/* Bottom shade rim first, bright top rim over it — light comes from above. */}
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { borderRadius: radius, borderWidth: StyleSheet.hairlineWidth, borderColor: tone.rimShade },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            borderRadius: radius,
            borderTopWidth: 1,
            borderLeftWidth: StyleSheet.hairlineWidth,
            borderRightWidth: StyleSheet.hairlineWidth,
            borderColor: tone.rimLight,
            borderBottomColor: "transparent",
          },
        ]}
      />

      <View style={[{ flex: 1 }, contentStyle as ViewStyle]}>{children}</View>
    </View>
  );
}

/**
 * A small capsule of the same glass, tuned for chips and pills: lighter blur,
 * no ambient shadow by default so rows of them stay quiet.
 */
export function GlassChip({
  children,
  radius = 999,
  blur = 20,
  style,
  contentStyle,
  raised = false,
}: Omit<GlassSurfaceProps, "flat"> & { raised?: boolean }) {
  return (
    <GlassSurface radius={radius} blur={blur} flat={!raised} style={style} contentStyle={contentStyle}>
      {children}
    </GlassSurface>
  );
}

/**
 * The soft, low-saturation wash that sits *behind* glass so there is something
 * for it to refract. Without this, glass over a flat white canvas looks like
 * plain translucency.
 */
export function GlassBackdrop({ style }: { style?: ViewStyle | ViewStyle[] }) {
  const { dark } = useRookTheme();
  const gradientId = `glass-backdrop-${useId()}`;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, style as ViewStyle]}>
      <Svg style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0" stopColor={dark ? "#141A24" : "#EFF1F5"} />
            <Stop offset="0.55" stopColor={dark ? "#0C1017" : "#F7F7F4"} />
            <Stop offset="1" stopColor={dark ? "#101720" : "#ECEFEA"} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId})`} />
      </Svg>
    </View>
  );
}

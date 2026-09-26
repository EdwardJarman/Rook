import { Image } from "react-native";

import { useRookTheme } from "@/lib/ui";

const rookLogo = require("@/assets/images/rook-logo.png");

export function RookLogo({ size = 32, color }: { size?: number; color?: string }) {
  const { colors } = useRookTheme();

  return (
    <Image
      accessibilityRole="image"
      accessibilityLabel="Rook"
      source={rookLogo}
      resizeMode="contain"
      style={{ width: size, height: size, tintColor: color ?? colors.text }}
    />
  );
}

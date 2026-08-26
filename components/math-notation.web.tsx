import { Text } from "react-native";

import { mathFallbackText } from "@/lib/math-notation";

export function MathNotation({
  latex,
  color,
  fontSize,
}: {
  latex: string;
  color: string;
  fontSize: number;
  display?: boolean;
}) {
  return (
    <Text style={{ color, fontSize, lineHeight: fontSize * 1.38, fontFamily: "serif" }}>
      {mathFallbackText(latex)}
    </Text>
  );
}

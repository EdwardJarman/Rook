import { Text, View } from "react-native";

import { mathFallbackText } from "@/lib/math-notation";

/**
 * Web-native mathematical surface. The parser supplies clean LaTeX fragments;
 * common notation is rendered as readable mathematical Unicode without exposing
 * delimiters such as `\[` or `\]` in the conversation.
 */
export function MathNotation({
  latex,
  color,
  fontSize,
  display = false,
}: {
  latex: string;
  color: string;
  fontSize: number;
  display?: boolean;
}) {
  const value = mathFallbackText(latex);
  if (!display) {
    return (
      <Text
        accessibilityLabel={`Formula: ${value}`}
        style={{
          color,
          fontSize,
          lineHeight: fontSize * 1.42,
          fontFamily: "serif",
        }}
      >
        {value}
      </Text>
    );
  }

  return (
    <View
      accessibilityLabel={`Formula: ${value}`}
      style={{
        alignSelf: "stretch",
        marginVertical: 3,
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderLeftWidth: 2,
        borderLeftColor: color,
        backgroundColor: "rgba(127, 127, 127, 0.08)",
      }}
    >
      <Text
        style={{
          color,
          fontSize: fontSize + 2,
          lineHeight: (fontSize + 2) * 1.48,
          fontFamily: "serif",
          letterSpacing: 0.1,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

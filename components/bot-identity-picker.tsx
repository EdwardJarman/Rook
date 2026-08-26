import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  BOT_ORB_MATERIALS,
  BotOrb,
  DEFAULT_BOT_ORB_ICON,
  DEFAULT_BOT_ORB_MATERIAL,
  botOrbIcon,
  getBotOrbMaterial,
  type BotOrbMaterial,
} from "@/components/bot-orb";
import { tint, useRookTheme } from "@/lib/ui";

export const BOT_COLORS = [
  "#111318",
  "#A66D3B",
  "#F04455",
  "#F97316",
  "#F5AA32",
  "#23B26D",
  "#2AA9A1",
  "#3B82F6",
  "#7C5CFC",
  "#EC5EA8",
  "#707784",
] as const;

export const DEFAULT_BOT_COLOR = "#23B26D";
export const DEFAULT_BOT_ICON = DEFAULT_BOT_ORB_ICON;

const MATERIAL_LABELS: Record<
  BotOrbMaterial,
  { title: string; detail: string }
> = {
  matte: { title: "Matte", detail: "Quiet depth" },
  iridescent: { title: "Prism", detail: "Living color" },
};

export function BotIdentityPicker({
  color,
  icon,
  onColorChange,
  onIconChange,
  showPreview = true,
}: {
  color: string;
  icon: string;
  onColorChange: (color: string) => void;
  onIconChange: (icon: string) => void;
  showPreview?: boolean;
}) {
  const { colors, dark } = useRookTheme();
  const material = getBotOrbMaterial(icon) ?? DEFAULT_BOT_ORB_MATERIAL;

  return (
    <View style={styles.wrap}>
      {showPreview ? (
        <View style={styles.previewWrap}>
          <BotOrb
            color={color}
            material={material}
            size={136}
            interactive
            blink
          />
        </View>
      ) : null}

      <View style={styles.group}>
        <Text style={[styles.label, { color: colors.textSoft }]}>COLOR</Text>
        <View accessibilityRole="radiogroup" style={styles.options}>
          {BOT_COLORS.map((option) => {
            const selected = color === option;
            return (
              <Pressable
                key={option}
                accessibilityRole="radio"
                accessibilityLabel={`Choose Bot color ${option}`}
                accessibilityState={{ checked: selected }}
                onPress={() => onColorChange(option)}
                style={({ pressed }) => [
                  styles.colorOption,
                  {
                    borderColor: selected ? colors.text : "transparent",
                    backgroundColor: selected
                      ? colors.surfaceAlt
                      : "transparent",
                    opacity: pressed ? 0.68 : 1,
                    transform: [{ scale: pressed ? 0.94 : 1 }],
                  },
                ]}
              >
                <View style={[styles.colorDot, { backgroundColor: option }]} />
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.group}>
        <Text style={[styles.label, { color: colors.textSoft }]}>FINISH</Text>
        <View accessibilityRole="radiogroup" style={styles.materials}>
          {BOT_ORB_MATERIALS.map((option) => {
            const selected = material === option;
            const copy = MATERIAL_LABELS[option];
            return (
              <Pressable
                key={option}
                accessibilityRole="radio"
                accessibilityLabel={`${copy.title} orb finish: ${copy.detail}`}
                accessibilityState={{ checked: selected }}
                onPress={() => onIconChange(botOrbIcon(option))}
                style={({ pressed }) => [
                  styles.materialOption,
                  {
                    borderColor: selected ? color : colors.line,
                    backgroundColor: selected
                      ? tint(color, dark ? 0.2 : 0.09)
                      : colors.surfaceAlt,
                    opacity: pressed ? 0.72 : 1,
                    transform: [{ scale: pressed ? 0.98 : 1 }],
                  },
                ]}
              >
                <BotOrb
                  color={color}
                  material={option}
                  size={54}
                  interactive={false}
                  blink
                />
                <View style={styles.materialCopy}>
                  <Text style={[styles.materialTitle, { color: colors.text }]}>
                    {copy.title}
                  </Text>
                  <Text
                    style={[styles.materialDetail, { color: colors.textFaint }]}
                  >
                    {copy.detail}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 20,
  },
  previewWrap: {
    height: 150,
    alignItems: "center",
    justifyContent: "center",
  },
  group: {
    gap: 10,
  },
  label: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.45,
  },
  options: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
  },
  colorOption: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  colorDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.55)",
  },
  materials: {
    flexDirection: "row",
    gap: 10,
  },
  materialOption: {
    flex: 1,
    minHeight: 88,
    borderRadius: 18,
    borderWidth: 1.5,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  materialCopy: {
    flex: 1,
  },
  materialTitle: {
    fontSize: 16,
    lineHeight: 19,
    fontWeight: "700",
    letterSpacing: -0.25,
  },
  materialDetail: {
    fontSize: 12.5,
    lineHeight: 16,
    marginTop: 2,
  },
});

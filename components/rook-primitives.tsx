import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { type ComponentProps, type ReactNode, useMemo } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type DimensionValue,
  type TextInputProps,
  type ViewStyle,
  View,
} from "react-native";

import { getBotShape } from "@/components/bot-glyph";
import { BotIdentityMark, getBotOrbMaterial } from "@/components/bot-orb";
import {
  shade,
  tint,
  useRookTheme,
  type RookTokens,
  type ToneName,
} from "@/lib/ui";

export { useRookTheme } from "@/lib/ui";
export type { RookTokens, ToneName } from "@/lib/ui";

type IconName = ComponentProps<typeof MaterialIcons>["name"];
const materialGlyphMap =
  (MaterialIcons as unknown as { glyphMap?: Record<string, unknown> })
    .glyphMap ?? {};

/** Map a semantic tone to concrete colors for the active scheme. */
export function toneColors(tokens: RookTokens, tone: ToneName) {
  if (tone === "amber") return { fg: tokens.amber, bg: tokens.amberSoft };
  if (tone === "coral") return { fg: tokens.coral, bg: tokens.coralSoft };
  if (tone === "muted") return { fg: tokens.textSoft, bg: tokens.surfaceAlt };
  return { fg: tokens.mint, bg: tokens.mintSoft };
}

/* ------------------------------------------------------------------ */
/* Identity                                                            */
/* ------------------------------------------------------------------ */

/**
 * A soft-tinted squircle avatar. Bot identity colors read as quiet washes
 * with a colored glyph instead of loud saturated fills.
 */
export function Avatar({
  label,
  color = "#0E7C59",
  size = 40,
  icon,
}: {
  label: string;
  color?: string;
  size?: number;
  icon?: string;
}) {
  const { dark } = useRookTheme();
  const shape = getBotShape(icon);
  const orbMaterial = getBotOrbMaterial(icon);
  const customIdentity = Boolean(shape || orbMaterial);
  const supportedMaterialIcon = Boolean(icon && materialGlyphMap[icon]);
  const glyph = dark ? shade(color, -0.28) : color;
  const style = useMemo(
    () => ({
      width: size,
      height: size,
      borderRadius: size * 0.32,
      backgroundColor: tint(color, dark ? 0.24 : 0.13),
      borderColor: tint(color, dark ? 0.4 : 0.26),
      borderWidth: 1,
    }),
    [color, dark, size],
  );

  return (
    <View
      style={
        customIdentity
          ? {
              width: size,
              height: size,
              alignItems: "center",
              justifyContent: "center",
            }
          : style
      }
      accessibilityElementsHidden
    >
      {customIdentity ? (
        <BotIdentityMark icon={icon} color={color} size={size} />
      ) : supportedMaterialIcon ? (
        <MaterialIcons
          name={icon as IconName}
          size={Math.max(14, Math.round(size * 0.46))}
          color={glyph}
        />
      ) : (
        <Text
          style={{
            color: glyph,
            fontSize: Math.max(11, Math.round(size * 0.38)),
            fontWeight: "700",
            letterSpacing: -0.2,
          }}
        >
          {label.slice(0, 1).toUpperCase()}
        </Text>
      )}
    </View>
  );
}

export function StatusPill({
  label,
  tone = "mint",
}: {
  label: string;
  tone?: ToneName;
}) {
  const { colors } = useRookTheme();
  const toneColor = toneColors(colors, tone);
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        backgroundColor: toneColor.bg,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 4,
        alignSelf: "flex-start",
      }}
    >
      <View
        style={{
          width: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: toneColor.fg,
        }}
      />
      <Text
        style={{
          color: toneColor.fg,
          fontSize: 11.5,
          fontWeight: "600",
          letterSpacing: 0.05,
        }}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

const pressedFn = (pressed: boolean) =>
  pressed
    ? { opacity: 0.72, transform: [{ scale: 0.985 }] as const }
    : undefined;

export function PrimaryButton({
  label,
  onPress,
  icon,
  disabled,
  destructive,
}: {
  label: string;
  onPress: () => void;
  icon?: IconName;
  disabled?: boolean;
  destructive?: boolean;
}) {
  const { colors } = useRookTheme();
  const fill = destructive ? colors.coral : colors.ink;
  const foreground = destructive ? "#FFFFFF" : colors.onInk;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        {
          minHeight: 48,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          borderRadius: 16,
          backgroundColor: fill,
          paddingHorizontal: 20,
          paddingVertical: 13,
          opacity: disabled ? 0.45 : 1,
        },
        pressedFn(pressed),
      ]}
    >
      {icon ? <MaterialIcons name={icon} size={18} color={foreground} /> : null}
      <Text
        style={{
          color: foreground,
          fontSize: 15,
          fontWeight: "600",
          letterSpacing: -0.1,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function SecondaryButton({
  label,
  onPress,
  icon,
  destructive,
}: {
  label: string;
  onPress: () => void;
  icon?: IconName;
  destructive?: boolean;
}) {
  const { colors } = useRookTheme();
  const foreground = destructive ? colors.coral : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: 48,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: destructive
            ? tint(colors.coral, 0.35)
            : colors.lineStrong,
          backgroundColor: colors.surface,
          paddingHorizontal: 20,
          paddingVertical: 13,
        },
        pressedFn(pressed),
      ]}
    >
      {icon ? <MaterialIcons name={icon} size={18} color={foreground} /> : null}
      <Text style={{ color: foreground, fontSize: 15, fontWeight: "600" }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function IconButton({
  icon,
  label,
  onPress,
  tone = "default",
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  tone?: "default" | "accent" | "danger";
}) {
  const { colors } = useRookTheme();
  const color =
    tone === "accent"
      ? colors.accent
      : tone === "danger"
        ? colors.coral
        : colors.textSoft;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        {
          width: 40,
          height: 40,
          borderRadius: 14,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1,
          borderColor: colors.line,
          backgroundColor: colors.surface,
        },
        pressedFn(pressed),
      ]}
    >
      <MaterialIcons name={icon} size={20} color={color} />
    </Pressable>
  );
}

/** A quiet inline text action, used inside headers. */
export function TextAction({
  label,
  onPress,
  tone = "default",
}: {
  label: string;
  onPress: () => void;
  tone?: "default" | "accent" | "danger";
}) {
  const { colors } = useRookTheme();
  const color =
    tone === "accent"
      ? colors.accent
      : tone === "danger"
        ? colors.coral
        : colors.textSoft;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 12 },
        pressedFn(pressed),
      ]}
    >
      <Text style={{ color, fontSize: 13.5, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

/** Large screen header shared by every tab: title, optional lead, action. */
export function ScreenHeader({
  title,
  lead,
  action,
}: {
  title: string;
  lead?: string;
  action?: ReactNode;
}) {
  const { colors } = useRookTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 14,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text
          style={{
            color: colors.text,
            fontSize: 27,
            lineHeight: 33,
            fontWeight: "700",
            letterSpacing: -0.7,
          }}
        >
          {title}
        </Text>
        {lead ? (
          <Text
            style={{
              color: colors.textSoft,
              fontSize: 13.5,
              lineHeight: 19,
              marginTop: 4,
              maxWidth: 330,
            }}
          >
            {lead}
          </Text>
        ) : null}
      </View>
      {action}
    </View>
  );
}

export function SectionHeader({
  title,
  caption,
  action,
}: {
  title: string;
  caption?: string;
  action?: ReactNode;
}) {
  const { colors } = useRookTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text
          style={{
            color: colors.text,
            fontSize: 17,
            lineHeight: 23,
            fontWeight: "600",
            letterSpacing: -0.3,
          }}
        >
          {title}
        </Text>
        {caption ? (
          <Text
            style={{
              color: colors.textFaint,
              fontSize: 12.5,
              lineHeight: 17,
              marginTop: 2,
            }}
          >
            {caption}
          </Text>
        ) : null}
      </View>
      {action}
    </View>
  );
}

export function Card({
  children,
  style,
}: {
  children: ReactNode;
  style?: object;
}) {
  const { colors } = useRookTheme();
  return (
    <View
      style={[
        {
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.line,
          borderRadius: 18,
          padding: 16,
          gap: 10,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  detail,
  action,
}: {
  icon: IconName;
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  const { colors } = useRookTheme();
  return (
    <View
      style={{
        alignItems: "center",
        paddingVertical: 34,
        paddingHorizontal: 26,
        gap: 8,
      }}
    >
      <View
        style={{
          width: 50,
          height: 50,
          borderRadius: 17,
          backgroundColor: colors.surfaceAlt,
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 4,
        }}
      >
        <MaterialIcons name={icon} size={23} color={colors.textFaint} />
      </View>
      <Text
        style={{
          color: colors.text,
          fontSize: 15.5,
          fontWeight: "600",
          textAlign: "center",
          letterSpacing: -0.2,
        }}
      >
        {title}
      </Text>
      <Text
        style={{
          color: colors.textSoft,
          fontSize: 13,
          lineHeight: 19,
          textAlign: "center",
          maxWidth: 290,
        }}
      >
        {detail}
      </Text>
      {action ? <View style={{ marginTop: 10 }}>{action}</View> : null}
    </View>
  );
}

export function Divider() {
  const { colors } = useRookTheme();
  return (
    <View
      style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.line }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

export function Field({
  label,
  hint,
  multiline,
  style,
  ...props
}: TextInputProps & {
  label: string;
  hint?: string;
  multiline?: boolean;
  style?: object;
}) {
  const { colors } = useRookTheme();
  return (
    <View style={{ gap: 7 }}>
      <Text
        style={{
          color: colors.textSoft,
          fontSize: 12.5,
          fontWeight: "600",
          letterSpacing: 0.1,
        }}
      >
        {label}
      </Text>
      <TextInput
        placeholderTextColor={colors.placeholder}
        multiline={multiline}
        {...props}
        style={[
          {
            color: colors.text,
            backgroundColor: colors.surfaceAlt,
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: 14,
            paddingHorizontal: 14,
            paddingVertical: 12,
            fontSize: 15,
          },
          multiline && { minHeight: 96, textAlignVertical: "top" },
          style,
        ]}
      />
      {hint ? (
        <Text style={{ color: colors.textFaint, fontSize: 12, lineHeight: 17 }}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/** An iOS-style switch built from primitives so it matches on every platform. */
export function Switch({
  checked,
  onToggle,
  accessibilityLabel,
}: {
  checked: boolean;
  onToggle: () => void;
  accessibilityLabel: string;
}) {
  const { colors } = useRookTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked }}
      onPress={onToggle}
      hitSlop={6}
      style={{
        width: 46,
        height: 28,
        borderRadius: 15,
        padding: 3,
        backgroundColor: checked ? colors.accent : colors.lineStrong,
        alignItems: checked ? "flex-end" : "flex-start",
        justifyContent: "center",
      }}
    >
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 12,
          backgroundColor: "#FFFFFF",
          shadowColor: "#000000",
          shadowOpacity: 0.18,
          shadowRadius: 3,
          shadowOffset: { width: 0, height: 1 },
        }}
      />
    </Pressable>
  );
}

/** A segmented pill control with a sliding active indicator. */
export function SegmentedControl<T extends string>({
  options,
  selected,
  onSelect,
  labelFor,
}: {
  options: readonly T[];
  selected: T;
  onSelect: (option: T) => void;
  labelFor?: (option: T) => string;
}) {
  const { colors } = useRookTheme();
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: "row",
        backgroundColor: colors.surfaceAlt,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: 16,
        padding: 3,
        gap: 2,
      }}
    >
      {options.map((option) => {
        const active = option === selected;
        return (
          <Pressable
            key={option}
            accessibilityRole="tab"
            accessibilityLabel={labelFor ? labelFor(option) : option}
            accessibilityState={{ selected: active }}
            onPress={() => onSelect(option)}
            style={{
              flex: 1,
              minHeight: 38,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 13,
              backgroundColor: active ? colors.ink : "transparent",
              paddingHorizontal: 6,
              paddingVertical: 8,
            }}
          >
            <Text
              numberOfLines={1}
              style={{
                color: active ? colors.onInk : colors.textSoft,
                fontSize: 12.5,
                fontWeight: "600",
                letterSpacing: 0.05,
              }}
            >
              {labelFor ? labelFor(option) : option}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Sheets                                                              */
/* ------------------------------------------------------------------ */

/** Shared bottom-sheet chrome: scrim, grabber, rounded surface. */
export function Sheet({
  visible,
  onClose,
  children,
  maxHeight = "88%",
  contentStyle,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  maxHeight?: DimensionValue;
  contentStyle?: ViewStyle;
}) {
  const { colors } = useRookTheme();
  return (
    <Modal
      transparent
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable
        style={{
          flex: 1,
          justifyContent: "flex-end",
          backgroundColor: colors.scrim,
        }}
        onPress={onClose}
      >
        <Pressable
          onPress={(event) => event.stopPropagation()}
          style={[
            {
              backgroundColor: colors.surface,
              borderTopLeftRadius: 26,
              borderTopRightRadius: 26,
              paddingHorizontal: 20,
              paddingBottom: 30,
              paddingTop: 10,
              maxHeight,
              shadowColor: colors.shadow,
              shadowOpacity: 0.2,
              shadowRadius: 30,
              shadowOffset: { width: 0, height: -8 },
            },
            contentStyle,
          ]}
        >
          <View
            accessibilityLabel="Dismiss"
            style={{
              width: 38,
              height: 4,
              borderRadius: 3,
              backgroundColor: colors.grabber,
              alignSelf: "center",
              marginBottom: 14,
            }}
          />
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** The eyebrow label used above sheet titles. */
export function SheetEyebrow({ children }: { children: ReactNode }) {
  const { colors } = useRookTheme();
  return (
    <Text
      style={{
        color: colors.accent,
        fontSize: 11.5,
        fontWeight: "700",
        letterSpacing: 1,
        marginBottom: 5,
        textTransform: "uppercase",
      }}
    >
      {children}
    </Text>
  );
}

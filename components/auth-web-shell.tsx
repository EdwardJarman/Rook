import { type ReactNode, useMemo } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";

import { RookLogo } from "@/components/rook-logo";
import { useRookTheme, type RookTokens } from "@/lib/ui";

export function AuthWebShell({
  eyebrow,
  title,
  detail,
  children,
}: {
  eyebrow: string;
  title: string;
  detail: string;
  children: ReactNode;
}) {
  const { colors } = useRookTheme();
  const { width } = useWindowDimensions();
  const isWide = width >= 980;
  const styles = useMemo(() => buildStyles(colors), [colors]);

  return (
    <View style={styles.page}>
      <View
        style={[
          styles.frame,
          { paddingHorizontal: isWide ? 32 : 20 },
          !isWide && styles.frameCompact,
        ]}
      >
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <View style={styles.brandMark}>
              <RookLogo size={20} color={colors.onInk} />
            </View>
            <Text style={styles.wordmark}>Rook</Text>
          </View>
        </View>

        <View style={[styles.main, isWide && styles.mainWide]}>
          <View style={[styles.intro, isWide && styles.introWide]}>
            <View style={styles.eyebrowPill}>
              <View style={styles.eyebrowDot} />
              <Text style={styles.eyebrow}>{eyebrow}</Text>
            </View>
            <Text style={[styles.title, isWide && styles.titleWide]}>
              {title}
            </Text>
            <Text style={styles.detail}>{detail}</Text>
          </View>

          <View style={[styles.formColumn, isWide && styles.formColumnWide]}>
            <View style={styles.clerkSlot}>{children}</View>
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            © {new Date().getFullYear()} Rook
          </Text>
          <Text style={styles.footerText}>Built for deliberate work</Text>
        </View>
      </View>
    </View>
  );
}

function buildStyles(colors: RookTokens) {
  return StyleSheet.create({
    page: {
      flex: 1,
      minHeight: "100%",
      backgroundColor: colors.canvas,
    },
    frame: {
      flex: 1,
      width: "100%",
      maxWidth: 1180,
      minHeight: "100%",
      alignSelf: "center",
      paddingTop: 20,
      paddingBottom: 28,
    },
    frameCompact: {
      minHeight: 760,
    },
    header: {
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
    },
    brandRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    brandMark: {
      width: 32,
      height: 32,
      borderRadius: 11,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.ink,
    },
    wordmark: {
      color: colors.text,
      fontSize: 15,
      fontWeight: "800",
      letterSpacing: -0.4,
    },
    main: {
      flex: 1,
      paddingTop: 40,
      paddingBottom: 40,
    },
    mainWide: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 72,
      paddingTop: 72,
      paddingBottom: 72,
    },
    intro: {
      maxWidth: 520,
    },
    introWide: {
      flex: 1,
    },
    eyebrowPill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      alignSelf: "flex-start",
      backgroundColor: colors.surfaceAlt,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    eyebrowDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.accent,
    },
    eyebrow: {
      color: colors.textSoft,
      fontSize: 11.5,
      fontWeight: "700",
      letterSpacing: 0.3,
    },
    title: {
      color: colors.text,
      fontSize: 38,
      lineHeight: 42,
      fontWeight: "800",
      letterSpacing: -1.2,
      marginTop: 22,
      maxWidth: 480,
    },
    titleWide: {
      fontSize: 50,
      lineHeight: 52,
      letterSpacing: -1.8,
      maxWidth: 520,
    },
    detail: {
      color: colors.textSoft,
      fontSize: 15.5,
      lineHeight: 24,
      marginTop: 18,
      maxWidth: 420,
    },
    formColumn: {
      width: "100%",
      maxWidth: 420,
      marginTop: 36,
    },
    formColumnWide: {
      marginTop: 0,
    },
    clerkSlot: {
      width: "100%",
      alignItems: "stretch",
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: 24,
      padding: 20,
      shadowColor: colors.shadow,
      shadowOpacity: 0.06,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 10 },
    },
    footer: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 20,
      borderTopWidth: 1,
      borderTopColor: colors.line,
      paddingTop: 16,
    },
    footerText: {
      color: colors.textFaint,
      fontSize: 11.5,
    },
  });
}

import { type ReactNode } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";

import { RookLogo } from "@/components/rook-logo";

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
  const { width } = useWindowDimensions();
  const isWide = width >= 980;

  return (
    <View style={styles.page}>
      <View
        style={[
          styles.frame,
          { paddingHorizontal: isWide ? 42 : 20 },
          !isWide && styles.frameCompact,
        ]}
      >
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <View style={styles.brandMark}>
              <RookLogo size={20} color="#090909" />
            </View>
            <Text style={styles.wordmark}>ROOK</Text>
          </View>
          <Text style={styles.headerLabel}>SECURE WORKROOM ACCESS</Text>
        </View>

        <View style={[styles.main, isWide && styles.mainWide]}>
          <View style={[styles.intro, isWide && styles.introWide]}>
            <View style={styles.eyebrowRow}>
              <View style={styles.eyebrowMark} />
              <Text style={styles.eyebrow}>{eyebrow}</Text>
            </View>
            <Text style={[styles.title, isWide && styles.titleWide]}>
              {title}
            </Text>
            <Text style={styles.detail}>{detail}</Text>

            {isWide ? (
              <View style={styles.editorialNote}>
                <Text style={styles.noteIndex}>01</Text>
                <Text style={styles.noteText}>
                  Your account is the control point for every Rook workspace.
                </Text>
              </View>
            ) : null}
          </View>

          <View style={[styles.formColumn, isWide && styles.formColumnWide]}>
            <View style={styles.formKicker}>
              <Text style={styles.formKickerLabel}>IDENTITY CHECK</Text>
              <Text style={styles.formKickerDetail}>
                Choose a secure method
              </Text>
            </View>
            <View style={styles.clerkSlot}>{children}</View>
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            © {new Date().getFullYear()} ROOK
          </Text>
          <Text style={styles.footerText}>BUILT FOR DELIBERATE WORK</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    minHeight: "100%",
    backgroundColor: "#080808",
  },
  frame: {
    flex: 1,
    width: "100%",
    maxWidth: 1440,
    minHeight: "100%",
    alignSelf: "center",
    paddingTop: 22,
    paddingBottom: 28,
  },
  frameCompact: {
    minHeight: 760,
  },
  header: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "#35342F",
    paddingBottom: 16,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  brandMark: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F1F0EB",
  },
  wordmark: {
    color: "#F1F0EB",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  headerLabel: {
    color: "#77756E",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  main: {
    flex: 1,
    paddingTop: 56,
    paddingBottom: 56,
  },
  mainWide: {
    flexDirection: "row",
    alignItems: "stretch",
    justifyContent: "space-between",
    gap: 76,
    paddingTop: 104,
    paddingBottom: 84,
  },
  intro: {
    maxWidth: 590,
  },
  introWide: {
    flex: 1,
    paddingTop: 24,
  },
  eyebrowRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  eyebrowMark: {
    width: 7,
    height: 7,
    backgroundColor: "#F1F0EB",
  },
  eyebrow: {
    color: "#ABA9A2",
    fontSize: 10.5,
    fontWeight: "800",
    letterSpacing: 1.7,
  },
  title: {
    color: "#F1F0EB",
    fontSize: 47,
    lineHeight: 47,
    fontWeight: "700",
    letterSpacing: -3.15,
    marginTop: 27,
    maxWidth: 560,
  },
  titleWide: {
    fontSize: 66,
    lineHeight: 64,
    letterSpacing: -4.6,
    maxWidth: 600,
  },
  detail: {
    color: "#C9C7C0",
    fontSize: 16,
    lineHeight: 25,
    marginTop: 25,
    maxWidth: 452,
  },
  editorialNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 18,
    width: "100%",
    maxWidth: 430,
    borderTopWidth: 1,
    borderTopColor: "#35342F",
    marginTop: 78,
    paddingTop: 17,
  },
  noteIndex: {
    color: "#8F8D86",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.4,
  },
  noteText: {
    flex: 1,
    color: "#99978F",
    fontSize: 12,
    lineHeight: 18,
  },
  formColumn: {
    width: "100%",
    maxWidth: 448,
    marginTop: 48,
  },
  formColumnWide: {
    marginTop: 0,
    paddingTop: 0,
  },
  formKicker: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "#35342F",
    paddingTop: 16,
    paddingBottom: 16,
  },
  formKickerLabel: {
    color: "#F1F0EB",
    fontSize: 10.5,
    fontWeight: "900",
    letterSpacing: 1.35,
  },
  formKickerDetail: {
    color: "#85837C",
    fontSize: 11.5,
  },
  clerkSlot: {
    width: "100%",
    alignItems: "stretch",
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 20,
    borderTopWidth: 1,
    borderTopColor: "#35342F",
    paddingTop: 17,
  },
  footerText: {
    color: "#737169",
    fontSize: 10.5,
    letterSpacing: 0.3,
  },
});

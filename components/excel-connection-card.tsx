import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { Card, StatusPill } from "@/components/rook-primitives";
import { trpc } from "@/lib/trpc";
import { tint, useRookTheme } from "@/lib/ui";

const excelGreen = "#107C41";

const formatDate = (value: string | null) => {
  if (!value) return "Recently updated";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Recently updated" : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

export function ExcelConnectionCard() {
  const { colors } = useRookTheme();
  const utils = trpc.useUtils();
  const status = trpc.excel.status.useQuery(undefined, { retry: 1 });
  const authorize = trpc.excel.authorizationUrl.useMutation();
  const disconnect = trpc.excel.disconnect.useMutation();
  const workbooks = trpc.excel.workbooks.useQuery(undefined, {
    enabled: status.data?.connected === true,
    retry: 1,
  });
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<{ id: string; driveId: string; name: string; webUrl: string | null } | null>(null);
  const [range, setRange] = useState("A1:F12");
  const [requestedRange, setRequestedRange] = useState("A1:F12");

  const structure = trpc.excel.workbookStructure.useQuery(
    { driveId: selected?.driveId ?? "", itemId: selected?.id ?? "" },
    { enabled: Boolean(selected), retry: 1 },
  );
  const worksheet = structure.data?.worksheets[0]?.name ?? "";
  const preview = trpc.excel.readRange.useQuery(
    { driveId: selected?.driveId ?? "", itemId: selected?.id ?? "", worksheet, address: requestedRange },
    { enabled: Boolean(selected && worksheet), retry: false },
  );

  useEffect(() => {
    if (!status.data?.connected) {
      setExpanded(false);
      setSelected(null);
    }
  }, [status.data?.connected]);

  const returnTo = useMemo(() => {
    if (Platform.OS === "web" && typeof window !== "undefined") return `${window.location.origin}/account`;
    // Let Expo resolve the configured application scheme. A hard-coded scheme
    // breaks Android OAuth returns whenever the production package changes.
    return Linking.createURL("/account");
  }, []);

  const connectMicrosoft = async () => {
    try {
      const url = await authorize.mutateAsync({ returnTo });
      if (Platform.OS === "web") {
        window.location.assign(url);
        return;
      }
      await WebBrowser.openAuthSessionAsync(url, returnTo);
      await Promise.all([utils.excel.status.invalidate(), utils.excel.workbooks.invalidate()]);
    } catch (error) {
      Alert.alert(
        "Microsoft Excel unavailable",
        error instanceof Error ? error.message : "Rook could not start the Microsoft connection.",
      );
    }
  };

  const disconnectMicrosoft = () => {
    Alert.alert(
      "Disconnect Microsoft Excel?",
      "Rook will delete its stored Microsoft tokens immediately. Your workbooks will not be changed.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: () => {
            void disconnect.mutateAsync().then(async () => {
              await Promise.all([utils.excel.status.invalidate(), utils.excel.workbooks.invalidate()]);
            }).catch(() => Alert.alert("Disconnect failed", "Rook could not remove this connection. Please try again."));
          },
        },
      ],
    );
  };

  const openWorkbook = async () => {
    if (!selected?.webUrl) return;
    try {
      await Linking.openURL(selected.webUrl);
    } catch {
      Alert.alert("Workbook unavailable", "Microsoft did not provide a link that this device can open.");
    }
  };

  const connected = status.data?.connected === true;
  const needsReauthorization = status.data?.needsReauthorization === true;

  return (
    <Card style={styles.card}>
      <View style={styles.headerRow}>
        <View style={[styles.appIcon, { backgroundColor: tint(excelGreen, 0.11) }]}>
          <MaterialIcons name="grid-on" size={22} color={excelGreen} />
        </View>
        <View style={styles.headerCopy}>
          <Text style={[styles.title, { color: colors.text }]}>Microsoft Excel</Text>
          <Text numberOfLines={2} style={[styles.subtitle, { color: colors.textFaint }]}>Work with live `.xlsx` files in OneDrive.</Text>
        </View>
        {status.isLoading ? <ActivityIndicator size="small" color={colors.textFaint} /> : (
          <StatusPill
            label={connected ? "Connected" : needsReauthorization ? "Reconnect" : status.data?.configured ? "Available" : "Setup needed"}
            tone={connected ? "mint" : needsReauthorization ? "amber" : "muted"}
          />
        )}
      </View>

      {connected ? (
        <>
          <View style={[styles.connectionStrip, { backgroundColor: colors.surfaceAlt }]}>
            <View style={styles.connectionCopy}>
              <Text numberOfLines={1} style={[styles.accountName, { color: colors.text }]}>
                {status.data?.displayName || status.data?.email || "Microsoft account"}
              </Text>
              <Text numberOfLines={1} style={[styles.accountEmail, { color: colors.textFaint }]}>
                {status.data?.email || "Files.ReadWrite access"}
              </Text>
            </View>
            <MaterialIcons name="verified-user" size={18} color={excelGreen} />
          </View>

          <View style={styles.permissionRow}>
            <View style={[styles.permissionDot, { backgroundColor: excelGreen }]} />
            <Text style={[styles.permissionText, { color: colors.textSoft }]}>Bots may read live workbook data. Every edit pauses for your approval.</Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={expanded ? "Hide Excel workbooks" : "Browse Excel workbooks"}
            onPress={() => setExpanded((value) => !value)}
            style={({ pressed }) => [
              styles.primaryAction,
              { backgroundColor: colors.ink },
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.primaryActionText, { color: colors.onInk }]}>
              {expanded ? "Hide workbooks" : workbooks.isLoading ? "Finding workbooks…" : `Browse ${workbooks.data?.length ?? 0} workbook${workbooks.data?.length === 1 ? "" : "s"}`}
            </Text>
            <MaterialIcons name={expanded ? "expand-less" : "expand-more"} size={19} color={colors.onInk} />
          </Pressable>

          {expanded ? (
            <View style={styles.browser}>
              {workbooks.isError ? (
                <Notice text="Rook could not load your OneDrive workbooks. Reconnect Excel or try again." tone="error" />
              ) : workbooks.data?.length ? (
                <View style={styles.workbookList}>
                  {workbooks.data.slice(0, 20).map((workbook) => {
                    const active = selected?.id === workbook.id && selected.driveId === workbook.driveId;
                    return (
                      <Pressable
                        key={`${workbook.driveId}:${workbook.id}`}
                        accessibilityRole="button"
                        accessibilityLabel={`Inspect ${workbook.name}`}
                        onPress={() => {
                          setSelected(workbook);
                          setRange("A1:F12");
                          setRequestedRange("A1:F12");
                        }}
                        style={({ pressed }) => [
                          styles.workbookRow,
                          { borderColor: active ? tint(excelGreen, 0.45) : colors.line, backgroundColor: active ? tint(excelGreen, 0.06) : colors.canvas },
                          pressed && styles.pressed,
                        ]}
                      >
                        <MaterialIcons name="description" size={19} color={active ? excelGreen : colors.textFaint} />
                        <View style={styles.workbookCopy}>
                          <Text numberOfLines={1} style={[styles.workbookName, { color: colors.text }]}>{workbook.name}</Text>
                          <Text style={[styles.workbookMeta, { color: colors.textFaint }]}>{formatDate(workbook.lastModifiedDateTime)}</Text>
                        </View>
                        <MaterialIcons name="chevron-right" size={19} color={colors.textFaint} />
                      </Pressable>
                    );
                  })}
                </View>
              ) : workbooks.isLoading ? (
                <View style={styles.loadingRow}><ActivityIndicator size="small" color={excelGreen} /><Text style={[styles.loadingText, { color: colors.textFaint }]}>Looking in OneDrive…</Text></View>
              ) : (
                <Notice text="No .xlsx workbooks were found in this OneDrive." />
              )}

              {selected ? (
                <View style={[styles.previewPanel, { borderColor: colors.line, backgroundColor: colors.canvas }]}>
                  <View style={styles.previewHeader}>
                    <View style={styles.headerCopy}>
                      <Text numberOfLines={1} style={[styles.previewTitle, { color: colors.text }]}>{selected.name}</Text>
                      <Text numberOfLines={1} style={[styles.previewMeta, { color: colors.textFaint }]}>
                        {structure.isLoading ? "Opening workbook…" : `${structure.data?.worksheets.length ?? 0} sheets · ${structure.data?.tables.length ?? 0} tables`}
                      </Text>
                    </View>
                    {selected.webUrl ? (
                      <Pressable accessibilityRole="link" accessibilityLabel="Open workbook in Microsoft Excel" onPress={() => void openWorkbook()} style={({ pressed }) => [styles.iconButton, { backgroundColor: colors.surfaceAlt }, pressed && styles.pressed]}>
                        <MaterialIcons name="open-in-new" size={17} color={colors.textSoft} />
                      </Pressable>
                    ) : null}
                  </View>

                  {worksheet ? (
                    <>
                      <View style={styles.rangeRow}>
                        <View style={[styles.rangeInputShell, { borderColor: colors.line, backgroundColor: colors.surface }]}>
                          <Text style={[styles.sheetPrefix, { color: colors.textFaint }]}>{worksheet}!</Text>
                          <TextInput
                            value={range}
                            onChangeText={setRange}
                            autoCapitalize="characters"
                            autoCorrect={false}
                            returnKeyType="done"
                            onSubmitEditing={() => setRequestedRange(range.trim() || "A1:F12")}
                            style={[styles.rangeInput, { color: colors.text }]}
                            accessibilityLabel="Excel range"
                          />
                        </View>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Read Excel range"
                          onPress={() => setRequestedRange(range.trim() || "A1:F12")}
                          style={({ pressed }) => [styles.readButton, { backgroundColor: excelGreen }, pressed && styles.pressed]}
                        >
                          <Text style={styles.readButtonText}>Read</Text>
                        </Pressable>
                      </View>

                      {preview.isFetching ? (
                        <View style={styles.loadingRow}><ActivityIndicator size="small" color={excelGreen} /><Text style={[styles.loadingText, { color: colors.textFaint }]}>Reading {worksheet}!{requestedRange}…</Text></View>
                      ) : preview.isError ? (
                        <Notice text="That range could not be read. Check the address and try a smaller range." tone="error" />
                      ) : preview.data?.text?.length ? (
                        <RangePreview rows={preview.data.text} />
                      ) : (
                        <Notice text="This range is empty." />
                      )}
                    </>
                  ) : structure.isError ? (
                    <Notice text="Rook could not open this workbook structure." tone="error" />
                  ) : null}
                </View>
              ) : null}
            </View>
          ) : null}

          <Pressable accessibilityRole="button" accessibilityLabel="Disconnect Microsoft Excel" onPress={disconnectMicrosoft} style={({ pressed }) => [styles.quietAction, pressed && styles.pressed]}>
            <Text style={[styles.quietActionText, { color: colors.textFaint }]}>Disconnect</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={[styles.explainer, { color: colors.textSoft }]}>Let your Bots find workbooks, inspect sheets and formulas, summarize live data, and prepare precise edits for approval.</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Connect Microsoft Excel"
            onPress={() => void connectMicrosoft()}
            disabled={authorize.isPending || status.data?.configured === false}
            style={({ pressed }) => [
              styles.primaryAction,
              { backgroundColor: status.data?.configured === false ? colors.surfaceAlt : colors.ink },
              pressed && status.data?.configured !== false && styles.pressed,
            ]}
          >
            {authorize.isPending ? <ActivityIndicator size="small" color={colors.onInk} /> : <MaterialIcons name="add-link" size={18} color={status.data?.configured === false ? colors.textFaint : colors.onInk} />}
            <Text style={[styles.primaryActionText, { color: status.data?.configured === false ? colors.textFaint : colors.onInk }]}>
              {needsReauthorization ? "Reconnect Microsoft" : status.data?.configured === false ? "Microsoft setup required" : "Connect Microsoft"}
            </Text>
          </Pressable>
        </>
      )}
    </Card>
  );
}

function Notice({ text, tone = "neutral" }: { text: string; tone?: "neutral" | "error" }) {
  const { colors } = useRookTheme();
  return (
    <View style={[styles.notice, { backgroundColor: tone === "error" ? colors.coralSoft : colors.surfaceAlt }]}>
      <MaterialIcons name={tone === "error" ? "error-outline" : "info-outline"} size={16} color={tone === "error" ? colors.coral : colors.textFaint} />
      <Text style={[styles.noticeText, { color: tone === "error" ? colors.coral : colors.textSoft }]}>{text}</Text>
    </View>
  );
}

function RangePreview({ rows }: { rows: string[][] }) {
  const { colors } = useRookTheme();
  const visibleRows = rows.slice(0, 12);
  const columnCount = Math.min(8, Math.max(...visibleRows.map((row) => row.length), 1));
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator>
      <View style={[styles.grid, { borderColor: colors.line }]}> 
        {visibleRows.map((row, rowIndex) => (
          <View key={`row-${rowIndex}`} style={styles.gridRow}>
            {Array.from({ length: columnCount }, (_, columnIndex) => (
              <View key={`cell-${rowIndex}-${columnIndex}`} style={[styles.gridCell, { borderColor: colors.line, backgroundColor: rowIndex === 0 ? colors.surfaceAlt : colors.surface }]}>
                <Text numberOfLines={2} style={[styles.gridText, { color: colors.text }]}>{row[columnIndex] ?? ""}</Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: { gap: 14 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  appIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { fontSize: 15, lineHeight: 20, fontWeight: "700", letterSpacing: -0.2 },
  subtitle: { fontSize: 11.5, lineHeight: 16, marginTop: 2 },
  connectionStrip: { minHeight: 56, borderRadius: 16, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  connectionCopy: { flex: 1, minWidth: 0 },
  accountName: { fontSize: 13.5, lineHeight: 18, fontWeight: "600" },
  accountEmail: { fontSize: 11.5, lineHeight: 16, marginTop: 1 },
  permissionRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingHorizontal: 2 },
  permissionDot: { width: 7, height: 7, borderRadius: 4, marginTop: 5 },
  permissionText: { flex: 1, fontSize: 12, lineHeight: 17 },
  explainer: { fontSize: 12.5, lineHeight: 18.5 },
  primaryAction: { minHeight: 46, borderRadius: 15, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 15 },
  primaryActionText: { fontSize: 13.5, lineHeight: 18, fontWeight: "700" },
  pressed: { opacity: 0.72 },
  browser: { gap: 12 },
  workbookList: { gap: 7 },
  workbookRow: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 15, paddingHorizontal: 12, paddingVertical: 9 },
  workbookCopy: { flex: 1, minWidth: 0 },
  workbookName: { fontSize: 13, lineHeight: 17, fontWeight: "600" },
  workbookMeta: { fontSize: 10.5, lineHeight: 14, marginTop: 2 },
  loadingRow: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 },
  loadingText: { fontSize: 12, lineHeight: 16 },
  previewPanel: { borderWidth: 1, borderRadius: 17, padding: 12, gap: 12 },
  previewHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  previewTitle: { fontSize: 13.5, lineHeight: 18, fontWeight: "700" },
  previewMeta: { fontSize: 10.5, lineHeight: 14, marginTop: 2 },
  iconButton: { width: 34, height: 34, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  rangeRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  rangeInputShell: { flex: 1, minHeight: 42, borderWidth: 1, borderRadius: 13, flexDirection: "row", alignItems: "center", paddingHorizontal: 11 },
  sheetPrefix: { fontSize: 12, lineHeight: 16 },
  rangeInput: { flex: 1, minHeight: 40, fontSize: 12.5, lineHeight: 17, paddingVertical: 8 },
  readButton: { minHeight: 42, borderRadius: 13, justifyContent: "center", paddingHorizontal: 15 },
  readButtonText: { color: "#FFFFFF", fontSize: 12.5, fontWeight: "700" },
  notice: { minHeight: 46, borderRadius: 14, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 9 },
  noticeText: { flex: 1, fontSize: 11.5, lineHeight: 16 },
  grid: { borderWidth: 1, borderRadius: 12, overflow: "hidden" },
  gridRow: { flexDirection: "row" },
  gridCell: { width: 112, minHeight: 43, borderRightWidth: 1, borderBottomWidth: 1, paddingHorizontal: 8, paddingVertical: 7, justifyContent: "center" },
  gridText: { fontSize: 10.5, lineHeight: 14 },
  quietAction: { alignSelf: "center", minHeight: 34, justifyContent: "center", paddingHorizontal: 12 },
  quietActionText: { fontSize: 11.5, fontWeight: "600" },
});

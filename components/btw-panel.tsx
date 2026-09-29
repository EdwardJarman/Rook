import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useSyncExternalStore } from "react";
import { Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useRookTheme } from "./rook-primitives";
import { BtwController, requestBtw } from "../shared/btw-client";
import { boundedBtwContext, BTW_QUESTION_LIMIT, type BtwInput } from "../shared/btw";
import { getApiBaseUrl } from "../constants/oauth";
import { parseChatMarkdown } from "../lib/chat-markdown";

export type BtwPanelHandle = { open: (question?: string) => void };
export type BtwPanelProps = { context: Omit<BtwInput, "question">; getToken: () => Promise<string | null>; onClose?: () => void };

/** Parent keys this panel by account/chat/Bot so another scope never inherits its answer. */
export const BtwPanel = forwardRef<BtwPanelHandle, BtwPanelProps>(function BtwPanel(props, ref) {
  const { colors } = useRookTheme();
  const latest = useRef(props); latest.current = props;
  const questionInput = useRef<TextInput>(null);
  const controller = useMemo(() => new BtwController((question, signal, onToken) => requestBtw({
    baseUrl: getApiBaseUrl(), getToken: latest.current.getToken, signal, onToken, streaming: Platform.OS === "web",
    body: { ...latest.current.context, context: boundedBtwContext(latest.current.context.context), question },
  })), []);
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
  useImperativeHandle(ref, () => ({ open: (question) => { controller.open(question); if (question?.trim()) void controller.ask(); } }), [controller]);
  useEffect(() => () => controller.dismiss(), [controller]);
  useEffect(() => { if (state.open) questionInput.current?.focus(); }, [state.open]);
  const dismiss = () => { controller.dismiss(); props.onClose?.(); };
  if (!state.open) return null;
  const busy = state.status === "answering";
  return <View style={{ width: "100%", maxWidth: 760, alignSelf: "center", borderWidth: 1, borderColor: colors.line,
    borderRadius: 18, backgroundColor: colors.surface, padding: 14, gap: 9, marginBottom: 10 }} accessibilityLabel="Side question panel">
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <Text style={{ color: colors.text, fontWeight: "600", fontSize: 14 }}>Side question</Text>
      <Pressable onPress={dismiss} accessibilityRole="button" accessibilityLabel="Dismiss side question" hitSlop={10}
        style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: colors.textSoft, fontSize: 18 }}>×</Text>
      </Pressable>
    </View>
    <Text style={{ color: colors.textSoft, fontSize: 12 }}>Your main work continues. This answer stays outside the chat.</Text>
    <TextInput ref={questionInput} value={state.draft} onChangeText={controller.setDraft} maxLength={BTW_QUESTION_LIMIT}
      multiline editable={!busy} accessibilityLabel="Side question" placeholder="What does that mean?" placeholderTextColor={colors.textFaint}
      onKeyPress={(event) => {
        const key = event.nativeEvent as { key: string; shiftKey?: boolean; isComposing?: boolean; keyCode?: number };
        if (key.key === "Escape") dismiss();
        if (Platform.OS === "web" && key.key === "Enter" && !key.shiftKey && !key.isComposing && key.keyCode !== 229) {
          event.preventDefault(); void controller.ask();
        }
      }}
      style={{ color: colors.text, backgroundColor: colors.canvas, borderRadius: 10, padding: 10, minHeight: 44, maxHeight: 100 }} />
    {state.text ? <ScrollView style={{ maxHeight: 220 }} contentContainerStyle={{ gap: 6 }}>
      {parseChatMarkdown(state.text).map((block, index) => <Text key={index} selectable style={{ color: colors.text, fontSize: 14, lineHeight: 21,
        ...(block.type === "heading" ? { fontWeight: "600" as const } : {}),
        ...(block.type === "code" ? { fontFamily: "monospace" } : {}) }}>
        {block.type === "code" ? block.code : block.type === "math" ? block.latex : <>
          {block.type === "bullet" ? "• " : block.type === "ordered" ? `${block.ordinal}. ` : ""}
          {block.content.map((part, partIndex) => <Text key={partIndex} style={{ fontWeight: part.bold ? "600" : undefined,
            fontFamily: part.code ? "monospace" : undefined }}>{part.text}</Text>)}
        </>}
      </Text>)}
    </ScrollView> : null}
    {busy ? <Text accessibilityLiveRegion="polite" style={{ color: colors.textSoft, fontSize: 12 }}>Answering…</Text> : null}
    {state.error ? <Text accessibilityRole="alert" style={{ color: colors.textSoft, fontSize: 12 }}>{state.error}</Text> : null}
    {state.answer ? <Text style={{ color: colors.textFaint, fontSize: 11 }}>{state.answer.model}{state.answer.partial ? " · Answer reached its limit" : ""}</Text> : null}
    <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 16 }}>
      {busy ? <Pressable accessibilityRole="button" accessibilityLabel="Stop side answer" onPress={controller.cancel}
        style={{ minHeight: 44, minWidth: 44, justifyContent: "center" }}><Text style={{ color: colors.textSoft }}>Stop</Text></Pressable>
        : <Pressable accessibilityRole="button" accessibilityLabel={state.status === "error" ? "Retry side question" : "Ask side question"}
          disabled={!state.draft.trim()} onPress={() => void controller.ask()}
          style={{ minHeight: 44, minWidth: 44, justifyContent: "center", opacity: state.draft.trim() ? 1 : 0.45 }}><Text style={{ color: colors.accent, fontWeight: "600" }}>{state.status === "error" ? "Retry" : "Ask"}</Text></Pressable>}
    </View>
  </View>;
});

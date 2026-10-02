import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useSyncExternalStore } from "react";
import { Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useRookTheme } from "./rook-primitives";
import { BtwController, requestBtw, type BtwState } from "../shared/btw-client";
import { boundedBtwContext, btwKeyAction, BTW_QUESTION_LIMIT, type BtwInput } from "../shared/btw";
import { getApiBaseUrl } from "../constants/oauth";
import { parseChatMarkdown } from "../lib/chat-markdown";

export type BtwPanelHandle = { open: (question?: string, ask?: boolean) => void };
export type BtwPanelProps = { context: Omit<BtwInput, "question">; getToken: () => Promise<string | null>; onClose?: () => void };

type BarProps = {
  state: BtwState;
  inputRef?: React.Ref<TextInput>;
  onChangeDraft: (draft: string) => void;
  onAsk: () => void;
  onStop: () => void;
  onDismiss: () => void;
};

/** Slim one-line aside bar plus a compact answer. Presentational so every state renders hermetically. */
export function BtwBar({ state, inputRef, onChangeDraft, onAsk, onStop, onDismiss }: BarProps) {
  const { colors } = useRookTheme();
  if (!state.open) return null;
  const busy = state.status === "answering";
  const canAsk = Boolean(state.draft.trim());
  const action = { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" } as const;
  return <View style={{ width: "100%", maxWidth: 760, alignSelf: "center", marginBottom: 6, gap: 4 }} accessibilityLabel="Quick aside">
    <View style={{ flexDirection: "row", alignItems: "center", minHeight: 44, borderRadius: 22, borderWidth: 1,
      borderColor: colors.line, backgroundColor: colors.surfaceAlt, paddingLeft: 14 }}>
      <Text style={{ color: colors.accent, fontSize: 12, fontWeight: "700", marginRight: 8 }}>/btw</Text>
      <TextInput ref={inputRef} value={state.draft} onChangeText={onChangeDraft} maxLength={BTW_QUESTION_LIMIT} editable={!busy}
        accessibilityLabel="Quick aside" placeholder="Ask a quick aside…" placeholderTextColor={colors.textFaint}
        returnKeyType="send" blurOnSubmit={false} onSubmitEditing={() => { if (canAsk && !busy) onAsk(); }}
        onKeyPress={(event) => {
          const key = event.nativeEvent as { key: string; shiftKey?: boolean; isComposing?: boolean; keyCode?: number };
          if (btwKeyAction(key, state.status) === "dismiss") onDismiss();
        }}
        style={{ flex: 1, minHeight: 44, color: colors.text, fontSize: 14, paddingVertical: 0 }} />
      {busy
        ? <Pressable accessibilityRole="button" accessibilityLabel="Stop aside" onPress={onStop} style={action}>
          <Text style={{ color: colors.textSoft, fontSize: 12 }}>Stop</Text></Pressable>
        : <Pressable accessibilityRole="button" accessibilityLabel={state.status === "error" ? "Retry aside" : "Send aside"}
          disabled={!canAsk} onPress={onAsk} style={{ ...action, opacity: canAsk ? 1 : 0.4 }}>
          <Text style={{ color: colors.accent, fontSize: 12, fontWeight: "600" }}>{state.status === "error" ? "Retry" : "Send"}</Text></Pressable>}
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss aside" onPress={onDismiss} style={action}>
        <Text style={{ color: colors.textSoft, fontSize: 16 }}>×</Text></Pressable>
    </View>
    {state.text ? <ScrollView style={{ maxHeight: 150 }} contentContainerStyle={{ gap: 4, paddingHorizontal: 14 }}>
      {parseChatMarkdown(state.text).map((block, index) => <Text key={index} selectable style={{ color: colors.textSoft, fontSize: 13, lineHeight: 19,
        ...(block.type === "heading" ? { fontWeight: "600" as const } : {}),
        ...(block.type === "code" ? { fontFamily: "monospace" } : {}) }}>
        {block.type === "code" ? block.code : block.type === "math" ? block.latex : <>
          {block.type === "bullet" ? "• " : block.type === "ordered" ? `${block.ordinal}. ` : ""}
          {block.content.map((part, partIndex) => <Text key={partIndex} style={{ fontWeight: part.bold ? "600" : undefined,
            fontFamily: part.code ? "monospace" : undefined }}>{part.text}</Text>)}
        </>}
      </Text>)}
    </ScrollView> : null}
    {busy ? <Text accessibilityLiveRegion="polite" style={{ color: colors.textFaint, fontSize: 11, paddingHorizontal: 14 }}>Answering…</Text> : null}
    {state.error ? <Text accessibilityRole="alert" style={{ color: colors.textSoft, fontSize: 12, paddingHorizontal: 14 }}>{state.error}</Text> : null}
    {state.answer?.partial ? <Text style={{ color: colors.textFaint, fontSize: 11, paddingHorizontal: 14 }}>Answer reached its limit</Text> : null}
  </View>;
}

/** Parent keys this panel by account/chat/Bot so another scope never inherits its answer. */
export const BtwPanel = forwardRef<BtwPanelHandle, BtwPanelProps>(function BtwPanel(props, ref) {
  const latest = useRef(props); latest.current = props;
  const questionInput = useRef<TextInput>(null);
  const controller = useMemo(() => new BtwController((question, signal, onToken) => requestBtw({
    baseUrl: getApiBaseUrl(), getToken: latest.current.getToken, signal, onToken, streaming: Platform.OS === "web",
    body: { ...latest.current.context, context: boundedBtwContext(latest.current.context.context), question },
  })), []);
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
  useImperativeHandle(ref, () => ({ open: (question, ask = true) => { controller.open(question); if (ask && question?.trim()) void controller.ask(); } }), [controller]);
  useEffect(() => () => controller.dismiss(), [controller]);
  useEffect(() => { if (state.open) questionInput.current?.focus(); }, [state.open]);
  const dismiss = () => { controller.dismiss(); props.onClose?.(); };
  return <BtwBar state={state} inputRef={questionInput} onChangeDraft={controller.setDraft}
    onAsk={() => void controller.ask()} onStop={controller.cancel} onDismiss={dismiss} />;
});

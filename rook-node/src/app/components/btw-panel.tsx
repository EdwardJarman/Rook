import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useSyncExternalStore } from "react";
import { BtwController, requestBtw, type BtwState } from "../../../../shared/btw-client";
import { boundedBtwContext, btwKeyAction, BTW_QUESTION_LIMIT, type BtwInput } from "../../../../shared/btw";
import { currentToken } from "../lib/send-bridge";
import { getApiBaseUrl } from "../lib/api-base";
import { useTheme } from "../lib/theme";
import { Markdown } from "./markdown";

export type BtwPanelHandle = { open: (question?: string, ask?: boolean) => void };

type BarProps = {
  state: BtwState;
  inputRef?: React.Ref<HTMLInputElement>;
  onChangeDraft: (draft: string) => void;
  onAsk: () => void;
  onStop: () => void;
  onDismiss: () => void;
};

/** Slim one-line aside bar plus a compact answer. Presentational so every state renders hermetically. */
export function BtwBar({ state, inputRef, onChangeDraft, onAsk, onStop, onDismiss }: BarProps) {
  const { tokens } = useTheme();
  if (!state.open) return null;
  const busy = state.status === "answering";
  const canAsk = Boolean(state.draft.trim());
  const action = { border: 0, background: "transparent", cursor: "pointer", minWidth: 44, minHeight: 44, fontSize: 12 } as const;
  return <div role="group" aria-label="Quick aside" style={{ marginBottom: 6, display: "flex", flexDirection: "column", gap: 4 }}
    onKeyDown={(event) => { if (btwKeyAction(event, state.status) === "dismiss") { event.stopPropagation(); onDismiss(); } }}>
    <div style={{ display: "flex", alignItems: "center", minHeight: 44, borderRadius: 22, border: `1px solid ${tokens.line}`,
      background: tokens.surfaceAlt, paddingLeft: 14 }}>
      <span style={{ color: tokens.accent, fontSize: 12, fontWeight: 700, marginRight: 8 }}>/btw</span>
      <input ref={inputRef} type="text" aria-label="Quick aside" placeholder="Ask a quick aside…" value={state.draft} disabled={busy}
        maxLength={BTW_QUESTION_LIMIT} onChange={(event) => onChangeDraft(event.target.value)}
        onKeyDown={(event) => { if (btwKeyAction({ key: event.key, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing, keyCode: event.keyCode }, state.status) === "ask" && canAsk) { event.preventDefault(); onAsk(); } }}
        style={{ flex: 1, minWidth: 0, border: 0, outline: "none", background: "transparent", color: tokens.text, fontSize: 14 }} />
      {busy
        ? <button type="button" aria-label="Stop aside" onClick={onStop} style={{ ...action, color: tokens.textSoft }}>Stop</button>
        : <button type="button" aria-label={state.status === "error" ? "Retry aside" : "Send aside"} disabled={!canAsk} onClick={onAsk}
          style={{ ...action, color: tokens.accent, fontWeight: 600, opacity: canAsk ? 1 : 0.4 }}>{state.status === "error" ? "Retry" : "Send"}</button>}
      <button type="button" aria-label="Dismiss aside" onClick={onDismiss} style={{ ...action, color: tokens.textSoft, fontSize: 16 }}>×</button>
    </div>
    {state.text ? <div style={{ maxHeight: 150, overflowY: "auto", padding: "0 14px", fontSize: 13, color: tokens.textSoft }}><Markdown text={state.text} /></div> : null}
    {busy ? <p role="status" style={{ margin: 0, padding: "0 14px", fontSize: 11, color: tokens.textFaint }}>Answering…</p> : null}
    {state.error ? <p role="alert" style={{ margin: 0, padding: "0 14px", fontSize: 12, color: tokens.textSoft }}>{state.error}</p> : null}
    {state.answer?.partial ? <p style={{ margin: 0, padding: "0 14px", fontSize: 11, color: tokens.textFaint }}>Answer reached its limit</p> : null}
  </div>;
}

export const BtwPanel = forwardRef<BtwPanelHandle, { context: Omit<BtwInput, "question">; onClose?: () => void }>(function BtwPanel(props, ref) {
  const latest = useRef(props); latest.current = props;
  const questionInput = useRef<HTMLInputElement>(null);
  const controller = useMemo(() => new BtwController((question, signal, onToken) => requestBtw({
    baseUrl: getApiBaseUrl(), getToken: currentToken, signal, onToken, streaming: true,
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

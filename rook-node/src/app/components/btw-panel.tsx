import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useSyncExternalStore } from "react";
import { BtwController, requestBtw } from "../../../../shared/btw-client";
import { boundedBtwContext, BTW_QUESTION_LIMIT, type BtwInput } from "../../../../shared/btw";
import { currentToken } from "../lib/send-bridge";
import { getApiBaseUrl } from "../lib/api-base";
import { useTheme } from "../lib/theme";
import { Markdown } from "./markdown";

export type BtwPanelHandle = { open: (question?: string) => void };
export const BtwPanel = forwardRef<BtwPanelHandle, { context: Omit<BtwInput, "question">; onClose?: () => void }>(function BtwPanel(props, ref) {
  const { tokens } = useTheme();
  const latest = useRef(props); latest.current = props;
  const questionInput = useRef<HTMLTextAreaElement>(null);
  const controller = useMemo(() => new BtwController((question, signal, onToken) => requestBtw({
    baseUrl: getApiBaseUrl(), getToken: currentToken, signal, onToken, streaming: true,
    body: { ...latest.current.context, context: boundedBtwContext(latest.current.context.context), question },
  })), []);
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
  useImperativeHandle(ref, () => ({ open: (question) => { controller.open(question); if (question?.trim()) void controller.ask(); } }), [controller]);
  useEffect(() => () => controller.dismiss(), [controller]);
  useEffect(() => { if (state.open) questionInput.current?.focus(); }, [state.open]);
  const dismiss = () => { controller.dismiss(); props.onClose?.(); };
  if (!state.open) return null;
  const busy = state.status === "answering";
  return <aside aria-label="Side question panel" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); dismiss(); } }}
    style={{ border: `1px solid ${tokens.line}`, borderRadius: 16, padding: 14, marginBottom: 10, background: tokens.surface, color: tokens.text }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
      <strong style={{ fontSize: 14 }}>Side question</strong><button type="button" aria-label="Dismiss side question" onClick={dismiss}
        style={{ background: "transparent", border: 0, color: tokens.textSoft, cursor: "pointer", fontSize: 20 }}>×</button>
    </div>
    <p style={{ color: tokens.textSoft, fontSize: 12, margin: "0 0 10px" }}>Your main work continues. This answer stays outside the chat.</p>
    <textarea ref={questionInput} aria-label="Side question" placeholder="What does that mean?" value={state.draft} disabled={busy}
      maxLength={BTW_QUESTION_LIMIT} rows={2} onChange={(event) => controller.setDraft(event.target.value)}
      onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void controller.ask(); } }}
      style={{ boxSizing: "border-box", width: "100%", background: tokens.canvas, color: tokens.text, border: `1px solid ${tokens.line}`, borderRadius: 10, padding: 10, resize: "vertical", maxHeight: 120 }} />
    {state.text ? <div style={{ maxHeight: 240, overflowY: "auto", marginTop: 10 }}><Markdown text={state.text} /></div> : null}
    {busy ? <p role="status" style={{ fontSize: 12, color: tokens.textSoft }}>Answering…</p> : null}
    {state.error ? <p role="alert" style={{ fontSize: 12, color: tokens.textSoft }}>{state.error}</p> : null}
    {state.answer ? <p style={{ fontSize: 11, color: tokens.textFaint }}>{state.answer.model}{state.answer.partial ? " · Answer reached its limit" : ""}</p> : null}
    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}><button type="button" onClick={() => busy ? controller.cancel() : void controller.ask()}
      disabled={!busy && !state.draft.trim()} style={{ border: `1px solid ${tokens.line}`, borderRadius: 9, padding: "6px 12px", background: tokens.surfaceAlt, color: tokens.text, cursor: "pointer" }}>
      {busy ? "Stop side answer" : state.status === "error" ? "Retry side question" : "Ask side question"}</button></div>
  </aside>;
});

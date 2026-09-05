# Rook Desktop — Roadmap to Claude/Codex parity

Source: the fresh-eyes critic review of the running v0.2.1 build
(2026-09-04) against the Claude and Codex desktop apps. Items are ordered
by impact on a real user's first week.

## 0. Real conversations (the critic's single biggest gap)

The chat surface works end-to-end (send → tRPC `workroom.reply` → reply
rendered as markdown), but when the app isn't signed in the reply is a
local fallback echo, and in the locally-built installer the Clerk key is
absent — so a new user's first chat is the echo, not a model.

- Ship v0.2.1 from CI with `secrets.VITE_CLERK_PUBLISHABLE_KEY` set —
  sign-in then works and real model replies flow (see
  `docs/release-v0.2.1-runbook.md`).
- Fallback UX: the offline echo now says plainly what's needed; consider
  also surfacing a one-click "Connect account" deep link from the chat
  empty state.
- Streaming: `workroom.reply` is request/response today. For
  Claude-level feel, move to SSE/streaming over the tRPC subscription or
  a gateway websocket, and render tokens as they arrive.

## 1. Conversation history (done in v0.2.1 — keep improving)

Sidebar "Recent" list with archived conversations, persisted across
restarts. Missing vs Claude/Codex: rename, pin, per-conversation search,
and a global search across all history.

## 2. Model picker

The web app has `trpc.ai.models` + composer model picker; desktop sends
use the server default. Add `model` to the `workroom.reply` input and a
compact picker in the composer footer (the tokens already exist).

## 3. Voice input

Web uses expo-audio + `trpc.voice.transcribe`. Desktop should use the
WebView's MediaRecorder → same mutation. Needs mic permission wiring in
the Tauri manifest.

## 4. Tray icon + background behavior

The app already claims "Rook stays connected in the background" — make it
true: `tauri-plugin-tray` with Show/Quit, window close → hide, and a
status menu (Connected/Paired + version).

## 5. Auto-update

`tauri-plugin-updater` pointing at `releases/latest/download/latest.json`
(Tauri's updater manifest). Add a `latest.json` generator step to the
release workflow after assets upload.

## 6. Deep links

Register `rook://` in `tauri.conf.json` (OS-level protocol) so pairing
and invite flows can open the app directly, like `claude://`.

## 7. Install hygiene

- Chromium staging now copies only the pinned revisions
  (`scripts/stage-chromium.mjs`) — installer shrinks from 654 MB toward
  ~250 MB and installed size from ~2.2 GB to ~1 GB. Verify in CI.
- The old "Rook Node" (v0.1.x) install leaves a second uninstall entry;
  consider an NSIS preinstall check that offers to remove it.

## 8. Settings completeness

Next candidates in Claude/Codex order of value: notifications preferences,
data controls (clear local history), keyboard-shortcuts help overlay
(Ctrl+N / Ctrl+, / Ctrl+1–8 exist), language, and an explicit
"check for updates" button once the updater ships.

## 9. Naming

"Workroom/Bots" is Rook's identity — keep it, but consider "Chats" for
the sidebar Recent section (the critic found "Workroom" vaguer than
Claude's "Chats"). Remove in-product competitor name-drops ("like Codex
and Claude desktop") — comparison belongs on the website, not in the UI.

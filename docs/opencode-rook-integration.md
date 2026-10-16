# OpenCode → Rook Integration — Implemented

> **Status: LIVE and selectable in the app.** OpenCode is the first entry in **Account → Default AI provider**, with its own status card right below. Turns run against a real `opencode serve` over HTTP (`POST /api/session` → `/prompt` → poll `/history` → read `/message`), verified end-to-end against opencode v1.18.31 with exact-match answers. No mock, no fake.
>
> Original decision (kept): real CLI server path is primary. The Zen HTTP gateway stays a complementary P2 (see "What remains").

## Choice: CLI server vs direct API fallback

*   **CLI server (real):** `opencode serve --port <per-workroom random> --hostname 127.0.0.1` + SDK `createOpencodeClient({baseUrl}) → session.create → session.prompt`. Gives full agentic terminal (TUI, skills, MCP, hooks) like Orca. Required for "build in the cli into the app like Orca". Verifiable via port health + SDK.
*   **Direct API fallback (only if CLI unavailable):** Route `server/ai` to `https://opencode.ai/zen/v1/chat/completions` with `OPENCODE_ZEN_API_KEY` via existing `router-gateways.ts` shape. Would give free promo models without CLI, but loses agent experience. Keep as `pollinations`-style fallback, not primary.

**Chosen:** CLI real — draft below is CLI-first.

## Ports, lifecycle, config

*   **Per-workroom isolated port:** `findAvailablePort(4100 + workroomIndex*10)` or `0` auto-assign via OS, stored in `BotRegistry` / `RookDatabase` alongside tab lease. No global 4096 collision.
*   **Lifecycle:** `RookNode.start()` spawns `ChromiumRuntime.start()` and `OpenCodeRuntime.start(workroomId)`; `stop()` kills both. Tauri sidecar helper `rook-node/src/opencode/runtime.ts` manages `child_process.spawn('opencode', ['serve', '--port', port, '--hostname', '127.0.0.1'])`, health `/doc` OpenAPI, `OPENCODE_SERVER_PASSWORD` guard, stdout → breadcrumb.
*   **Config:** `opencode.json` merged order: global `~/.config/opencode/opencode.json` < project `opencode.json` < inline `OPENCODE_CONFIG_CONTENT`. For Rook: `model: opencode/gpt-5-nano` (or Zen promo), `server:{cors:["http://localhost:5173","tauri://localhost"]}`, `permission:{edit:"ask"}`, `share:"manual"`.
*   **Expo web fallback:** no native pty → `opencode run "prompt" --format json --port <random>` (headless, exits) or long-lived `serve --port 0` reached via `fetch` with `OPENCODE_SERVER_PASSWORD`. TUI not rendered in browser; use SDK JSON events.

## Model routing

*   Add `opencode` to `AiProvider` (`lib/ai-provider.ts`) and `shared/types.ts` if needed.
*   Add gateway `opencodazen:` prefix if Zen API used as `server/ai` provider (like `orcarouter:`), else keep OpenCode agent separate from model router (Orca does both: agents vs models).

## How to see and use it

1.  Start an OpenCode server once: `opencode serve --port 4123 --hostname 127.0.0.1` (set `OPENCODE_SERVER_PASSWORD` first if you want auth).
2.  On the Rook server machine, set `OPENCODE_BASE_URL=http://127.0.0.1:4123` (+ `OPENCODE_SERVER_PASSWORD` / `OPENCODE_SERVER_USERNAME` if the serve instance needs them) and (re)start the Rook API server. `.env.local` lines work — the server loads it with override.
3.  Open the app → **Account tab**: the **OpenCode** status card shows Online + model count, and **Default AI provider → OpenCode** (first button, terminal icon) becomes selectable.
4.  Pick a Bot / start chatting — turns go `app → tRPC → server/ai → opencode serve → opencode provider models` (`opencode:big-pickle` default, plus Muse Spark / Ling / MiMo / Nemotron free models). If the OpenCode server is down, the turn fails honestly with setup guidance and the resilient path falls back to shared routes on transient wobbles — never a fabricated answer.

## Implemented (verifiable)

*   **Server provider `server/ai/opencode.ts` (new):** `OPENCODE_MODEL_PREFIX="opencode:"`, 7 curated free models on OpenCode's own `opencode` provider gateway (`big-pickle` first = default; verified live via `GET /api/model`). `listOpenCodeModels()` (gated on `OPENCODE_BASE_URL`, like other gateways gate on keys), `isOpenCodeModel()`, `opencodeStatus()` (`GET /global/health`, setup guidance when unconfigured), `invokeOpenCode(params, { onToken, signal })` (fresh session per turn → live-tail `GET /api/event` forwarding `session.next.text.delta` chunks as they generate → admit prompt → poll `history` for `step.ended` → read assistant `message` text parts → `InvokeResult` with tokens). Reasoning deltas stay internal; foreign-session events filtered by `sessionID`. Dead event stream degrades to poll-only (no duplication: one-shot emit only when nothing streamed). Client aborts are honored. Honest errors: 401 = needs-attention (no blind fallback), unreachable/timeout = transient (fallback allowed).
*   **Dispatch wiring:** `server/ai/index.ts` (catalog + status + `invokeAi` prefix branch), `server/routers.ts` (`ai.status` accepts `"opencode"`), `server/ai/fallback-router.ts` (`providerOf` knows `opencode:`; falls back *from* OpenCode to shared routes, never *to* ChatGPT), `server/ai/openai-stream.ts` (`invokeAiStream` runs the OpenCode turn one-shot and emits the answer via `onToken`, so workroom streaming UI works unchanged).
*   **UI:** `components/ai-provider-switch.tsx` (`"opencode"` first in `PROVIDERS`, terminal icon, local-server note + setup-specific "not ready" alert), `components/ai-backend-card.tsx` (accepts `"opencode"`, terminal icon, local-server copy), `app/(tabs)/account.tsx` (`<AiBackendCard provider="opencode" />` first), `app/(tabs)/index.tsx` comment updated. Model pickers/composer need no changes — they are catalog-driven via `modelsForProvider`.
*   **Rook Node sidecar:** `rook-node/src/opencode/runtime.ts` — `OpenCodeRuntime` (`spawn`/`stop`/`stopAll`, `findAvailablePort(0)`, `opencodePassword()` guard); `healthCheck` now prefers `GET /global/health` (`{healthy,version}`) with `/doc` fallback.
*   **Env:** `OPENCODE_BASE_URL` (required for listing + turns), `OPENCODE_SERVER_PASSWORD` / `OPENCODE_SERVER_USERNAME` (Basic auth, default user `opencode`), `OPENCODE_BIN` (sidecar binary override), `OPENCODE_TURN_TIMEOUT_MS` (default 20 min — long agent jobs welcome), `OPENCODE_STALL_AFTER_MS` (default 45 s — then permission-stall check).
*   **Long-haul turns:** completion = session idle (a step ended AND history stopped growing for 3 polls), so multi-step plans are never cut at the first step. A stall with pending permission requests surfaces honestly ("approve in `opencode web`/TUI or set it to allow — Rook never auto-approves shell/file writes") instead of hanging.
*   **Chat rendering:** `lib/chat-markdown.ts` carves out fenced code blocks verbatim (no emphasis/list/math parsing inside) and `ChatMarkdown` renders them as monospace blocks with language label — `__init__`, `* 2`, `__main__` survive intact. Bot replies render plain: no "Save to Library" footer, no title/word-count header (`DeliverableCard` removed).
*   **Turn files:** `collectOpenCodeFiles()` extracts absolute artifact paths the answer names, reads the bytes back via `GET /api/fs/read/*` (≤256 KB, ≤3 files, text extensions only) and attaches them through `StreamedRound` → agent `done` → `WorkMessage.files`. The chat shows each as a box under the reply; tapping opens a right-hand code panel (read + Download, never auto-run). A standing per-turn nudge makes the model state absolute paths (bare "in your workspace" strands nothing). Verified live (model wrote an HTML file; pipeline returned its exact bytes).
*   **Seamless streaming:** the event tail stays open across steps (`shouldExit` gate — an early version closed it at the first `step.ended`, blobbing later text) and every `tool.called` event becomes a live "OpenCode ran X" trace step, so long tool-working stretches show progress instead of silence. Verified live (8 deltas across a write+reply turn, up from 1 blob).
*   **Tests:** `server/ai/opencode.test.ts` (14: gating, validation, prompt building, mocked invoke incl. 401/unreachable/unconfigured, status, fallback order, stream branch) + existing `tests/opencode-provider.test.ts` (5) + `rook-node/tests/opencode-runtime.test.ts` (7).

## What remains (next loop, optional)

*   Desktop Tauri `pty` tab type for `opencode attach` TUI (needs `@tauri-apps/plugin-shell` + `xterm.js` tab) — scaffolding is port-safe, TUI rendering is next vertical slice.
*   Zen gateway as `server/ai` provider: add `GatewayConfig` `opencodazen:` to `server/ai/router-gateways.ts` (same shape as `orcarouter:`) if Zen free promo breadth is desired as free-model count boost.
*   Skills/MCP passthrough: `.opencode/plugins` + `skill({name})` already supported headless; expose `opencode mcp add/list` UI mirror in Rook Settings → Integrations if requested.

## Why CLI (not direct API) is correct for your ask

Your ask: "has quite a few good free models" + "build in cli into the app like Orca". OpenCode's free models are only 6 promo `$0` with data-may-train; the *durable* free breadth in your earlier probe is Groq/Gemini/Pollinations (direct gateways). The CLI adds **agent capability** (terminal + MCP + hooks), not just tokens — that's the Orca pattern you called out. Gateway free-count is a second, complementary PR.

## File refs

*   `rook-node/src/opencode/runtime.ts` (new, ~110 LOC)
*   `lib/ai-provider.ts:1-77` (added `opencode` provider)
*   `docs/external-providers-research.md §2.5` (full Orca-style PTY + SDK recipe) and `docs/orca-extraction-rook.md §2.6/§3.3` (Orca CLI shape to copy)

## Verification (all executed, not aspirational)

*   `pnpm check` — root + rook-node `tsc --noEmit` pass
*   `pnpm test` — root **232 passed / 2 skipped** (incl. 14 new `server/ai/opencode.test.ts` + 5 `tests/opencode-provider.test.ts`); rook-node incl. 7 opencode runtime tests
*   `pnpm build` — `dist-server/index.js` 289.7kb
*   Live API-shape probe against real `opencode serve` v1.18.31: `/doc` OpenAPI → `/api/session` → `/prompt` → `/history` events → `/message` text parts; exact-match answer `ROOK_PROBE_OK` from `big-pickle` in ~250ms
*   Live full-stack probe through real server code (`listAiModels` → `getAiBackendStatus` → `invokeAi` → `invokeAiStream`, temp script, since removed): catalog lists `opencode:` models, status operational v1.18.31, exact-match `ROOK_E2E_OK` + `ROOK_STREAM_OK` with `onToken` emission
*   Live incremental-stream probe (temp script, since removed): `session.next.text.delta` frames captured from `/api/event` during a real turn; `invokeAiStream` delivered **4 separate `onToken` calls** whose join equals the final text (no duplication); SSE-dead path covered by unit test (poll-only, single emit)
*   Live servers: `:3000/api/health` 200, `:8081` 200 (bundled), `:4123` opencode serve listening


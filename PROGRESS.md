# Rook Desktop — Live Progress

Last updated: 2026-09-04, ~22:30 (wave 1)

## Goal
A Rook desktop app + download experience at the standard of the Claude and Codex desktop apps — fast and obvious to get, install, and use, with full parity to the web app and rock-solid error recovery.

## Working mode note
Sub-agent fan-out was attempted 4× (download flow, desktop runtime, release CI, and a foreground retry); every spawn hit a model concurrency limit in this environment. The work is being executed sequentially in the main loop instead, same piece-by-piece standard, with fresh-eyes critic agents to be retried as capacity allows.

## Pieces & status

| # | Piece | Status | Evidence |
|---|-------|--------|----------|
| 0 | Baseline typecheck + build | ✅ | tsc clean, vite build 45s |
| 1 | Every desktop route renders (no blank windows) | ✅ | Playwright sweep of 9 hash routes; **found + fixed real crash**: #/account & #/settings threw Clerk `useAuth` outside provider (same bug class as the v0.2.0 blank window). Added `lib/safe-auth.tsx` facade. All 9 routes now render. |
| 2 | First-run chat experience | ✅ | Composer no longer requires creating a Bot first — auto-provisions built-in "Rook" assistant on first send; Claude-style welcome hero with 4 suggestion chips; new dependency-free markdown renderer (code blocks w/ copy, bold/italic, lists, links). Interactive Playwright test: send → reply renders, 0 page errors. |
| 3 | Download page (app/download.tsx) | ✅ | Live GitHub release metadata: version + file size per card, "COMING SOON" state for assets missing from the latest release (verified: Android card correctly shows it on v0.1.20); new troubleshooting FAQ (SmartScreen, Gatekeeper xattr, AppImage, download fallback). Root tsc clean; static export screenshotted. |
| 4 | Release CI + asset integrity | 🔄 | Fixed `patch-inspector.mjs` non-idempotency (real CI-failure path: pnpm store cache can persist the patched file → script exited 1). Artifact upload now includes dmg/AppImage outputs; added `verify-release-assets.mjs` gate (fails loudly on missing/small assets) wired into the workflow. YAML validated. |
| 5 | **Real installer built from current code** | ✅ (rebuilding w/ Activity) | Full local pipeline ran: sidecar rebuilt from source (pkg, 199 MB) → smoke-tested healthy → Chromium staged → **NSIS installer built (654 MB) → silently installed on this machine → launched → gateway `{"ok":true}` → window paints the full workroom** (verified via non-invasive window capture; user's screen otherwise untouched). Welcome hero + enabled composer visible in the installed build. |
| 6 | Publish working release (v0.2.x) | ⏳ | ⚠️ **Key finding: latest published release is v0.1.20** — the v0.2.0 "release" from the handoff is not public. Public download currently ships the OLD app. Publishing needs a GitHub token (none in env) — will stage asset + exact commands. |
| 7 | Remaining parity | 🔄 | Added /activity route + sidebar (parity with web Activity tab) and native keyboard layer (Ctrl+N new chat, Ctrl+, settings, Ctrl+1–8 nav) — shipped in the 23:20 installer build. Still open: voice input, model picker (needs server-side model param), tray icon, auto-update. Desktop vitest suite: 68/68 green. |
| 8 | Fresh-eyes critic vs Claude/Codex desktop | 🔄 | Download-flow critic round 1: **FAIL** with 8 reproduced bugs → all fixed → round-2 critic now running. Desktop-app critic round 1 now running against the installed build. |
| 9 | Integration journey pass | ⏳ | |

## Verification artifacts
- Desktop route screenshots: `%TEMP%/rook-shots/*.png` (9 routes + chat interaction + download page)
- Sidecar smoke test: `{"ok":true,"paired":true}` from standalone pkg exe
- Preview servers: desktop `localhost:4188`, web export `localhost:8092`

## Known issues carried in (from v0.2.0 handoff)
- ~~Windows installer blank-window bug~~ — root cause class fixed + route crash fixed; proof-of-fix installer building now
- macOS/Linux CI installers failing — likely fixed (a2fe897 + bc9073d + patch-inspector idempotency); needs a CI run to confirm
- No auto-updater wired (tauri-plugin-updater) — phase 2
- Unsigned binaries (SmartScreen / Gatekeeper) — documented in FAQ + release notes

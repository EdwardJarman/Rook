# Rook Desktop — Live Progress

Last updated: 2026-09-05

## Where things stand
- **v0.2.1 installer built, installed, and verified on this machine** — 255 MB (was 654 MB), gateway healthy, window paints, history works.
- **Download flow: critic PASS** (round 2) — live version/size, hero CTA, honest phone handling, FAQ fixed.
- **Desktop app: critic round 1 FAIL → all findings fixed and builder-verified in the installed app** (banner copy, Start-a-chat navigation + delete confirm, RECENT history with restore, Account offline card, v0.2.1 shown). Round-2 critic was attempted 3× but is blocked by intermittent model capacity — retried between other work.
- **Bonus bug caught post-critic:** the Tauri store plugin buffers writes until save() — conversation persistence silently didn't flush to disk in the installed app (browser fallback worked, masking it). Fixed in store.ts (writeKv now flushes); final installer rebuilding.

## Loop state
| Piece | Round 1 | Fixes | Round 2 |
|---|---|---|---|
| Download flow | FAIL (8 bugs) | all fixed | **PASS** |
| Desktop app | FAIL (7 aspects) | all 6 re-verifiable findings fixed | running |

## What was built (commits 4dae847, ad5f0ac on main, unpushed)
See `docs/release-v0.2.1-runbook.md` for the single remaining manual step (push + tag — needs the user's GitHub token), and `docs/desktop-parity-roadmap.md` for the honest remaining gaps (real-AI streaming, model picker, voice, tray, auto-update, deep links, MCP).

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

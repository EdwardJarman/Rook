# Rook Desktop — Live Progress

Last updated: 2026-09-06, release day

## 🎉 v0.2.1 IS LIVE
**https://github.com/EdwardJarman/Rook/releases/tag/v0.2.1** is published with all 8 assets (Setup.exe 243 MB, both DMGs, AppImage, 4 CLI archives) and `releases/latest/download/...` now serves it. The live www.rook.lighting/download shows "Download for Windows · 243 MB · v0.2.1". The public CI-built installer was downloaded from the release, installed, launched, health-checked (gateway `{"ok":true}`), and it shows the full **sign-in screen** (Clerk) — sign-in now works for real users.

## What it took to ship (all fixed in CI)
1. Windows runners default to pwsh — bash-syntax steps died instantly; pinned `shell: bash`.
2. `@trpc/server` wasn't declared in rook-node deps — fresh CI installs failed the Vite build; declared it.
3. The sandbox install-test still expected the old "Rook Node" product name — updated to accept both.
4. Set the `VITE_CLERK_PUBLISHABLE_KEY` repo secret (the publishable test key the production site already ships) so the release build has working sign-in.

## Verified state
- Download flow: fresh-eyes critic PASS (round 2).
- Desktop app: round-1 FAIL → all findings fixed + verified; round-2 critic running against the signed-in build.
- Pipeline: all 4 build legs green; sandbox install-test green (silent install → layout → launch → gateway healthy).

## Remaining
- `docs/desktop-parity-roadmap.md`: streaming replies, model picker, voice, tray, auto-update, deep links, MCP.

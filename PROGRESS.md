# Rook Desktop — Live Progress

Last updated: 2026-09-06 (evening) — **v0.3.1 shipped: "Quiet" redesign + real AI backend + installer fix**

## v0.3.1 (latest)
1. **"Quiet" redesign** — light mode is white cream (#FAF9F4), dark mode is pitch black (#000, T3 Code-style); sidebar rebuilt as a quiet rail (New chat, working search with Ctrl+K, Recent chats, compact Workspace tools with an approvals badge, Account + Settings + one-line status at the bottom); workroom is a single centered column — borderless bot replies, ink user bubbles, round send button, folder/approvals chips in the composer footer, dot-grid welcome hero. Shipped as v0.3.0.
2. **Real AI backend fixed** — the desktop tRPC client was calling `http://tauri.localhost` (the shell origin) instead of the production API, so every chat reply degenerated to the offline echo even when signed in. api-base now defaults to https://www.rook.lighting when the origin isn't a Rook host, the Clerk session token is injected into the tRPC client from React context, and the offline fallback no longer tells signed-in users to sign in. Production `workroom.reply` verified reachable and auth-gated (401 unauthenticated).
3. **Installer upgrades fixed** — upgrading over an existing install produced a broken layout (sidecar/uninstaller missing) because the old binary name stayed locked and old-uninstaller deletions raced extraction. PREINSTALL now kills `rook-node.exe` too and clears the install dir (no user data lives there). Verified locally AND by installing the public v0.3.1 over v0.3.0: complete layout, gateway healthy.

## Critic verdicts
- Download flow: **PASS** (round 2).
- Desktop app: **PASS** (round 2) — all round-1 FAIL reasons fixed and independently verified.
- Flagged gap (needs your Clerk account): production Clerk instance + pk_live key in CI secrets removes the "Development mode" badge.

## Remaining (docs/desktop-parity-roadmap.md)
- Streaming replies (workroom.reply is request/response today), model picker, voice input, tray icon, auto-updater, deep links, MCP/connectors.

## v0.2.1 shipped
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

## Critic verdicts (final)
- Download flow: **PASS** (round 2).
- Desktop app: **PASS** (round 2; aspect scores 7–8/10, Claude/Codex win on polish margins only). All round-1 FAIL reasons fixed and independently verified: working sign-in, no dev-speak banner, no fake account controls, history + chat fixes shipped in the same release.
- Flagged remaining gap: the Clerk "Development mode" badge — the app uses the test-mode Clerk instance (identical to the production web app). Needs a production Clerk instance + pk_live key in CI secrets before wide distribution.

## Remaining
- `docs/desktop-parity-roadmap.md`: streaming replies, model picker, voice, tray, auto-update, deep links, MCP.

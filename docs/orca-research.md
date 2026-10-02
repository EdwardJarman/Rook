# Orca — Ultra Research

> **Sources:** https://www.onorca.dev/ and https://github.com/stablyai/orca — live fetched 2026-09-13. All claims cited to a page or raw file fetched this session. Prices/stats as of fetch date.

---

## TL;DR — What Orca actually is

**Orca (stablyai/orca)** is a **free, open-source Agent Development Environment (ADE)** — a desktop IDE for running a **fleet of CLI coding agents in parallel**, each isolated in its own `git worktree`. You bring your own Claude Code / Codex / Cursor CLI subscriptions — Orca sells no model, no hosted VPS, no credits. Built by **Stably AI (Lovecast Inc., San Francisco, YC-backed)**, MIT-licensed, 67.6k stars / 4.4k forks, daily-shipped (`v1.4.200` on 2026-09-11, `v1.4.197` pinned in `package.json`), available on **macOS, Windows, Linux** + **iOS/Android mobile companion**.

Think: *VS Code + Ghostty terminals + embedded Chromium + git worktree orchestration + mobile relay — re-imagined as an operating system for terminal-native agents.*

---

## 1. Company — Stably AI

*   **Identity:** https://stably.ai — *"AI E2E Testing to AI Orchestration"*. Two products: (1) Stably AI E2E Testing (credit-based SaaS for autonomous QA), (2) Orca ADE (this doc). Footer everywhere: *"New from Stably · Open source · MIT"*.
*   **Legal & HQ:** Operated by **Lovecast Inc.** per https://www.onorca.dev/privacy (2026-04-04). Footer on all orca pages: *"Built in San Francisco. Backed by Y Combinator. Stably AI. All rights reserved."* GitHub topics: `yc-backed`. X: https://x.com/orca_build, Discord: https://discord.gg/fzjDKHxv8Q, Blog: https://stably.ai/blog, Trust Center via Vanta.
*   **Team signal:** Engineering blog posts ship features daily; changelog shows 10,870 commits, 3.1k PRs, 2.8k issues — high velocity, public.

---

## 2. Orca Product — The 60-Second Pitch

Source: https://www.onorca.dev/docs, https://www.onorca.dev/, README.

> Orca is a **desktop IDE for running multiple AI coding agents side by side. Every task gets its own git worktree, its own agent terminal, and its own browser tab — so you can fan out work across Claude Code, Codex, Cursor CLI, and friends without stashing, branch-juggling, or losing flow.**

*   **When to use it (docs):** you want 3 agents racing the same bug and picking the winner; you want to review AI diffs before shipping; you already pay for Claude/Codex; you want agents off the laptop (SSH / self-hosted / cloud VM).
*   **Who it's for:** professional developers who read diffs and care about commits. *"Not a no-code tool, not a model, not a git replacement, not a hosted VPS."* Every worktree is a real `git worktree` — plain `git` still works via `cd`.
*   **Tagline on site:** *"Ship 100x with the agent IDE — Run Claude Code, Codex, and any other coding agent in parallel, each in its own worktree. Terminals, diffs, a browser, and a CLI, in one app built for agents."*

---

## 3. onorca.dev — Full Site Structure (live capture)

**Nav:** Logo → Docs / Changelog / Enterprise → Discord · X · 67.5k GitHub stars → Download. | **Footer:** Product (Download, Changelog, Enterprise, Docs) · Community (GitHub, Discord, X) · Company (Stably, Privacy, Terms) + YC badge.

**Hero (https://www.onorca.dev/):** Side-by-side pitch with mobile companion showcase (1,284 agents spawned, 142h agent time, 96 PRs in demo), worktree sidebar (5 agents on `checkout-flow-v2`), and resource wall of posters.

**Doc IA (https://www.onorca.dev/docs):**
*   Start Here: What is Orca? · Install · Your first 3-agent session *(most important)*
*   The Orca Model: Worktrees · Tabs, panes & split layouts · Agents & sessions · Session restore · Quick Open & Jump Palette
*   Working with Agents: Supported agents · Claude Code · GLM-5.2 · Codex · Cursor CLI · Hot-swap Codex accounts · Chat UI (native) · Session history · Hibernation · Usage & rate-limit tracking · Hooks & memory
*   Reviewing & Shipping: Diff viewer · Annotate AI Diff · Attribution · Commit & push · Hosted reviews/issues/Actions · Linear/Jira drawers
*   Editing: Monaco editor & autosave · Rich markdown · Viewers (HTML/Mermaid/PDF/image) · File explorer & drag-drop
*   Browser & Design Mode: Per-worktree browser · Design Mode · Browser-use profiles
*   Terminal, Remote & SSH: Ways to run Orca · SSH worktrees · Remote Orca Servers
*   CLI & Automation: Orca CLI overview · Reference · Orchestration · Scheduled automations · Computer use · Worktree checkpoints · Skills registry & MCP
*   Mobile · Notifications & Inbox · Recipes (5) · Settings Reference · Privacy & Telemetry · Troubleshooting

**Key subpages fetched:**
*   **Install** (https://www.onorca.dev/docs/install): DMGs (`arm64/x64`), Windows `.exe`, Linux AppImage/`.deb/.rpm` + `brew install --cask stablyai/orca/orca` + Arch AUR `stably-orca-bin`. Channel trick: `Shift+click` Check for Updates = RC, `Cmd/Ctrl+click` = perf builds, `Option+click` = local macOS validation. No opt-in persistence.
*   **First Session** (https://www.onorca.dev/docs/first-session): 6-step canonical loop: `Add Repo` (sets base ref `origin/main`) → `+ Create Worktree` (task-named or `marine creature` auto) → pick `start-from` ref → agent combobox → **Race** same prompt on 3 agents → **Split** tabs to edge → **Pick winner** via diff → **Ship** (commit/push, delete losers). Worktree creation is async.
*   **Worktrees** (https://www.onorca.dev/docs/model/worktrees): lifecycle Create→Work→Review(diff vs start-from)→Ship→Archive/Delete. Deps gap solved 3 ways: Settings Repository Shared Paths (APFS clone/symlink), `orca.yaml: worktree.sharedDirectories` (gitignored), `.worktreeinclude` (copy for `.env`). Sidebar grouping by project, filters, pin/archive/sleep, folder-workspaces for multi-repo/monorepo.
*   **Supported agents** (https://www.onorca.dev/docs/agents/supported): 30+ pre-configured; *any CLI agent works* (it's just a terminal). Deep integrations (Claude Code, Codex, Cursor CLI, Claude Agent Teams), hooks+status for Pi/OMP/Antigravity, auto for rest. Default **Yolo** (`--dangerously-skip-permissions` etc) because worktrees are disposable; global toggle at Settings→Agents.
*   **Mobile** (https://www.onorca.dev/docs/mobile): iOS App Store 6766130217 / TestFlight + Android APK 0.0.48. Paired via one-time code + Orca Relay (or LAN/Tailscale). Read-mostly remote: worktree list, file tree, chat vs terminal tab, Live char-stream, Quick Commands sync, browser Web/Mobile toggle, source control, push notifications mirroring desktop.
*   **Terminal** (https://www.onorca.dev/docs/terminal): xterm.js + Ghostty/Warp import, color contrast, OSC 52 clipboard (allowed for tmux/Neovim over SSH), panes/tabs with agent state, `Cmd-F` search, link popover (Orca Browser vs System), Copy Context/ID, kitty keyboard protocol (`Shift+Enter`), floating `Cmd+Option+A`, WSL dispatch, Quick Commands (Global/Project).
*   **CLI Overview** (https://www.onorca.dev/docs/cli/overview): `orca worktree|file|terminal|browser|tab profile|automations|artifacts|emulator` — snapshot-based automation (e.g. `goto/snapshot/click/fill/screenshot`, `set device "iPhone 12"`, iOS Simulator `tap/type/gesture/rotate/kill`). `npx skills add https://github.com/stablyai/orca --skill orca-cli`.
*   **Ways to Run** (https://www.onorca.dev/docs/ways-to-run): 4 modes — Local (desktop), SSH target (Run on picker), Remote Orca Server (`orca serve --pairing-address <tailscale-ip>`, multi-client, survives sleep), Cloud VM per-workspace (recipe in `orca.yaml` + scripts: Vercel Sandbox/Fly/Modal/Docker/SSH, Experimental + `orca-per-workspace-env` skill).

---

## 4. Features — End-to-End

*   **Parallel Worktrees** — Fan one prompt across N agents, each in an isolated `git worktree`; compare, merge winner. https://www.onorca.dev/docs/model/worktrees
*   **Terminal Splits** — Ghostty-class WebGL terminals, infinite splits, scrollback survives restarts. https://www.onorca.dev/docs/terminal
*   **Design Mode** — Real Chromium per worktree; click any element → HTML/CSS + cropped screenshot into the agent. https://www.onorca.dev/docs/browser/design-mode
*   **GitHub & Linear, Native** — Browse PRs/issues/Project boards in-app; open worktree from task. https://www.onorca.dev/docs/review/github
*   **SSH Worktrees** — Beefy remote box with auto-reconnect + port forwarding. https://www.onorca.dev/docs/ssh
*   **Annotate AI Diffs** — Comment diff lines → send back to agent. https://www.onorca.dev/docs/review/annotate-ai-diff
*   **Drag Files to Agents** — VS Code's Monaco, autosave, quick-open incl. hidden, drag/drop. https://www.onorca.dev/docs/editing/file-explorer
*   **Orca CLI + Computer Use** — `orca worktree create/snapshot/click/fill`; agents automate desktop UI. https://www.onorca.dev/docs/cli/overview, https://www.onorca.dev/docs/cli/computer-use
*   **Quick Open / Jump Palette / Split Anything** — Search across worktrees/files/agents/commands without leaving flow.
*   **Account Switcher & Usage Tracking** — Claude/Codex usage + rate-limit resets, hot-swap Codex accounts. https://www.onorca.dev/docs/agents/usage-tracking
*   **Mobile Companion** — Live agent status, usage, switch accounts, keep terminals moving. https://www.onorca.dev/docs/mobile
*   **Rich Repo Previews** — Markdown/images/PDFs/repo docs. https://www.onorca.dev/docs/editing/markdown
*   **Browser per Worktree + Profiles** — `set device`, profile create/set. https://www.onorca.dev/docs/browser/profiles

*Also: Commit & push, Attribution, Session restore/hibernation/history, Hooks & memory, Session notifications/inbox, Worktree checkpoints, Skills registry & MCP, Troubleshooting.*

---

## 5. Supported Agents — Bring Your Own Subscription

> *"Works with any CLI agent — if it runs in a terminal, it runs in Orca."*

**Pre-configured (30+):** Claude Code, Codex, Grok (x.ai), Cursor CLI, GitHub Copilot CLI, OpenCode, MiMo Code, Amp, OpenClaude, Antigravity, Pi, oh-my-pi, Hermes Agent, Devin, Goose, Auggie, Charm (Crush), Cline, Codebuff, Command Code, Continue, Droid (Factory), Kilocode, Kimi, Kiro, Mistral Vibe, Qwen Code, Rovo Dev, Autohand Code + any CLI agent. Each links to its install doc.

Orca pretends nothing about the model — it just runs the CLI the way you already authenticated it, side-by-side.

---

## 6. GitHub Repo — stablyai/orca (https://github.com/stablyai/orca)

*   **Stats (2026-09-13):** 67.6k stars, 4.4k forks, 123 watchers, 10,870 commits, 2.8k issues, 3.1k PRs, MIT ©2026 Lovecast Inc. Releases: `v1.4.200` (2026-09-11) is latest, `1.4.197` is `package.json` version. Artifacts: `Orca-1.4.200-mac.zip`, `mac-arm64`, RPM/AppImage/Deb, `latest-*.yml`.
*   **License & Roots:** `LICENSE` MIT. Root folders: `src/` (main/preload/renderer/shared/types), `mobile/` (Expo companion), `cloud/` (pairing relay, own pnpm workspace), `config/` (tsconfigs/oxlint/vitest/electron-builder/scripts), `native/` (macOS helpers, windows-registry), `resources/` (icons/tiles), `skills/` + `skill-guides/` + `skill-stubs/` + `orca.yaml`, `docs/`, `tests/` (Playwright + Vitest), `examples/plugins`, `Casks/`.
*   **Tech Stack (`package.json` 1.4.197):**
    *   Runtime: `electron 43.7.0`, Node `24`, `pnpm@12.0.0`, `typescript 7.0.2`
    *   Build: `electron-vite 5.0.0`, `vite=rolldown-vite 7.3.1`, `@vitejs/plugin-react 5.2`, `@tailwindcss/vite 4.2.4`, `esbuild 0.25.12`, `electron-builder 26.15.3`, `oxlint 1.8` + `oxfmt 0.65`
    *   Renderer: `react 19.2.8`, `react-dom 19.2.8`, `zustand 5.0.14`, `shadcn 4.13.1` + `radix-ui 1.6.2`, `lucide-react 0.577`, `tailwind-merge`, `cmdk`
    *   Editors/Terminals: `@xterm/xterm 6.1.0-beta.303` + addons (fit/webgl/web-links/serialize/ligatures/search/unicode11/headless), `monaco-editor 0.55.1` + `@monaco-editor/react 4.7`, `@tiptap 3.22.5` (+ markdown/tables/math/katex/lowlight), `mermaid 11.17`, `vscode-textmate+oniguruma`
    *   Main/Node: `node-pty 1.1.0`, `ssh2 1.17.0`, `@parcel/watcher 2.5.6`, `sherpa-onnx 1.12`, `ws 8.21`, `proper-lockfile 4.1.2`, `tldts`, `posthog-node 5.33`, `zod 4.5.4`, `yaml`, `tweetnacl`, `@anthropic-ai/claude-agent-sdk 0.3.251`, `electron-updater 6.8.9`
    *   Quality: `vitest 4.1.11`, `@playwright/test 1.59`, `happy-dom`, `react-doctor 0.9.1`, `knip 5.88`
*   **Architecture (`electron.vite.config.ts`):** Triple-process Electron: `src/main/index.ts` (main) + 2 preloads (`browser-window-close`, `doc-preview-link`) + `src/renderer/src` (React). 15+ main entries (daemon-entry unpacked for `fork()`, plugin-host, computer-sidecar, stt-worker, warp-theme-parser-worker, session scanners, WSL helpers, etc). Renderer has `index.html` + `popout.html` + `web-index.html` roots. Key subsystems: worktrees/Git (`GitCapabilityCache`, baseline 2.25), terminals (headless in main for serialization, WebGL in renderer), native chat (Claude Agent SDK + Codex behind `Experimental → Structured Chat`), `agent-browser 0.27`, SSH+WSL relay, mobile pairing via `orcad` (`cloud/`), computer macOS helpers.
*   **Build & Scripts:** `pnpm dev` → `run-electron-vite-dev.mjs` (+ `dev:web`), `build:desktop` = typecheck + relay + cli + electron-vite + web-from-renderer, `build:release` adds native, per-platform `build:mac/linux/win`. Requires `pnpm install:release --cpu=x64,arm64` before cross-arch pack.
*   **Skills & Plugins:** Bundled manifests generated/verified (`generate:skill-bundle-manifest --check`); stubs `skill-stubs/`, guides `skill-guides/`; install `orca skills install --skill orca-cli` (forwards through SSH shim from WSL/SSH). Auto agent detection fails if none.
*   **Docs:** `README.md` (hero + feature table + Supported Agents + Install + Community), `AGENTS.md` → `STYLEGUIDE.md` (monochrome quiet chrome, Geist 100-900, tokens in `src/renderer/src/assets/main.css`, shadcn primitives), `CLAUDE.md` is alias, `docs/reference/headless-linux-server.md` (Ub 20.04-24.04/Debian, `xvfb` on `:99`, `serve --port 6768 --pairing-address`, systemd `KillMode=mixed`, `orsa-ide` CLI alias, atomic rollback).
*   **Activity:** Daily ship, single source of truth is `https://github.com/stablyai/orca/releases` (changelog page mirrors it).

---

## 7. Business, Pricing, Enterprise, Privacy

*   **Pricing — Orca:** **Free, forever. Open source, MIT.** *"Free and open source for macOS, Windows, Linux"* on every Orca page. No credits, no paid tier — *"bring your own Claude/Codex/Cursor subscription — Not a model, Not a hosted VPS"*.
*   **Pricing — Stably AI (separate):** https://stably.ai/pricing — credit SaaS for testing (not Orca): Hobby `$0/mo` ($10 credits, 1 browser) → Team `$60/mo` ($60, 50 browsers) → Growth `$250/mo` ($250, 100 browsers) → Enterprise Custom (>$1k spend, SAML SSO, SLAs). Logos: Tesla, ClickHouse, Samsara, OpenArt.
*   **Download:** https://www.onorca.dev/download — Apple Silicon/Intel DMGs, Windows x64 `.exe`, Linux AppImage, `brew install --cask stablyai/orca/orca`, Arch `stably-orca-bin`, Mobile iOS App Store 6766130217 + TestFlight + Android APK 0.0.48 (https://github.com/stablyai/orca/releases/download/mobile-android-v0.0.48/app-release.apk).
*   **Enterprise:** https://www.onorca.dev/enterprise — Local-first, self-hostable, *"No model in middle"* (prompts direct to your providers), *"No silent changes"* (worktree → PR), Audit trail (git/PRs/activity), Your keys, Rollout guidance, SOC 2 Readiness via Vanta Trust Centre, SAML/SSO via Stably Enterprise.
*   **Privacy & Telemetry:** https://www.onorca.dev/docs/telemetry + https://www.onorca.dev/privacy — Local desktop, no account. **Never** collects: source code, prompts, agent/terminal output, file paths, repo/branch names, URLs, commit msgs, API keys, IPs/hostnames. Collects (anonymous, PostHog US): random local ID, version/OS/arch/channel, DAU/WAU, workspace creation method, agent kind enum, coarse error, whitelisted settings. Opt-out: Settings → Privacy OFF, or `DO_NOT_TRACK=1` / `ORCA_TELEMETRY_DISABLED=1`.
*   **Changelog:** https://www.onorca.dev/changelog — Daily; current `1.4.200` (2026-09-11) file-change rollups, task checklists, Claude subagent visibility.

---

## 8. Architecture & API — How It Fits Together

**Mental model:**
```
Your subscriptions (Claude Code, Codex, Cursor CLI, ...)
            ↓ (stdin/stdout in a pty)
Orca worktree (real git worktree: branch + files + terminals)
            ↓ (xterm headless ↔ WebGL, Monaco, Chromium per worktree)
Orca desktop (Electron main + renderer)
            ↓ (ssh2/WS or orca serve / cloud relay)
Remote host / Orca Server / Cloud VM (your infra)  ←→  Mobile companion (relay/LAN)
```

*   **Worktree = unit of isolation.** No stash/branch juggling — each agent gets its own checkout, its own agent session, its own browser tab, its own terminal splits.
*   **Terminal = xterm headless (serializable in main) + WebGL (renderer).** Ghostty/Warp theme import keeps muscle memory; OSC 52 enabled for tmux/Neovim over SSH.
*   **Browser = Chromium per worktree** (via `agent-browser`) for Design Mode + general browsing — `goto/snapshot/click/fill/screenshot` over CLI.
*   **Orca CLI = agent API.** Every UI action has a CLI mirror (`worktree ps/create`, `file open/diff`, `terminal list/read/send`, `browser goto/snapshot/click`, `emulator tap/type`). Agents self-orchestrate without custom SDKs.
*   **Mobile Relay = `cloud/` (orcad).** Token-per-device, desktop-is-source-of-truth, LAN fallback (Tailscale-friendly), push notifications mirror desktop.
*   **Skills = bundled manifests** (`skills/` + `generate:skill-bundle-manifest`). `npx skills add https://github.com/stablyai/orca --skill orca-cli` → global or `--local`.

---

## 9. Takeaways — What This Means for Rook

Orca validates the **"AI Orchestrator, not AI model"** thesis at scale: 67k stars without selling inference. Rook should not compete on `git worktree` cloning — Orca owns that niche — but Orca leaves a gap Rook already fills:

*   Rook = **mobile-first workroom + InstantDB sync + Excel/GitHub connectors + Approvals-as-UI** — Orca has none of the data-connectors, and its mobile app is *remote control*, not a first-class workroom.
*   **Closest overlap** is Orca's `worktree diff vs review` ↔ Rook's `Activity/Approvals`. Rook's approval gate (counter-signed budgets, human-in-loop) is a stronger opinion than Orca's "ship the winner" — keep it.
*   **Opportunity:** Orca's `orca.yaml: worktree.sharedDirectories` + `.worktreeinclude` solved the "deps-per-worktree are slow" problem — Rook's future desktop FileBridge can copy the APFS clone + symlink + copy trinity instead of reinventing it.
*   **No threat to terminology:** Orca owns *worktree/agent/session*; Rook owns *Bot/Room* — no collision.

---

## 10. Sources — Every URL Fetched This Session

*   https://www.onorca.dev/ (homepage)
*   https://www.onorca.dev/docs (IA + What is Orca?)
*   https://www.onorca.dev/docs/install
*   https://www.onorca.dev/docs/first-session
*   https://www.onorca.dev/docs/model/worktrees
*   https://www.onorca.dev/docs/agents/supported
*   https://www.onorca.dev/docs/mobile
*   https://www.onorca.dev/docs/terminal
*   https://www.onorca.dev/docs/cli/overview
*   https://www.onorca.dev/docs/ways-to-run
*   https://stably.ai
*   https://stably.ai/pricing
*   https://www.onorca.dev/download
*   https://www.onorca.dev/changelog
*   https://www.onorca.dev/enterprise
*   https://www.onorca.dev/docs/telemetry
*   https://www.onorca.dev/privacy
*   https://github.com/stablyai/orca
*   https://raw.githubusercontent.com/stablyai/orca/main/README.md
*   https://raw.githubusercontent.com/stablyai/orca/main/package.json
*   https://raw.githubusercontent.com/stablyai/orca/main/AGENTS.md
*   https://raw.githubusercontent.com/stablyai/orca/main/CLAUDE.md
*   https://raw.githubusercontent.com/stablyai/orca/main/LICENSE
*   https://raw.githubusercontent.com/stablyai/orca/main/electron.vite.config.ts
*   https://raw.githubusercontent.com/stablyai/orca/main/docs/reference/headless-linux-server.md (partial, via stack)
*   https://github.com/stablyai/orca/releases (referenced)
*   Plus GitHub API stats surfaced via GitHub nav (stars/forks/commits/issues/PRs)

*28 distinct sources fetched or directly sub-fetched. Captures saved in session; raw site is ~15k tokens alone.*


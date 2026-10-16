# Orca → Rook — Deep Extraction & Build Plan

> **Scope:** Everything actionable in https://github.com/stablyai/orca (MIT, `v1.4.200` latest, `v1.4.197` in `package.json`) and https://www.onorca.dev/ — distilled for porting into **Rook** (Expo 54 + InstantDB + Vercel + Rook Node / Tauri). Live fetched 2026-09-13. 35+ distinct Orca URLs/raw files. No Orca code copied verbatim; this is a rewrite-oriented spec.

---

## 0. How to read this doc

*   **Left:** what Orca built (with exact file refs or doc URLs).
*   **Right:** what Rook should build, in Rook's stack, ranked **P0 (ship next) / P1 (next quarter) / P2 (later / nice-to-have)**.
*   **File refs** are `stablyai/orca` paths — search them directly to verify. Rook equivalents are proposed, not existing.

**Why Orca matters for Rook:** Orca is the **existence proof** for the "AI Orchestrator, not AI model" thesis at scale (67.6k stars, no inference sold, bring-your-own Claude/Codex). Worktree + terminal + browser + relay is *solved* there. Rook's defensible wedge is *not* cloning that — it's the **mobile-first workroom + InstantDB sync + Excel/GitHub connectors + approval-mediated data work** that Orca has zero of. This doc extracts Orca's solved half so Rook can **reimplement the pattern correctly once**, instead of rediscovering it slowly.

---

## 1. Codebase Architecture Inventory

### 1.1 Runtime triple (Electron)

*   **Main:** `src/main/index.ts` (Electron main) + ~15 bundled helpers.
*   **Preloads (2, sandboxed):** `browser-window-close`, `doc-preview-link`.
*   **Renderer:** `src/renderer/src` (React 19). Entries: `index.html` (main window), `popout.html` (second root dashboard), `web-index.html`. `preserveEntrySignatures: strict` prevents chunk bleed.
*   **Key forked helpers:** `daemon-entry` (asar-unpacked `fork()`), `plugin-host-entry`, `computer-sidecar`, `stt-worker`, `warp-theme-parser-worker`, `session-scanner*` (x3), `wsl-transcript-fs`, `port-scan-command-worker`, `parcel-watcher-process` (forked `ELECTRON_RUN_AS_NODE` to isolate `@parcel/watcher` faults #7547), `main-thread-hang-watchdog` (worker thread), `agent-hooks/*`, `codex/managed-home-shell-preflight`, `claude-accounts/keychain`.

**Rook takeaway (P1):** Keep Rook Node's single-binary simplicity; do *not* import Orca's 15-entry sprawl. The one piece worth stealing is the **isolation pattern** — `parcel-watcher-process` and `main-thread-hang-watchdog` show where to fork when a dependency is crash-prone. When Rook adds file watching or native pty, apply the same fork-if-crashes rule.

### 1.2 Build system (`electron.vite.config.ts` — verify: `Select-String "electron.vite.config" docs/orca-extraction-rook.md`)

*   **Build:** `electron-vite 5.0.0` + `vite=rolldown-vite 7.3.1` + `@vitejs/plugin-react 5.2` + `@tailwindcss/vite 4.2.4` + `esbuild 0.25.12` + `electron-builder 26.15.3`.
*   **Key config:** `BUNDLED_MAIN_DEPENDENCIES = @xterm/headless, @xterm/addon-serialize, tldts, zod` → `externalizeDeps.exclude`; rest external via `isExternalMainModule()` (builtins + `electron` external, `resources/node_modules` for native). `daemon-entry.js` unpacked (asar unreachability). `minify: 'oxc'`, `sourcemap: 'hidden'` (uploaded, not shipped). Compile-time gates: `ORCA_BUILD_IDENTITY='stable'|'rc'` and `ORCA_POSTHOG_WRITE_KEY` as `define` literals; missing → `IS_OFFICIAL_BUILD=false` short-circuits telemetry.
*   **Scripts:** `pnpm dev` → `run-electron-vite-dev.mjs` (+ `dev:web` vite); `build:desktop` = typecheck + relay + cli + electron-vite + web-from-renderer; `build:release` adds `build:native` + `verify:computer-native`; `install:release --cpu=x64,arm64` before cross-arch pack.

**Rook takeaway (P2):** Rook Node already uses `vite 7.3.1` + `tauri` — no change needed. Steal the *env-gated build identity* pattern for Rook's own PostHog key guard.

### 1.3 Folder structure (live `stablyai/orca` root)

`src/` (main/preload/renderer/shared/types) · `mobile/` (Expo companion, separate `.oxlintrc`) · `cloud/` (pairing relay, own pnpm workspace) · `config/` (tsconfigs, oxlint, vitest, electron-builder, scripts) · `native/` (macOS helpers, windows-registry) · `resources/` · `skills/` + `skill-guides/` + `skill-stubs/` + `orca.yaml` · `docs/` · `tests/` (Playwright `electron-headless/headful`, vitest) · `examples/plugins` · `Casks/` · `.husky` / `.github`.

### 1.4 Dependencies — the stack that matters

*   **Desktop:** `electron 43.7.0`, `react 19.2.8`, `zustand 5.0.14`, `shadcn 4.13.1` + `radix-ui`, `lucide-react`, `tailwind 4.2.4`.
*   **Terminals/editors:** `@xterm/xterm 6.1.0-beta.303` + 5 addons (`fit,webgl,web-links,serialize,ligatures,search,unicode11,headless`), `monaco-editor 0.55.1`, `@tiptap 3.22.5` (markdown/tables/math/katex/lowlight), `mermaid 11.17`.
*   **Native:** `node-pty 1.1.0`, `ssh2 1.17.0`, `@parcel/watcher 2.5.6`, `sherpa-onnx 1.12`, `ws 8.21`, `proper-lockfile`, `tldts`, `posthog-node 5.33`, `zod 4.5.4`, `yaml`, `tweetnacl`, `@anthropic-ai/claude-agent-sdk 0.3.251`, `electron-updater 6.8.9`.
*   **Quality:** `vitest 4.1.11`, `@playwright/test 1.59`, `oxlint 1.8` + `oxfmt 0.65`, `knip 5.88`, `react-doctor 0.9.1`.

**Rook diff:** Rook is lighter by design (no Electron triple, no xterm headless in main). When Rook needs pty/ssh, reuse `tauri-plugin-shell` / `portable-pty`, not `node-pty` + Electron main.

---

## 2. Core ADE Systems — What to Clone in Spirit

### 2.1 Worktree Orchestration

**What:** Every task = isolated `git worktree` (own branch, files, terminals, browser tab). Parallel agents never collide — fan one prompt across 5, pick winner.

**How (Orca, `src/main/repo-worktrees.ts`, `worktree-create-*.ts`, `git/worktree-create-preparation.ts`, `worktree-trash.ts`, `shared/worktree/create-types.ts`):**
*   Create is **async/background** with progress row + cancel/retry. Start-from picker: baseRef | local branch | commit SHA | remote branch (fetch). Core types: `Repo {path, connectionId, kind}`, `Worktree {branch, startFromRef, baseRef (origin/main), worktreePath, workspaceRoot}`, `PreparationEntry`.
*   **Dependency gap — the trichotomy (critical):**
    1. **Settings → Repository → Worktree Shared Paths** (per-user, APFS clone-copy on macOS else symlink)
    2. **`orca.yaml: worktree.sharedDirectories[]`** (repo-checked, gitignored dirs only, e.g. `node_modules`, `.cache`, additive to #1)
    3. **`.worktreeinclude`** (gitignored files/dirs to **copy** not symlink, literal paths only, e.g. `.env`, `.vscode/settings.json`; globs warn)
*   Lifecycle extras: emoji names (`:rocket:` → `rocket`), parent-workspace nesting, multi-select, `Cmd+Shift+Backspace` delete, `Resource Manager → Clean up workspaces`, `Non-Orca worktrees` discovery for external `git worktree add`, preserved branches review on refused delete.
*   **Folder workspaces:** multi-repo parent-folder import → project group; `+ Create Folder Workspace` at group header binds task-source to one child repo.

**Port to Rook — P0:**
*   Add **`rook.yaml: worktree.sharedDirectories`** + **`.rookinclude`** (copy literals) to Rook Node's workroom init. Use Rust `git2` `worktree add` + Tauri `fs` — APFS clone via `clonefile` on macOS, symlink elsewhere, copy for `.rookinclude`. Background task with TanStack progress row. This single pattern solves "cold `node_modules` per workroom is slow" without reinventing.

**Port — P1:**
*   Folder workspaces for monorepos (parent-dir project group + `taskSourceRepoId` pointer).

### 2.2 Tabs, Panes & Split Layouts

**What (https://www.onorca.dev/docs/model/tabs-panes-splits):** Drag-to-split pane tree per-worktree; tabs grouped in panes.

**How:** Right-edge→horizontal, bottom→vertical, nestable; boundaries pinned & saved per-worktree. Types: terminal/editor/browser/diff/PR. Drag reorder, `Cmd+Shift+]/[` next/prev, `Cmd+Opt+]/[` same-type, `Ctrl+Tab` recent. Intra-terminal split via tab menu. Swapping worktree swaps entire tree. Renderer Zustand store (`src/renderer/src/app-shell/` + `store/`).

**Port — P1:** Same model over `allotment`/`flexlayout-react` in Rook's Tauri WebView; serialize layout per workroom in `localStorage`/SQLite. No `BrowserView`.

### 2.3 Terminal

**What (https://www.onorca.dev/docs/terminal):** xterm.js (VS Code's) + WebGL, Ghostty/Warp theme import, scrollback that survives restarts, kitty keyboard, WSL dispatch.

**How (`src/renderer/src/components/terminal/`, `src/main/pty/*`, `src/main/wsl.ts`, `terminal-history.ts`):**
*   Renderer: `xterm@5 + webgl/search/fit/unicode/ligatures` (`background-terminal-worktree-mount.ts`, `active-terminal-repair.ts`), `Cmd-F` find, link popover (`Cmd-click` bypass), Copy Context/ID, floating `Cmd+Opt+A` global panel.
*   Main pty: `node-pty` with `shell-wrapper-file-writer.ts` / `zsh-startup-wrapper-builder.ts` / `terminal-history.ts:injectHistoryEnv()` — `HISTFILE` / `ORCA_HISTFILE` per `worktreeHash = hashWorktreeId(id)` under `~/.orca/history/<hash>/` (fish/bash/zsh/pwsh dispatch). `terminal-scrollback-snapshots.ts` + `terminal-history-gc.ts`. WSL: `wsl.exe -d <distro>` for `\\wsl.localhost\…`, `buildWslExecArgs`, `wsl-availability.ts`; SSH via persistence-pty.

**Port — P0:**
*   Isolate `HISTFILE` **per workroom** via `hashWorkroomId` under `appDataDir/rook/history/`. WSL via `tauri-plugin-shell` spawning `wsl.exe`. Advertise kitty keyboard (`Shift+Enter`). This is the one-line change that prevents cross-workroom shell-history bleed Orca already solved.

### 2.4 Browser & Design Mode

**What (https://www.onorca.dev/docs/browser/design-mode, https://www.onorca.dev/docs/browser/overview):** Real Chromium `BrowserView` per worktree; Design Mode click → HTML/CSS + cropped screenshot → agent.

**How (`src/main/browser/`, `src/renderer/src/components/browser/*`, `src/main/runtime/rpc/methods/browser*.ts`, CDP):** Per-worktree `BrowserView` tabs, fuzzy address bar, `target=_blank` → new Orca tab, lazy inactive load, viewport emulation via CDP, profiles (cookies/localStorage/UA), link-routing `Orca vs System` (invert via `Shift+Cmd-click`), remote traffic routing (`This device` vs `Server (streamed)`). Design Mode picker highlights element, captures `outerHTML + neighborhood`, computed CSS, cropped screenshot, sourcemap `file:line`, multi-note tray, ships as single attachment to active agent for hot-reload loop. CLI drives same tabs `snapshot/click/fill/screenshot`.

**Port — P0 (Design Mode):** Reimplement over Tauri `webview` per-workroom (or `wry` child webview) with per-workroom partition. Inject content-script capturing `getComputedStyle` + `outerHTML` + `devicePixelRatio` crop via `captureVisibleTab`. No CDP — emulate viewport via CSS meta. Instant ROI for Rook's "AI fixes UI bugs" story.

### 2.5 Diff Viewer + Annotate AI Diff

**What (https://www.onorca.dev/docs/review/diff-viewer, https://www.onorca.dev/docs/review/annotate-ai-diff):** Combined diff against `startFromRef` (Monaco), plus line-anchored batch feedback → agent.

**How (`src/renderer/src/components/diff/` / `review/` `diff-viewer.tsx`, `annotate-ai-diff.tsx`, `folder-workspace-diff-comments.ts`, Monaco + `--git-decoration-*` tokens in `src/renderer/src/assets/main.css`):** Combined staged+unstaged+untracked, toggle numbers, image diff (side-by-side/swipe/onion), HTML eye → side browser, 3-way merge, `s` stage hunk (`git add -p`), whitespace reveal, per-Settings word-wrap, collapsible tree (remembered), `j/k/n/p/F7` nav, scope switch (any commit/branch/baseRef). Annotate: hover gutter `+` or `c`, markdown comment pinned to line, `Cmd-Enter` save, tracks across edits, `Send to agent` batches all comments → `Send notes to` agent picker, `Resolve`.

**Port — P0 (Annotate):** Monaco `diffEditor` + `isomorphic-git`/`git2` diff, model `{id, path, line, body, resolved}` per workroom, `Send to agent` = prompt with `file:line` anchors → `terminal.send`. This is Orca's highest-ROI review primitive — Rook's `Activity/Approvals` can adopt it verbatim for AI-output review.

### 2.6 CLI & Computer Use

**What (https://www.onorca.dev/docs/cli/overview, https://www.onorca.dev/docs/cli/computer-use):** `orca` CLI *is* the agent API + native desktop automation via a11y tree.

**How (`src/cli/*` → `out/cli/index.js`, `src/main/runtime/rpc/methods/*`):** `status --json`, `worktree ps/create/current/set/rm`, `terminal list/read/send/wait/create/split`, `file open/diff/open-changed`, `tab profile list/create/set/clone`, `automations create/list/run/rm`, `artifacts share/update/list/delete` (opt-in 10MiB), `goto/snapshot (@e1 refs)/click/fill/screenshot/set device "iPhone 12"`, `emulator list/attach/tap/type/gesture/rotate/kill`. Computer: `orca computer permissions/capabilities, list-apps, get-app-state --app <bundleId> --json → treeText + screenshot.path` (sparse index), `click/set-value/type-text/press-key/hotkey/paste-text/scroll/drag`, `--value-stdin`, `--no-screenshot`, `--restore-window`, loop `snapshot→act→snapshot`.

**Port — P2:** Tauri CLI (`clap`) to `tauri-plugin-ipc` / localhost http `rook rpc`; `snapshot` via UI Automation (Windows) / AX (macOS). Register via Settings→General equivalent. Not P0 — Rook's approval-mediated tool loop already covers safe automation.

---

## 3. Collaboration & Remote Systems

### 3.1 Hosted Reviews — GitHub / Linear / Jira

**What (https://www.onorca.dev/docs/review/github, https://www.onorca.dev/docs/review/linear):** In-app PR/issue/Project board → open worktree from task.

**How:** Settings→Integrations auth (`gh` deepest). Branch context row → Create PR (base/title/draft); Checks panel streams bridge/child logs + 8 emoji reactions + `Fix broken checks→agent`; Stacked PRs: `Stack this PR above #N` → GH Stack + sidebar map + `Merge through #N · M PRs`. Linear: Settings→PAT → pick teams, combined GH+Linear drawer, `Has Workspace` filter, paginated `Load more`, per-workspace filters persist, `Issue` field (paste URL), agents on `orca linear` skill. Jira same surface, Bitbucket/Azure/Gitea parity.

**Port — P0 (GitHub inbox):** Rook has worktree but no PR inbox. Clone: `rook review` drawer (InstantDB mirror + local `gh`) + Checks panel. *Incremental:* add Linear drawer as tab beside GH — reuse workroom creator flow, pre-fill branch, feed images. Orca's `Stack this PR` map is gold for multi-bot branches.

### 3.2 SSH Worktrees

**What (https://www.onorca.dev/docs/ssh):** Laptop Orca owns runtime, remote host runs `git worktree`+agents over SSH.

**How (targets):** Settings→SSH → Add Target (host/user/port/identity or import `~/.ssh/config` with `Include`); `Test`→Save. Host-key via `known_hosts` (first-contact save, `StrictHostKeyChecking`, `ssh-keygen -R` on mismatch). Advanced: Proxy/Jump, multiplex `Reuse SSH connection` (OpenSSH macOS/Linux), in-memory passphrase TTL, persisted metadata when offline, **leased PTYs** surviving app close (5m grace), SFTP download, `/proc/net/tcp` port detector (`Cmd+Shift+I` Ports tab, privileged→10080), reconnect scrollback replay. Transports: built-in `ssh2` + system OpenSSH fallback for GSSAPI/FIDO2 `*-sk`.

**Port — P1:** Rook Node today is SSE/WS — add SSH as alternate `Run on` target, reuse Node relay for PTY lease, import `known_hosts` verification (Rook lacks it).

### 3.3 Remote Orca Servers (Advertise Model)

**What (https://www.onorca.dev/docs/remote-servers):** Remote machine owns *full* runtime, clients are pure UI + multi-client share.

**How (advertise/pair):** **Token-per-device**: server Settings→Remote Orca Servers→Advertise→New Link→ pick Tailscale IP `100.x.y.z` → `Generate Access Link` (`orca://pair?code...`) — one revocable token per client under Shared Server Access. Requires Tailscale/WireGuard/LAN. Alt `orca serve --pairing-address <tailscale-ip> [--port 6768]` prints `Bound endpoint`/`Advertised endpoint`/`Pairing URL`; `--mobile-pairing` QR. `Advanced→Active Server` routes new projects/mobile/browser there. Disconnect: server keeps agents; client reattaches pane state.

**Port — P0:** **Direct upgrade path.** Rook Node is *already* a server — but lacks per-device revocable pairing and the **bound vs advertised** split. Adopt `rook-node advertise` + token revocation table (InstantDB `pairing_grants`) so a behind-NAT/Tailscale node can advertise correctly. Solves Docker/Tailscale port mismatch complaints.

### 3.4 Ways to Run + Cloud VMs (https://www.onorca.dev/docs/ways-to-run)

Four modes: Local (desktop) | SSH target | Remote Server | **Cloud VM recipe** (`orca.yaml` lifecycle scripts `create/suspend/resume/destroy`; Settings→Experimental→Cloud VM → `Use the orca-per-workspace-env skill`; BYO provider Vercel Sandbox/Fly/Modal/Docker/SSH; `Orca server` vs `SSH` connection). Recipe must be on project's *primary* checkout to appear in `Run on`.

**Port — P1:** `rook.yaml` recipe for **ephemeral Fly/Modal per-bot workspace** — disposable chromium profile per bot. Rook's relay already prints pairing URL; recipes just emit `rook serve` URL.

### 3.5 Mobile Companion & Orca Relay (`cloud/`)

**What (https://www.onorca.dev/docs/mobile + https://raw.githubusercontent.com/stablyai/orca/main/cloud/README.md):** iOS (App Store 6766130217 / TestFlight) + Android APK 0.0.48. Read-mostly remote: worktree list, file tree, Chat UI ↔ terminal per-tab, Mermaid, copy/paste, `Tab/Shift+Tab` accessory, `Live` keystroke streaming, photo/file/mic attach, Quick Commands synced, Source Control (stage/commit), browser Web/Mobile switch, host switcher, multi-host New Workspace.

*   **Pairing:** Desktop account menu → one-time code → phone Pair (deep link). **Prefer Orca Relay** (auth required) with optional LAN picker; LAN needs explicit address. **Token-per-device** persisted; versioned protocol gates (update prompts). Relay mode follows desktop Relay conn; LAN drops when desktop closes.
*   **Relay (`cloud/`):** `packages/relay-contract` + `apps/relay` (`ORCA_RELAY_ROLE=director|cell`), `apps/relay-fence-broker` (lease), `apps/relay-ops` console, 25 `cloud-*.yml` workflows gated `vars.ORCA_CLOUD_OPERATIONS_ENABLED`, Terraform `infra/terraform` (cells/director/Cloud SQL/DNS), `pnpm test` SQLite suites. Director+cells splice: desktop+phone both outbound, never direct.

**Port — P0:** Adopt **LAN vs Relay hybrid + token-per-device**. Rook's mobile workroom exists but lacks this: try LAN WS for low latency, fallback to Vercel relay; persist token-per-phone (not shared QR). Port Chat UI toggle & per-tab overrides.

### 3.6 Notifications, Inbox & Usage Tracking

*   **Notifications (https://www.onorca.dev/docs/notifications + `cloud/README.md`):** System notification+sound+worktree chip on `working→idle`; bell inbox + Dock badge, mark unread, per-category tuning, custom MP3/WAV/OGG. Mobile push via `apps/push` gateway (APNs + FCM via SA, PostgreSQL prod / SQLite dev, per-host quotas); desktop mints 24h session via X25519 challenge (same key as Relay), registers phone push token, queues one event per notification. Contracts: `packages/push-contract`, `relay-contract`.
*   **Usage (https://www.onorca.dev/docs/agents/usage-tracking):** Reads `~/.claude`, `~/.codex` local FS (no API calls) — active-account usage, 80% warning, `Usage` popover (Detailed/Compact, sorted tightest-first, reset timers 5h/daily/weekly), Mobile Accounts + Codex reset-credit spend (journaled no double-spend).

**Port — P1:** Add **idle signal** from Rook Node sidecar (working→idle) + push gateway (reuse InstantDB today) + read sidecar's Claude/Codex usage files for Rook's footer **usage chip** — huge visibility win for multi-bot cost.

### 3.7 Headless Linux Server

*   **Ref (https://raw.githubusercontent.com/stablyai/orca/main/docs/reference/headless-linux-server.md):** Ubuntu 20.04-24.04/Debian (glibc 2.31+), `xvfb` auto `:99` if no DISPLAY, `LIBGL_ALWAYS_SOFTWARE=1`, apt `t64` renames, AppImage `SQUASHFS_ROOT drwx------` fix, `serve --port 6768 --pairing-address 100.x` → ready JSON `{"type":"orca_server_ready","schemaVersion":1,"boundEndpoint","advertisedEndpoint","pairing":{...}}` (`--json`/`--recipe-json`), systemd units `orca-serve.service` (`KillMode=mixed`, `RestartPreventExitStatus=3`) + optional `orca-xvfb.service`; user `orca`, CLI shim `~/.local/bin/orca`.

**Port — P1:** Copy `orca-serve.service` template & `serve --json` ready contract for Rook's Node daemon — fixes `bound vs advertised` gap, `KillMode=mixed` PTY survival, safe atomic upgrade/rollback.

---

## 4. Auxiliary Systems

### 4.1 Skills Registry & MCP (https://www.onorca.dev/docs/cli/skills)

*   **7+ installable skills:** `orca-cli`, `orchestration`, `computer-use`, `orca-linear`, `orca-emulator`, `orca-emulator-android`, `orca-per-workspace-env` + legacy `linear-tickets`. + MCP registry at Settings→Integrations→MCP.
*   **How:** Hybrid stubs — `npx skills add https://github.com/stablyai/orca --skill <name> --global` installs thin `SKILL.md` that forces agent to run `orca skills get <topic> [--full|--json]` for version-matched guide (flags live in binary, can't drift). Resolver: `ORCA_CLI_COMMAND` > `orca-dev` (if `ORCA_DEV_REPO_ROOT`) > `orca-ide` on Linux (GNOME Orca collision) > `orca`. Update: app background `npx --yes skills update <names> --global -y`. Sharing: `Skills → Share skills` publishes immutable bundle behind revocable unlisted link + digest; `orca skills share --skill frontend --bundle-name` (gated `Allow agents to publish`). **Files:** `skills/<name>/SKILL.md` (projection), `skill-guides/<name>.md` (source truth), `skill-stubs/<name>.md` + `skill-stub-composition.mjs` shared fragment, `src/cli/bundled-skill-guides.ts` (generated embed), `config/scripts/generate-bundled-skill-guides.mjs --write/--check`.
*   **Verification ratchets:** `verify:bundled-skill-guides`, `verify:skill-bundle-manifest`, `verify:built-skills-cli` (part of `lint`+`build:desktop`).

**Port — P2:** Single-source generator as CI ratchet. Replicate `skills get` live serve + `install --dry-run --json` for headless/CI; add `skills installed --json` safe selectors. Consider `rook.yaml` recipe like `orca-per-workspace-env`.

### 4.2 Hooks & Memory (https://www.onorca.dev/docs/agents/hooks-memory)

*   Respect existing Claude/Codex conventions; surface worktree lifecycle + status. Per-repo: reads `.claude/` + `.codex/` hooks automatically in worktree. Hooks: `Settings → Repository → Hooks` (`pnpm install`, `direnv allow`). Memory: leaves `CLAUDE.md`/`AGENTS.md` untouched, visible in explorer. Status hooks: `Settings → Agents → Agent status hooks` reports working/waiting/done; `orca agent hooks status|on|off --json` live without restart (WSL relay gated). Durability: writes `{userData}/agent-hooks/endpoint.env` (POSIX) / `endpoint.cmd` (Windows) re-sourced each invocation → survives restart (no dead-port POST).

**Port — P2:** Reuse `endpoint.env` durability for Rook daemon + WSL; expose hook toggle via CLI JSON.

### 4.3 Telemetry & Privacy (https://www.onorca.dev/docs/telemetry + https://www.onorca.dev/privacy)

*   **Allowlist, not deny.** Anonymous PostHog Cloud US, random local ID, no IP/email/hostname/content. Only: lifecycle, repos/workspaces (how, not name/URL/path), agents kind enum, coarse error, whitelisted settings. **Never:** paths, URLs, branches, prompts, terminal, stack traces (local diagnostic bundle only). Opt-out: `Settings → Privacy` toggle (instant) OR `DO_NOT_TRACK=1` OR `ORCA_TELEMETRY_DISABLED=1` (any one, env overrides stored pref). `posthog-node@5.33`.

**Port — P1:** Adopt **strict allowlist + 3-way kill switch** for Rook; enforce no free-form strings in events.

### 4.4 Settings & Enterprise

*   **14 panes** searchable `Cmd-,`: General, Appearance, Git (GitHub Budget REST/Search/GraphQL via `gh`), Terminal (OSC 52), Quick Commands (global/project + host), Agents (permissions/status/skill freshness), Browser, Artifacts (opt-in public 10MiB), Integrations (GitHub/Linear/Jira/Bitbucket/MiniMax), Notifications, Voice (Parakeet/Zipformer/Whisper cloud), SSH, Remote Servers, Shortcuts, Repository (`worktree.sharedDirectories` + APFS), Floating Workspace, Plugins Experimental, Experimental (hibernation, dashboard).
*   **Enterprise (https://www.onorca.dev/enterprise):** Local-first, self-hostable (MIT), no model in middle, no silent changes (worktree+PR), audit trail, SOC 2 Readiness (Vanta Trust Centre), SAML/SSO via Stably Enterprise.

**Port — P2:** Mirror pane taxonomy; reuse `Cmd-,` search index; gate Artifacts off-by-default. Enterprise = same Rook binary, env-gated defaults — no fork.

---

## 5. Prioritized Rook Build Plan — What to Actually Build

> **Principle:** Don't become Orca. Steal the solved patterns, keep Rook's wedge (mobile workroom + InstantDB + Excel/GitHub + approvals).

| Rank | Build | Why | Effort | Orca file refs |
|------|-------|-----|--------|----------------|
| **P0** | **Worktree shared-dirs trichotomy** (`rook.yaml` + `.rookinclude`) | Fixes per-workroom cold checkout pain (node_modules, .env). Highest leverage, smallest diff. | S — Rust + Tauri fs | `src/main/repo-worktrees.ts`, `worktree-create-preparation.ts`, `orca.yaml` |
| **P0** | **History isolation per workroom** (`HISTFILE` per `hashWorkroomId` under `appDataDir`) | Prevents cross-workroom shell-history bleed Orca already solved. | XS | `src/main/terminal-history.ts`, `src/main/wsl.ts` |
| **P0** | **Design Mode (per-workroom Chromium)** | Instant "AI fixes UI bugs" demo. | M — Tauri webview + content-script | `src/main/browser/`, `src/renderer/src/components/browser/*` |
| **P0** | **Annotate AI Diff → agent** | Highest-ROI review primitive. | M — Monaco diffEditor | `src/renderer/src/components/diff/`, `annotate-ai-diff.tsx` |
| **P0** | **Remote: bound vs advertised + token-per-device** | Solves Docker/Tailscale port mismatch + shared-QR weakness. | S — InstantDB `pairing_grants` | `cloud/README.md`, `docs/remote-servers`, `docs/reference/headless-linux-server.md` |
| **P0** | **Mobile: LAN vs Relay hybrid** | Low latency on LAN, fallback to relay — Orca's key retention trick. | M | `cloud/README.md`, `https://www.onorca.dev/docs/mobile` |
| **P0** | **GitHub PR inbox drawer** | Rook has worktree but no review inbox. | S — `gh` + InstantDB mirror | `https://www.onorca.dev/docs/review/github` |
| **P1** | **SSH as `Run on` target** | Lets power users target GPU boxes without second runtime. | M — `ssh2` + known_hosts | `https://www.onorca.dev/docs/ssh` |
| **P1** | **Terminal splits + scrollback + kitty keyboard** | xterm headless→WebGL, OSC 52, floating `Cmd+Opt+A`. | M — xterm addons | `src/renderer/src/components/terminal/`, `src/main/pty/*` |
| **P1** | **Usage chip (read local Claude/Codex files)** | Cost visibility for multi-bot. | XS | https://www.onorca.dev/docs/agents/usage-tracking |
| **P1** | **Headless `rook serve` JSON ready contract + systemd** | Fixes PTY survival, atomic upgrade. | S | `docs/reference/headless-linux-server.md`, `src/main/browser/` |
| **P1** | **Folder workspaces (multi-repo groups)** | Monorepo ergonomics. | S | `https://www.onorca.dev/docs/model/worktrees` (folder section) |
| **P1** | **Notifications + push (idle signal + gateway)** | Agent-done pings, not just terminal idle. | M — APNs/FCM | https://www.onorca.dev/docs/notifications, `cloud/push` |
| **P2** | **Skills registry generator (CI ratchet)** | Single source of truth for skills. | S | `config/scripts/generate-bundled-skill-guides.mjs`, `src/cli/bundled-skill-guides.ts` |
| **P2** | **Pane layout per workroom** (drag-to-split allotment tree) | Full ADE layout vs current single-pane. | M | `src/renderer/src/app-shell/`, `store/` |
| **P2** | **CLI `rook` parity** (snapshot/terminal/computer) | Agent API. | M — clap + tauri-ipc | `src/cli/*`, `src/main/runtime/rpc/methods/*` |
| **P2** | **Cloud VM recipes (BYO Fly/Modal)** | Ephemeral per-bot workspaces. | M | `https://www.onorca.dev/docs/ways-to-run` + `orca.yaml` `environmentRecipes` |
| **P2** | **Linear/Jira drawer + stacked PRs** | Broader collaboration. | M | https://www.onorca.dev/docs/review/linear |

**Explicit non-goals (don't clone):**
*   Orca's 15-entry Electron main triple — Rook Node stays single binary.
*   Full `electron-builder` multi-arch pack — Rook Node already Tauri.
*   SOC 2 / SAML enterprise packaging (until a design partner asks).
*   Verbatim `STYLEGUIDE.md` tokens — Rook has its own Geist/shadcn theme; cherry-pick, don't fork.

---

## 6. File-Level Pointers — Where to Look

| System | Orca path | Rook home |
|--------|-----------|-----------|
| Worktree create | `src/main/repo-worktrees.ts`, `src/main/worktree-create-*.ts`, `src/main/git/worktree-create-preparation.ts`, `shared/worktree/create-types.ts` | `rook-node/src/core/node.ts` + Rust `worktree` module |
| Shared dirs | `src/main/repo-worktrees.ts` + `orca.yaml` + `.worktreeinclude` handling | `rook.yaml` + `.rookinclude` parser in Rust |
| Terminal pty | `src/main/pty/*`, `src/main/terminal-history.ts` | `rook-node/src/runtime/chromium.ts` (pty sidecar) |
| Browser/Design | `src/main/browser/`, `src/renderer/src/components/browser/*`, `agent-browser 0.27` | `rook-node/src/runtime/browser.ts` + content-script |
| Diff/Annotate | `src/renderer/src/components/diff/` / `review/` (`diff-viewer.tsx`, `annotate-ai-diff.tsx`) | `rook-node/src/app/components/review/` |
| CLI | `src/cli/*` → `out/cli/index.js` | `rook-node/src/index.ts` (`clap` + `tauri-plugin-ipc`) |
| Mobile/Relay | `cloud/` (`apps/relay`, `packages/relay-contract`, `relay-ops`), `mobile/` | `server/node-relay-routes.ts` + `rook-node/src/uplink/` |
| Headless serve | `docs/reference/headless-linux-server.md`, `src/main/browser/` port 6768 | `rook-node/src/gateway/server.ts` |

---

## 7. Sources — Every URL Fetched This Session

### Primary product
*   https://www.onorca.dev/ (homepage + hero)
*   https://www.onorca.dev/docs
*   https://www.onorca.dev/docs/install
*   https://www.onorca.dev/docs/first-session
*   https://www.onorca.dev/docs/model/worktrees
*   https://www.onorca.dev/docs/model/tabs-panes-splits
*   https://www.onorca.dev/docs/terminal
*   https://www.onorca.dev/docs/browser/design-mode
*   https://www.onorca.dev/docs/browser/overview
*   https://www.onorca.dev/docs/review/diff-viewer
*   https://www.onorca.dev/docs/review/annotate-ai-diff
*   https://www.onorca.dev/docs/review/github
*   https://www.onorca.dev/docs/review/linear
*   https://www.onorca.dev/docs/cli/overview
*   https://www.onorca.dev/docs/cli/computer-use
*   https://www.onorca.dev/docs/cli/skills
*   https://www.onorca.dev/docs/mobile
*   https://www.onorca.dev/docs/notifications
*   https://www.onorca.dev/docs/ssh
*   https://www.onorca.dev/docs/remote-servers
*   https://www.onorca.dev/docs/ways-to-run
*   https://www.onorca.dev/docs/agents/supported
*   https://www.onorca.dev/docs/agents/hooks-memory
*   https://www.onorca.dev/docs/agents/usage-tracking
*   https://www.onorca.dev/docs/telemetry
*   https://www.onorca.dev/docs/settings
*   https://www.onorca.dev/enterprise
*   https://www.onorca.dev/download
*   https://www.onorca.dev/changelog
*   https://www.onorca.dev/privacy
*   https://stably.ai
*   https://stably.ai/pricing
*   https://github.com/stablyai/orca
*   https://raw.githubusercontent.com/stablyai/orca/main/README.md
*   https://raw.githubusercontent.com/stablyai/orca/main/package.json
*   https://raw.githubusercontent.com/stablyai/orca/main/orca.yaml
*   https://raw.githubusercontent.com/stablyai/orca/main/AGENTS.md
*   https://raw.githubusercontent.com/stablyai/orca/main/CLAUDE.md
*   https://raw.githubusercontent.com/stablyai/orca/main/LICENSE
*   https://raw.githubusercontent.com/stablyai/orca/main/electron.vite.config.ts
*   https://raw.githubusercontent.com/stablyai/orca/main/docs/STYLEGUIDE.md
*   https://raw.githubusercontent.com/stablyai/orca/main/docs/reference/headless-linux-server.md
*   https://raw.githubusercontent.com/stablyai/orca/main/src/main/worktree-create-preparation.ts
*   https://raw.githubusercontent.com/stablyai/orca/main/src/main/terminal-history.ts
*   https://raw.githubusercontent.com/stablyai/orca/main/cloud/README.md
*   https://github.com/stablyai/orca/releases (referenced)

*42 distinct sources fetched or directly sub-fetched this loop. Previous ultra-research doc adds 28 more (no overlap needed).*

---

## 8. One-Pager for Rook's Next Month

If you build only **six things** next month, build these (all P0 above):

1. `rook.yaml` + `.rookinclude` shared-dirs trichotomy
2. Per-workroom `HISTFILE` isolation
3. Design Mode (Chromium per workroom)
4. Annotate diff → agent
5. Mobile LAN+Relay + token-per-device
6. `bound vs advertised` for `rook serve`

Each has a one-week vertical slice, a single Orca file ref to follow, and no Electron import. Together they move Rook from *"works on one machine"* to *"orchestrated desktop + mobile + remote"* — the exact leap Orca proved is the 10x.


# Rook

**Your computer, as your Bots' computer.**

Rook is a calm, Bot-first AI workroom. The Rook app (iOS, Android, and web) is
the control surface where you create Bots, hand them work, and approve
sensitive actions. **Rook Node** is the companion desktop app that turns your
own computer into your Bots' computer: it runs a supervised, version-pinned
Chromium on your machine under your account, so Bots can actually *do* things
— browse, fill forms, upload files — while you keep full visibility and veto
power.

| Piece | What it is | Where it runs |
| --- | --- | --- |
| **Rook app** | Expo (React Native / web) workroom: Bots, tasks, approvals, files, library | Phone or browser; web build deploys to Vercel |
| **Rook server** | tRPC API + relay queue + InstantDB persistence + auth | Vercel serverless functions |
| **Rook Node** | Tauri desktop shell + Node.js sidecar running a supervised Chromium | Windows / macOS / Linux installers |

---

## How it fits together

```
 Rook app (phone / web) ──tRPC──▶ Rook server (Vercel) ◀──HTTPS poll every ~3s── Rook Node
                                        |                                         |
                                  InstantDB (data)                     local Chromium (pinned)
                                        |
                                  Expo push alerts (approvals, completions)
```

* **Transport is an outbound HTTPS polling queue** (`POST /api/node/sync`).
  The node dials *out* every ~3 seconds: it posts results of finished commands
  and claims queued ones. No port forwarding — NAT and firewalls just work.
* **The node is the enforcement point.** Cloud commands go through the exact
  same `dispatch()` pipeline as local loopback traffic: protocol validation,
  replay protection, page-revision fencing, lease checks, and an SSRF network
  policy. A revoked node credential stops working immediately.
* **Sensitive actions need you.** Capabilities like form submission, uploads,
  purchases, and deletions are queued as `awaiting_approval`, fire an Expo
  push alert, and only become deliverable after you approve them. The approval
  is a short-lived grant bound to the page revision; the node still enforces
  expiry and one-time nonces locally at execution time.

### Connecting a computer (pairing)

The one-button flow, end to end:

1. Open **Rook Node** and press **Connect account**.
2. Your browser opens `http://127.0.0.1:37831/connect`, which forwards to the
   Rook web app at `/connect-node?state=…&port=…`.
3. Sign in if needed. The web app mints a **one-time pairing token**
   (`rkp-…`, 10-minute TTL) for your account and redirects your browser to
   `http://127.0.0.1:<port>/pair?token=…&state=…`.
4. The node validates the single-use `state`, exchanges the token for a
   durable credential via `/api/node/pair`, saves it, and the cloud uplink
   starts immediately — no restart needed. The desktop window flips to
   **Connected ✓** on its own.

Headless fallback (no browser available):

```bash
rook-node --pair rkp-… [--server https://www.rook.lighting]
```

Pairing links expire after 15 minutes; states are single-use and pruned.

---

## Repository layout

```
app/                  Expo Router screens (workroom tabs, sign-in/up, connect-node, download)
components/           Rook UI primitives (cards, pills, sheets) + app components
hooks/ lib/           Client hooks, theming, tRPC client, InstantDB client
server/               tRPC routers, relay routes, InstantDB data layer, auth
api/                  Vercel function entry (api/[...path].ts)
shared/               node-relay protocol shared by server AND node (dependency-free)
instant.schema.ts     InstantDB schema (nodes, pairing tokens, commands…)
rook-node/
  src/                Node sidecar (TypeScript):
    index.ts            CLI entrypoint (flags: --headless --no-launch --pair … --install …)
    core/node.ts        Execution authority: dispatch, leases, approvals
    gateway/server.ts   Loopback gateway: /connect, /pair, /healthz + local WebSocket control
    uplink/uplink.ts    Outbound HTTPS pair + poll client (the cloud uplink)
    runtime/chromium.ts Supervised pinned-Chromium launcher (Playwright)
    control/ files/ screens/ security/ state/ supervisor/ registry/
  web/                Desktop window UI (index.html + app.js)
  src-tauri/          Tauri shell (Rust): spawns/stops the sidecar, health probing
  tests/              Vitest suites incl. real-Chromium smoke + pairing flow
scripts/              Build/dev utilities (QR, Vercel build, InstantDB smoke)
docs/                 Ops docs (rook-node ops, Clerk, ChatGPT/OpenRouter/Excel integrations)
.github/workflows/    ci.yml · release-rook-node.yml · push-schema.yml
```
---

## Getting started

Prerequisites: **Node.js ≥ 22.5 (24 recommended)**, **pnpm 9.12**, and
**Rust (stable)** for the desktop shell.

```bash
# Web app + server (http://localhost:8081)
pnpm install
pnpm dev

# Type-check and test the web/server side
pnpm check && pnpm test

# Rook Node sidecar (separate terminal)
cd rook-node
pnpm install                 # also downloads the pinned Chromium via postinstall
pnpm test                    # 65 tests incl. a real-Chromium smoke run
pnpm typecheck
pnpm dev -- --headless --no-uplink     # loopback gateway only, prints the /connect URL
```

The sidecar gateway listens on `127.0.0.1:37831` by default. Useful endpoints:
`/connect` (pairing page), `/healthz` (`{"ok":true,"paired":…}`).

### Desktop shell (Tauri)

```bash
cd rook-node/src-tauri
cargo check                  # fast type check
cd .. && pnpm dlx @tauri-apps/cli@2 build --no-bundle   # full local build
# → src-tauri/target/release/rook-node.exe (+ staged sidecar & resources)
```

The shell spawns the sidecar next to the executable, points
`PLAYWRIGHT_BROWSERS_PATH` at the bundled Chromium, probes gateway health,
adopts an already-running healthy gateway instead of double-spawning, and
stops the sidecar (and its Chromium children) when you close the window.

---

## Configuration

**Server / app** (see `.env.example`; server-only values must never be
`EXPO_PUBLIC_*`):

| Variable | Purpose |
| --- | --- |
| `INSTANT_APP_ID` / `INSTANT_APP_ADMIN_TOKEN` | InstantDB project + admin access |
| `CLERK_SECRET_KEY` / `CLERK_PUBLISHABLE_KEY` | Authentication |
| `OPENROUTER_API_KEY`, `ORCAROUTER_API_KEY`, `BUILT_IN_FORGE_*` | AI model routing |
| `MICROSOFT_*`, `INTEGRATION_ENCRYPTION_KEY` | Excel integration OAuth + secret storage |

**Rook Node:**

| Variable | Purpose |
| --- | --- |
| `ROOK_NODE_SERVER_URL` | Rook server base URL (default `https://www.rook.lighting`) |
| `ROOK_NODE_DATA_HOME` | Data home for profile + SQLite (default `%APPDATA%\Rook\Rook Node`) |
| `ROOK_NODE_SECRET` | Explicit local gateway secret (else generated) |
| `PLAYWRIGHT_BROWSERS_PATH` | Chromium location (the shell sets this to the bundled copy) |

---

## Building & releasing Rook Node

Releases are cut by tag. Pushing `vX.Y.Z` triggers
`.github/workflows/release-rook-node.yml`, which builds the sidecar
(esbuild → `@yao-pkg/pkg`), stages the pinned Chromium as a Tauri resource,
compiles the shell, **smoke-tests the standalone sidecar**, builds installers,
runs a **silent-install + gateway-health test on a clean Windows runner**, and
publishes a GitHub Release titled **`Rook Node vX.Y.Z`** with stable asset
names:

* `Rook-Node-Setup.exe` — Windows x64 (NSIS)
* `Rook-Node-arm64.dmg` — macOS Apple Silicon
* `Rook-Node-intel.dmg` — macOS Intel
* `Rook-Node-x86_64.AppImage` — Linux x64

```bash
# Cut a release (versions live in rook-node/src-tauri/tauri.conf.json,
# rook-node/package.json, rook-node/src-tauri/Cargo.toml, rook-node/src/config.ts)
git tag vX.Y.Z && git push origin main vX.Y.Z
```

Builds are unsigned today: Windows SmartScreen shows "More info → Run
anyway", and macOS needs `xattr -cr "/Applications/Rook Node.app"` once.
Signing + notarization and the auto-updater are the next distribution steps
(see `docs/rook-node.md` for the full checklist).

---

## Safety & security model

* **Dedicated profile.** The node refuses to run if the Rook Chromium profile
  would collide with your personal Chrome/Edge/Firefox profile.
* **Sandbox stays on.** `--no-sandbox` is rejected outright.
* **Loopback-only control plane.** The gateway binds `127.0.0.1` and refuses
  non-loopback connections; the cloud path is outbound-only HTTPS polling.
* **Leases & fencing.** One device controls a Bot at a time; takeover bumps a
  fencing token so stale commands are dropped.
* **Approvals.** Sensitive capabilities require an explicit owner decision,
  delivered as a short-lived, page-revision-bound, one-time grant.
* **Replay protection.** Versioned envelopes with nonces and deadlines; stale
  or out-of-order commands are rejected locally.

---

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| SmartScreen / Gatekeeper warning | Unsigned build — "More info → Run anyway" / `xattr -cr` (see above) |
| "Not running — the node process did not open its gateway…" | Press **Retry**; if it persists, reinstall so the bundled Chromium matches |
| "This connect link is invalid or was already used" | Links are single-use and expire in 15 min — press **Connect account** again |
| Port 37831 busy after a crash | Reopening the app adopts the healthy gateway; closing it cleans up — or kill `rook-node-sidecar.exe` |
| Status stuck on "Starting…" (pre-0.1.6 builds) | Update to the latest release — the status UI was rebuilt to self-report |

---

## Docs

* `docs/rook-node.md` — node operations, pairing internals, distribution checklist
* `docs/clerk-setup.md` — authentication setup
* `docs/chatgpt-subscription.md`, `docs/openrouter-ai.md`, `docs/orcarouter-ai.md` — AI backends
* `docs/microsoft-excel.md` — Excel integration
* `design.md` — the Rook app's design system and screen inventory
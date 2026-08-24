# Rook Node — Operations & Distribution

Rook Node turns a user's own computer into their Bot computer. This document
covers how the control path works today and everything needed to ship
installers.

## Control path (current implementation)

```
Rook app (phone) ──tRPC──▶ Rook server (Vercel) ◀──HTTPS poll every ~3s── Rook Node
                                   │                                        │
                             Expo push alerts                    local Chromium (pinned)
```

- **Transport is an HTTPS polling queue.** Vercel serverless functions cannot
  hold long-lived WebSocket connections, so the node dials *out* on an interval
  (`POST /api/node/sync`): it posts results of finished commands and claims
  queued ones. Outbound-only means no port forwarding; NAT and firewalls just work.
- **Pairing (browser flow, primary)**: the node prints/opens
  `http://localhost:37831/connect`. One button opens the Rook web app at
  `/connect-node?state=…&port=…`; the signed-in owner's browser mints a
  one-time token (`nodes.createPairing`) and redirects to
  `http://localhost:<port>/pair?token=…&state=…`. The node validates the
  single-use `state`, exchanges the token for a durable credential via
  `/api/node/pair`, saves it, and the uplink starts immediately.
- **Pairing (code flow, fallback)**: `nodes.createPairing` in the app mints a
  `rkp-…` token; `rook-node --pair <token> [--server <url>]` exchanges it.
  Useful for headless machines where no browser is available.
- **Commands** are version-1 `CommandEnvelope`s built by the server
  (`buildCommandEnvelope`). Sensitive capabilities are queued as
  `awaiting_approval`, fire an Expo push alert to the owner's devices, and only
  become deliverable after the owner approves via `nodes.decideCommand`. The
  approval travels as a short-lived grant bound to the page revision; the node
  ingests it locally and still enforces expiry + one-time nonce at execution.
- **The node remains the enforcement point.** Cloud commands go through the
  exact same `dispatch()` pipeline as local gateway traffic: protocol
  validation, replay protection, page-revision fencing, lease checks, SSRF
  network policy. A revoked node's credential stops working immediately.

### Key files

| Side  | File | Role |
| ---   | ---  | ---  |
| both  | `shared/node-relay.ts` | relay types, token/secret helpers, envelope builder |
| server| `server/node-relay-routes.ts` | `/api/node/pair`, `/api/node/sync` |
| server| `server/db.ts` (relay section) | InstantDB persistence for nodes/tokens/commands |
| server| `server/routers.ts` (`nodes` router) | app-facing pairing, command queue, decisions |
| node  | `rook-node/src/uplink/uplink.ts` | pair + poll loop client |
| node  | `rook-node/src/core/node.ts` | execution authority (tab ops, approvals, leases) |

## Shipping installers — checklist

Ordered by lead time; start the slow items first.

1. **Apple Developer Program** ($99/yr) → Developer ID certificate for
   signing + notarization (`notarytool`). Without it macOS Gatekeeper blocks
   the installer outright. Longest procurement delay — do this first.
2. **Windows Authenticode code-signing certificate** (OV or EV). EV removes
   SmartScreen warnings immediately; OV builds reputation over installs.
3. **CI builds** (`.github/workflows/ci.yml` already type-checks the Tauri
   shell on Windows/macOS). Extend with a `tauri build` job per platform that
   attaches signed artifacts to a GitHub Release.
4. **Tauri updater** (`tauri-plugin-updater`, minisign-signed manifests).
   Required because the node pins a Playwright/Chromium version; old nodes must
   be pullable forward when the server bumps the supported protocol version.
5. **Download page** with OS detection, SHA-256 checksums, and the deep link
   `rook://pair?token=…` so the app can hand off pairing directly.
6. **Chromium bundling decision**: current default is fetch-on-first-run via
   the pinned Playwright CLI (checksummed download into the node data home).
   Keep this unless offline-first install becomes a requirement.

## Local development

```bash
# web app + server
pnpm install && pnpm dev

# node sidecar (separate terminal)
cd rook-node && pnpm install && pnpm test          # 58 tests incl. Chromium smoke
npx tsx src/index.ts --headless --no-uplink        # loopback gateway only
```

Pair a real computer:

```bash
# in the app (or via tRPC playground): nodes.createPairing → { token }
npx tsx src/index.ts --headless --server http://localhost:3000 --pair rkp-…
```

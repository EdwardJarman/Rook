# Rook Computer (your device + cloud)

One computer abstraction for your Bots: **your own paired device (Rook Node) is
the computer; the free cloud sandbox is the overflow when it's offline.** This
is the Grok-Bot-style model — agents share a computer with a shell and
filesystem, and separate bots get separate workspaces — without renting an
always-on VM.

## How it works — the hybrid routing

Every computer action (shell commands, file reads/writes, listings) is routed
by the server:

1. **An online paired device?** The action runs there, on your hardware, inside
   that device's Rook Node (new in this release: Rook Node can now execute
   shell commands and workspace file operations, not just drive a browser).
2. **No device online?** The action runs in the free E2B cloud sandbox instead.
3. **Neither?** The tools are unavailable and the agent says so.

All actions ride the **same durable `nodeCommands` envelope and approval
lifecycle**. Sensitive actions (`computer_run_command`, `computer_write_file`)
are proposals that only run after you approve them in **Updates**; reads
(`computer_read_file`, `computer_list_files`) run immediately.

## Setup

### Cloud overflow (free, no credit card)

1. Sign up at [e2b.dev](https://e2b.dev) (Hobby tier: **no card required**,
   $100 one-time usage credit, 20 concurrent sandboxes, 10 GiB disk each).
2. Copy your **API key** from the E2B dashboard.
3. Add it to Vercel as the `E2B_API_KEY` environment variable (Production
   scope), then **redeploy** — Vercel only applies env vars to new deployments.

### Local device (optional but preferred)

Pair any always-on device you already own (old laptop, Raspberry Pi, desktop)
with Rook Node from **Account → Your computers**. When it's online, computer
actions run there first.

The feature is fully inert without any setup: the card shows **Setup needed**
and the AI never advertises the computer tools.

## Usage

Ask a Bot to run code or work with files, e.g. *"run `npm test` in a scratch
folder"* or *"summarise the CSV in my workspace"*. The Bot will either:

- run read-only file tools immediately (on your device if online, else cloud), or
- prepare a shell/write command as a proposal — approve or decline it in
  **Updates**. After approval it runs on your device if online, else in the cloud.

Each bot's files live in its own workspace (`bots/<botId>/workspace` on the
device, the sandbox workspace in the cloud), so bots share the computer but
keep separate files.

## Costs

- Local device: $0 (hardware you already own, ~$0.50/mo power for a Pi).
- E2B Hobby: $0/month, $100 one-time credit (~600+ active sandbox-hours at
  default sizing) — only used when no device is online. When the credit runs
  out, sandbox creation pauses until a payment method is added; Rook never
  bills you.
- Sandboxes are billed only while running; idle time costs nothing.

## Roadmap

- Persistent per-account cloud sandbox (pause/resume, snapshots) instead of
  per-execution.
- Per-bot cloud workspaces (`~/rook/<botId>/`) with a read-only file surface in
  the workroom.
- Usage ledger + per-user caps against the shared credit pool.
- Browser automation in the cloud (Chromium template) — currently cloud is
  shell + files only.

## Security notes

- Shell commands and file writes are approval-gated on both executors; reads
  are not.
- Cloud paths are normalized and can never escape the sandbox workspace; local
  paths are confined to the bot workspace via the same path guards.
- The E2B sandbox is isolated per execution; the local device executes only
  approval-gated commands from your own Bots.


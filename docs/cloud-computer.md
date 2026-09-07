# Rook Cloud Computer

A shared Linux sandbox that gives your Bots a shell and a filesystem when your
own computer is offline — or for work you want to run in parallel. This is the
cloud half of Rook's "agent computer": your paired Rook Node stays the preferred
executor; the cloud sandbox is the fallback and the parallel path.

## How it works

- **One sandbox per execution** (v1). A fresh E2B sandbox is created for each
  approved command and killed when it finishes. Persistent per-account
  sandboxes with snapshots are a planned follow-up.
- **Same command pipeline as local nodes.** Cloud actions are stored in the
  same `nodeCommands` envelope with the same approval lifecycle. Sensitive
  actions (`computer_run_command`, `computer_write_file`) are proposals that
  only run after you approve them in **Updates**; reads
  (`computer_read_file`, `computer_list_files`) run immediately.
- **Per-account isolation.** Cloud commands use a node id of `cloud-<userId>`,
  so command queues can never cross accounts.

## Setup (free, no credit card)

1. Sign up at [e2b.dev](https://e2b.dev) (Hobby tier: **no card required**,
   $100 one-time usage credit, 20 concurrent sandboxes, 10 GiB disk each).
2. Copy your **API key** from the E2B dashboard.
3. Add it to Vercel as the `E2B_API_KEY` environment variable (Production
   scope), then **redeploy** — Vercel only applies env vars to new deployments.
4. On **Account → Your computers**, the "Rook Cloud" card flips to **Available**.

The feature is fully inert without the key: the card shows **Setup needed** and
the AI never advertises the cloud tools.

## Usage

Ask a Bot to run code or work with files, e.g. *"run `npm test` in a scratch
folder"* or *"summarise the CSV in my cloud workspace"*. The Bot will either:

- run read-only file tools immediately, or
- prepare a shell/write command as a proposal — approve or decline it in
  **Updates** (same place Excel changes are approved).

## Costs

- E2B Hobby: $0/month, $100 one-time credit (~600+ active sandbox-hours at
  default sizing). When the credit runs out, sandbox creation pauses until a
  payment method is added — Rook never bills you.
- Sandboxes are billed only while running; idle time costs nothing.

## Roadmap

- Persistent per-account sandbox (pause/resume, snapshots) instead of
  per-execution.
- Per-bot workspaces (`~/rook/<botId>/`) with a read-only file surface in the
  workroom.
- Usage ledger + per-user caps against the shared credit pool.
- Browser automation in the cloud (Chromium template) — currently cloud is
  shell + files only.

## Security notes

- Cloud paths are normalized and can never escape the sandbox workspace
  (same rules as rook-node's FileBroker).
- Shell commands and file writes are approval-gated; reads are not.
- The E2B sandbox is isolated per execution; no host access, no cross-account
  mounts.

# Evaluation - Grok Build (xai-org/grok-build) for Rook

> **Scope:** deep evaluation only - no build. Requested 2026-09-20 ("it's so good,
> evaluate engineering this into Rook"). Sources: the repo itself, its in-tree user
> guide (27 docs), DeepWiki architecture pages, docs.x.ai, x.ai/pricing. Fetched live.

---

## TL;DR

| Question | Answer |
|---|---|
| What is it | xAI's official terminal coding agent: full-screen mouse-interactive TUI + headless mode + ACP server mode. Rust monorepo synced periodically from the SpaceXAI monorepo. |
| Maturity | 27k stars, 47 commits on the mirror, actively shipped (docs reference grok-4.7), real docs, PTY e2e test harness. Not a toy. |
| License | **Apache-2.0** (first-party). Vendored codex/opencode tool ports keep their licenses. Rook can embed or port freely with notices. |
| Can we fork upstream? | **No - contributions not accepted** (read-only mirror, `SOURCE_REV` pins the monorepo SHA). Treat as a versioned dependency, never a fork we patch upstream. |
| Model access | Default models need an xAI account (Free tier has limited Build access; SuperGrok $30+/mo for real usage). **BUT custom models need no xAI account**: point `GROK_MODELS_BASE_URL` / `[model.*]` at any OpenAI-compatible endpoint with any Bearer key. This is the Rook unlock. |
| Embed path | `grok agent stdio` / `grok agent serve` speak **ACP (JSON-RPC)** - the same embed-an-agent protocol class as Rook's OpenCode path. Prebuilt macOS/Linux/Windows binaries via `x.ai/cli/install.sh`/`install.ps1`. |
| Verdict | **Worth it, as three separate workstreams** - not one big adoption. (1) P1: steal specific battle-tested *patterns* into Rook's TS stack. (2) P2: offer grok as an optional agent frontend over ACP, pointed at Rook's model gateway. (3) P3/later: reuse its test-harness discipline for our TUI. |

---

## 1. What it actually is (verified)

- **Three run modes:** interactive fullscreen TUI (mouse, scrollback, modals), headless
  (`grok -p "..."`, `--output-format streaming-json` for CI), and agent mode
  (`grok agent [--always-approve] stdio|serve --bind 127.0.0.1:PORT --secret T`).
- **Crate layout:** `xai-grok-shell` (agent runtime, sessions, ACP server), `xai-grok-pager`
  (TUI), `xai-grok-agent` (prompt assembly, subagents, skills, workflows), `xai-grok-tools`
  (tool impls), `xai-grok-sandbox` (Landlock/Seatbelt), `xai-grok-workspace` (fs/git/worktrees),
  `xai-hunk-tracker` (edit attribution + rewind), plus common leaf crates (circuit breaker,
  telemetry, computer-hub).
- **Tool format variants:** the same tools ship in `grok_build`, `opencode`, and `codex`
  output flavors, plus a `hashline` variant (content-hash-anchored line edits for robust
  concurrent editing). This is why it drives non-Grok models reliably.
- **Session storage:** `~/.grok/sessions/<encoded-cwd>/<id>/` with `updates.jsonl`
  (ACP event stream, source of truth), `chat_history.jsonl`, `summary.json`, `plan.json`,
  `rewind_points.jsonl`, `compaction_checkpoints/`, SQLite FTS5 index for session search.
- **Config:** `~/.grok/config.toml` + managed (`managed_config.toml`) + signed enforced
  (`requirements.toml`) layers; `grok inspect` reports the resolved config graph.

## 2. The model-access reality (decides the whole integration)

- Default Grok models: browser OAuth at auth.x.ai (or `XAI_API_KEY`); Free tier exists but
  Build usage is limited; SuperGrok $30/mo is the realistic tier; paywall checks gate some
  features by subscription (in-code).
- **Custom models bypass all of that:** `[model.x]` with `base_url` + `api_key`/`env_key`
  (or `GROK_MODELS_BASE_URL` + `XAI_API_KEY`) uses plain Bearer auth against any
  OpenAI-compatible `/v1` - chat_completions, responses, or anthropic messages backends.
  Ollama/Together/corporate-gateway examples are first-class in the docs.
- => Rook can ship grok preconfigured at **Rook's own model gateway** (an OpenAI-compatible
  shim over our existing OpenRouter/OrcaRouter/TokenRouter routing), giving Rook users a
  frontier-grade harness on free models. No xAI account needed. (Caveat: grok's tool loop
  expects strong tool-calling; free-tier models that drop tool calls will degrade it -
  same constraint as our own agent v2.)

---

## 3. Subsystem-by-subsystem - what to take into Rook

Each entry: what grok does, what Rook has today, verdict.

### 3.1 Compaction (P1 - adopt pattern)
- **Grok:** auto-compacts at 85% of the context window (`[session] auto_compact_threshold_percent`
  tunable); `/compact [focus note]` lets the user steer what survives; compaction state is
  checkpointed to `compaction_checkpoints/` so it is reversible; `/context` shows the window
  budget breakdown (system / messages / overhead / free); plan-mode state is explicitly
  preserved through compaction.
- **Rook today:** deterministic zero-call checkpoint ledger (`server/ai/compaction.ts`),
  6k-token history fit (`partitionRecentContext`), no user-visible budget, no focus note,
  no threshold knob.
- **Take:** the *threshold + `/context` visibility + focus-note* trio costs almost nothing in
  our ledger world: emit a compact notice line when the ledger engages, expose the budget in
  `rook status`/chat footer, and let `/compact keep X` steer ledger line selection. This
  composes with the Jev evaluation (scored keep/drop) rather than conflicting with it.

### 3.2 Permissions pipeline (P1 - adopt pattern)
- **Grok:** staged pipeline - compiled static **deny rules** (managed config, signable by
  orgs) → permission mode (**Ask / Auto / AlwaysApprove**) → heuristic/classifier
  auto-approval for safe reads → interactive prompt cards. YOLO can be **disabled by policy
  pin** (`yolo_disabled_by_policy`). `Auto` mode is a model/heuristic classifier deciding
  which calls are safe enough to skip the prompt.
- **Rook today:** writes are proposals awaiting approval (good), reads run immediately, no
  deny-rule layer, no auto classifier, no org-level policy.
- **Take:** (a) a static deny-list layer in front of the computer tool executor (path globs,
  command patterns) - cheap, deterministic; (b) grok's Auto mode is exactly the shape the
  **Jev evaluation** proposed for Rook (calibrated micro-decisions on the hot path) - this
  validates the pattern in production at xAI scale; (c) skip policy signing until Rook has
  org/team features.

### 3.3 Plan mode (P1 - adopt state machine)
- **Grok:** four-state machine (`Inactive/Pending/Active/ExitPending`), plan written to a
  session `plan.md`, *plan-file edits auto-approved, all other edits hard-rejected in every
  mode including YOLO*, approval surface on `exit_plan_mode`, state persisted to disk and
  survives restarts. Notably: subagents are NOT covered by the parent's edit gate.
- **Rook today:** plan/act modes exist as a UI/agent-level concept but without a hard
  tool-level edit gate or a persisted plan artifact.
- **Take:** the hard edit gate keyed on a session plan file is the piece that makes plan
  mode trustworthy. Port the state machine + gate into `excel-agent.ts`'s tool executor
  (it already centralizes tool execution); keep the plan as a chat artifact instead of a
  session-dir file.

### 3.4 Skills (P1 - adopt format alignment)
- **Grok:** full SKILL.md runtime: discovery tiers (cwd → repo → user, plus `.agents/`,
  `.claude/`, `.cursor/` compat dirs), priority dedup, `user-invocable: true` frontmatter
  turns skills into slash commands, **collision namespacing** (`/plugin:commit`,
  `/local:commit`, built-ins always win bare names), `disable-model-invocation`, 25k-token
  inline body cap, `[skills] paths/ignore/disabled` config, `grok inspect` reporting.
- **Rook today:** `skills/` dir with SKILL.md files + `server/ai/skills.ts` catalog/attach,
  no slash invocation, no namespacing, no discovery tiers.
- **Take:** collision namespacing + user-invocable frontmatter + discovery tiers are
  directly portable to our CLI input palette (the palette we just rebuilt shows sources -
  grok badges each row with its origin: built-in / skill / plugin). This is the cheap 80%.

### 3.5 Hooks (P2 - adopt minimal subset)
- **Grok:** JSON-configured lifecycle hooks (SessionStart, PreToolUse with block,
  PostToolUse with **output replacement** - redact/trim before the model sees it, Stop as
  a gate that keeps the agent working until a condition holds, SubagentStop, StopCancelled),
  command or HTTP, per-scope trust, Claude/Cursor compat importers.
- **Rook today:** none.
- **Take:** PostToolUse output replacement is the standout - it is a sanctioned place for
  secret redaction and giant-output trimming before results hit the context (we currently
  truncate blindly at 12k chars). Start with PreToolUse-block + PostToolUse-transform on
  the server tool executor. Skip HTTP hooks and vendor compat.

### 3.6 Background work: /loop, monitor, scheduler (P2)
- **Grok:** `/loop 5m <prompt>` fires immediately then repeats in a **detached subagent**
  (cannot see the conversation; result-only comes back); 50-task cap, 7-day expiry;
  `monitor` tool streams line events; Ctrl+B demotes the running command; a persistent
  "N commands · M loops still running" status row; `scheduler_create/list/delete` tools.
- **Rook today:** scheduled agent work exists (tasks/scheduler) but not as an in-conversation
  primitive, and no foreground-to-background demotion.
- **Take:** the detached-subagent semantics for recurring prompts (result-only feedback,
  hard caps, expiry) are exactly right for Rook's Bot model; the status-row pattern fits
  both the CLI footer and the web workroom. Medium effort - P2.

### 3.7 Sandbox (P2 - adopt profiles, not the mechanism)
- **Grok:** kernel-enforced profiles (Landlock on Linux, Seatbelt on macOS): `workspace`
  (read everywhere, write CWD+tmp), `read-only`, `strict`, custom `deny` globs, child-network
  blocking (Linux seccomp only), plus `[shell_environment_policy]` that strips
  `*KEY*`/`*SECRET*`/`*TOKEN*` from child processes by default-pattern.
- **Rook today:** Rook Node's control plane has path/lease/policy validation and proposals;
  no OS-level sandbox; shell env passthrough is unfiltered.
- **Notable gap in grok:** Windows has no kernel sandbox (best-effort builds, profiles do
  not enforce there) - most Rook desktop users are on Windows, so the mechanism does not
  port. The **shell-environment secret filtering** does port and is one file of work.

### 3.8 Status line (P2 - cheap polish)
- **Grok:** `[ui.status_line]` builtin segments (cwd, model, context %, cost, turn-timer)
  or a user script fed a documented stdin JSON contract, 300ms-debounced event-driven
  refresh; repo-local configs cannot set command rows (anti-clone-attack).
- **Rook today:** CLI `statusBar(cwd, version)` static strip; chat footer shows agent/model.
- **Take:** add `context` (from our token-budget math) and `turn-timer` segments to the CLI
  status bar. The scriptable stdin-JSON contract is a nice-to-have; note grok's security
  rule (only user/admin config may name a command) if we ever copy it.

### 3.9 Sessions, rewind, hunk tracking (P3)
- **Grok:** append-only ACP event log per session, rewind points tied to file-change hunks
  (`xai-hunk-tracker` attributes every edit to agent vs external), auto-titled sessions,
  SQLite FTS5 search, worktree gc with uncommitted-work protection.
- **Rook today:** CLI history is in-memory; web workrooms persist messages in InstantDB;
  no rewind, no edit attribution.
- **Take:** do not build rewind into the Rook chat product. If Rook embeds grok (or OpenCode)
  as the code-work engine, *it* owns sessions/rewind/hunks. Duplicating it would be theater.

### 3.10 Reliability plumbing (P2 - compare, small upgrades)
- **Grok:** `xai-circuit-breaker` - sliding-window error-rate breaker with min-samples,
  half-open probes, separate 401-focused client and 5xx-focused server presets,
  env-tunable (`CB_*`).
- **Rook today:** `fallback-router.ts` breaker (3 transient failures → 60s cooldown).
- **Take:** ours is simpler and fine; steal two details: min-samples before tripping (avoid
  tripping on 3 early-morning failures) and classifying 401 vs 429 vs 5xx differently.

### 3.11 Testing discipline (P2 - the harness lesson)
- **Grok:** PTY e2e harness drives the real TUI binary in a pseudo-terminal with scripted
  key/mouse injection and a virtual screen buffer, asserting on *rendered screen state*.
  This is exactly what would have caught our redraw bugs (the stray-rule ladder) before
  the user saw them.
- **Rook today:** pure-function input tests (fast, valuable) but nothing asserts on the
  composed terminal frame.
- **Take:** a light TS equivalent for `askInput` - feed scripted keypresses through a fake
  PTY, snapshot the ANSI stream through a terminal emulator (e.g. vt100 parsing in-test),
  assert no leftover rows. Medium effort, high regression value for the TUI work.

### 3.12 What to skip entirely
- **Voice dictation, video_gen, dashboard/fleet management, managed/signed config, ZDR
  plumbing, external OTEL, Mermaid vendored stack** - none map to Rook's product.
- **Porting Rust code**: no. Pattern-level ports only; binaries are the reuse unit.
- **Contributing upstream**: impossible by policy (read-only mirror).

---

## 4. Integration options (the actual "engineer it in" paths)

### Option A - grok as an optional agent frontend (P2, ~1 week)
Parallel to the existing OpenCode path (`docs/opencode-rook-integration.md`):
- Rook Node (or the CLI) downloads the prebuilt `grok` binary at install time (same pattern
  as opencode setup scripts; `x.ai/cli/install.ps1` covers Windows).
- Drive it headlessly (`grok -p ... --output-format streaming-json`) for one-shot work, or
  via **ACP** (`grok agent --always-approve stdio`) for interactive sessions; the official
  TypeScript SDK is `@agentclientprotocol/sdk` on npm.
- Point it at Rook's gateway via `[model.rook]` in a managed config:
  `base_url = "https://www.rook.lighting/api/openai-compat"` (to be built - a thin shim over
  the existing router), `env_key = "ROOK_TOKEN"`. Users with SuperGrok can use default models.
- Approvals: run always-approve inside Rook *only* behind our existing proposal gate (Rook
  intercepts computer tools), or leave grok in Ask mode in the TUI.

### Option B - Rook gateway as an OpenAI-compatible endpoint (P1 enabler)
Option A needs Rook to speak `/v1/chat/completions` (+ `/v1/models`). That shim is
independently valuable (works for grok, opencode, codex, aider, anything). Estimate: small
adapter over `server/ai/index.ts` dispatch. This is the highest-leverage enabler in this doc.

### Option C - pattern ports (P1, incremental)
Section 3 items land in Rook's own TS stack (CLI input, server tool executor, compaction)
with no binary dependency. These compound with the Jev evaluation and the TinyFish search
upgrade: grok's `Auto` permission classifier + Jev's calibrated nouls are the same idea,
validated independently.

## 5. Risks / watch-items

| Risk | Severity | Mitigation |
|---|---|---|
| Read-only mirror, no PRs accepted | Medium | Pin a release; never fork-patch; report issues only |
| Default models gated by paid xAI tiers | Medium | Option B gateway + custom-model config removes the dependency |
| Windows: source builds untested; sandbox unenforced | Medium | Use prebuilt binaries; keep Rook's own proposal gate as the enforcement layer |
| Repo churn (periodic monorepo syncs, generated root Cargo.toml) | Low | Pin `SOURCE_REV`, upgrade deliberately |
| Brand/product confusion (SpaceXAI/xAI naming inside a Rook surface) | Low | Present as "Grok Build (by xAI)" an integration, not a Rook feature |
| Free-tier models dropping tool calls inside grok's loop | Medium | Ship Option B with a curated model allowlist known to tool-call reliably |

## 6. Recommendation

| Priority | Item |
|---|---|
| **P1** | OpenAI-compatible gateway shim (Option B) - unlocks grok + every other agent |
| **P1** | Pattern ports: compaction threshold + `/context` visibility + focus note; permissions deny-layer + Auto-classifier direction (with Jev); plan-mode hard edit gate; skills namespacing + user-invocable + source badges in the CLI palette |
| **P2** | Embed grok via ACP/headless as an opt-in agent frontend (Option A); hooks PreToolUse/PostToolUse-transform; /loop-style detached scheduled prompts; status-line context + turn-timer segments; env secret filtering |
| **P2** | PTY screen-state test harness for the CLI input engine |
| **P3/skip** | Rewind/hunk tracker (owned by embedded agents), sandbox mechanism (no Windows), vendor-compat importers, dashboard/fleet features, voice/video |

## 7. Sources
- Repo: https://github.com/xai-org/grok-build (README, crate layout, license, contrib policy)
- DeepWiki: overview, built-in tools, permission/safety, subagents, MCP, hunk tracker,
  circuit breaker, PTY harness (indexed 2026-09-20, rev 4247f6)
- User guide (raw, in-tree): 02-authentication, 04-slash-commands, 08-skills, 10-hooks,
  11-custom-models, 15-agent-mode, 17-sessions, 18-sandbox, 19-plan-mode,
  20-background-tasks, 25-status-line, README index
- https://docs.x.ai/build/overview · https://x.ai/pricing

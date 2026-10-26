# Evaluation v2 - Grok Build ARCHITECTURE inside Rook

> **Scope:** architecture-internal edition. The user corrected v1: this is not "embed
> the grok binary alongside Rook" - it is "run the Grok Build architecture *inside* of
> Rook." That changes everything: no Rust runtime, no binary dependency, no xAI
> account, no ACP process boundary. This doc maps grok-build module-by-module onto
> Rook's actual TypeScript/Node/Express codebase and says exactly what to copy,
> what to adapt, and what to reject - with file-level targets.
>
> Companion: `docs/grok-build-evaluation.md` (v1, external/embed view). The verdicts
> there about licensing/pricing/binary distribution are unchanged; this doc supersedes
> only the "how it fits" half.

---

## 0. The premise, stated precisely

Grok Build is a Rust actor system (Tokio actors + mailboxes) with a session actor at
its center. Rook is a stateless-ish TypeScript request/response system (Express +
tRPC + InstantDB) with a functional agent turn. You cannot port actors; you **can**
port every *invariant* the actors enforce. The mapping principle for the whole doc:

> **Grok actor + mailbox + persisted journal  =>  Rook pure turn-context + InstantDB
> event log + idempotent tool functions.** Anything that is "the actor serializes it"
> becomes "the turn builder assembles it deterministically, tests pin it."

Non-goals (locked): no Rust in Rook, no `grok` binary dependency, no vendored
Mermaid/Rhai stacks, no xAI subscription requirement, contributions upstream remain
impossible (read-only mirror) so every port is ours to own.

---

## 1. Correspondence table (the whole map on one page)

| Grok Build module | What it guarantees | Rook counterpart today | Fit |
|---|---|---|---|
| `SessionActor` (run_loop/spawn, lifecycle contributors) | one serialized owner of session state; resume from journal | `prepareAgentTurn` (excel-agent.ts) + routers; InstantDB persistence | **Adapt** - turn-context object + contributors registry |
| `ChatStateActor` + `request_builder` | single place that owns history, budgets, and builds the inference request | `system-prompt.ts` + `partitionRecentContext` + `toolResultText` | **Adapt** - formalize as `buildTurnRequest()` |
| `compaction.rs`/`two_pass.rs` + `build_compacted_history` | two-pass summarize (60/40), prefire, sticky suppression, checkpoints | `compaction.ts` ledger (deterministic, no model call) | **Adapt** - add two-pass + prefire + suppression around the ledger |
| `SamplerActor` + `request_task` | streaming SSE, retry policy, doom-loop + idle-timeout guards, error taxonomy | `invokeAiResilient` + `openai-stream.ts` + `isTransientAgentError` | **Adapt** - port the guards + error enum |
| `xai-tool-protocol` + registry + notifications | framed tool wire, subscribe-before-send, typed notifications, local/remote transports | `agent-tool-executor.ts` + `shared/agent-trace.ts` + `computer-tools.ts` | **Adapt** - event taxonomy + error codes, not the wire |
| `PermissionConfig` + modes + prompt cards | deny→mode→classifier→prompt pipeline; Ask/Auto/AlwaysApprove; yolo pin | TOOL_RISK (`read-only`/`approval-gated`) + proposals | **Adapt** - deny layer + Auto; keep proposal UX |
| `xai-grok-hooks` (Pre/Post/Stop, exit-code-2 deny, fail-open) | lifecycle interception with trust scopes | none | **Adopt** - narrow event set, in-process first |
| SubagentCoordinator + attempt store | detached children, shared hunk ledger, worktree isolation, journaled attempts | scattered background bits; no ledger | **Adapt** - attribution + journal; no worktrees |
| `AgentBuilder`/MiniJinja + AGENTS.md + compat scan | templated prompt from agent def + rules + skills | `buildRookSystemPrompt` + bot identity + skills catalog | **Adapt** - template sections + `extend`/`full`; skip vendor scan |
| `xai-grok-memory` (SQLite FTS5+vec, /flush, MEMORY.md) | hybrid recall, threshold flushes, sanitized writes | `memory.ts` regex extract, 20-line cap, client-synced | **Adapt** - retrieval + flush gates; defer vectors |
| ACP `session/update` taxonomy | versioned UI/backend event contract | `AgentStreamEvent` + trace + `agent-stream-route.ts` | **Adopt** - versioned contract doc + parity test |
| layered config (flags>env>overlay>config>managed>defaults) | deterministic precedence + signed enforcement | CLI profile/env/defaults ad hoc | **Adapt** - document + pin file; defer signing |
| `xai-circuit-breaker` | sliding window, min samples, 401-vs-5xx presets | `fallback-router.ts` 3-failures/60s breaker | **Adapt** - min-samples + error-class split |
| `xai-hunk-tracker` | agent-vs-external edit attribution, rewind points | none | **Adapt** - attribution on proposals; defer rewind |
| Rhai workflow engine | journaled deterministic multi-agent scripts | none | **Reject runtime; adopt journaling idea** |

---

## 2. SessionActor => turn-context + contributors (the central refactor)

Grok truth: one `SessionActor` owns ALL live session state; every mutation arrives as a
command on a mailbox; persistence is an append-only JSONL journal; resume = replay;
multi-client (LeaderServer) fans out from the same serialized state.

Rook truth: there is no long-lived server session. `workroom.reply` / `/api/agent/stream`
build a turn from (bot config + recentContext + connectors + memory), run ≤6 rounds, persist
messages, exit. Concurrency is handled by not keeping any.

Port (no actor runtime):
- Promote `prepareAgentTurn` in `server/integrations/excel-agent.ts` to a **turn-context
  builder** (`buildTurnContext(input): TurnContext`) that owns: identity, model route,
  budgets, toolset, history slice, ledger block, memory block, search block, trace seed.
  Both `runRookAgent` and `runRookAgentStream` already share the dispatcher; make them
  share this builder too (today only the stream path imports the setup).
- Add a **contributors registry** mirroring `xai-agent-lifecycle` (session/turn/turn-input
  contributors): small pure `contribute(ctx)` functions in `server/ai/` registered in one
  list (search-trigger, memory-extract, ledger-build, skill-attach). Deterministic order,
  unit-tested - this is the mailbox ordering invariant without mailboxes.
- Resume/replay: grok resumes by replaying `updates.jsonl`. Rook's analogue is the
  InstantDB message history + `recentContext`; add a `turn journal` field (tool calls with
  fingerprints + outcomes) so a crashed turn can be *replayed* rather than re-run
  (replay ⇒ no double proposals - matches the stream path's existing no-duplication rule).
- Multi-client: Rook's fan-out is SSE broadcast; no LeaderServer needed. Keep it.

## 3. ChatStateActor + request_builder => formalize `buildTurnRequest()`

Grok truth: `ChatStateActor` owns history; `request_builder` produces the inference
request with pruning, image budgets, reasoning stripping; `UsageLedger` accounts
per call; mutations/queries are separated (commands vs queries).

Port:
- Create `server/ai/turn-request.ts`: `buildTurnRequest(ctx): { system, messages, tools,
  budgets }` - one function, total order pinned by test (extends today's order test).
  Fold in: `buildRookSystemPrompt`, `orderToolset`, `partitionRecentContext`,
  `toolResultText`/`ROOK_TURN_TOOL_BUDGET_CHARS`, plus an **image/token budget** for
  composer images (grok's `image_budget` - evict attachments oldest-first when over).
- Split read vs mutate helpers the way grok splits commands/queries (today they're
  intermixed in `agent-reliability.ts`): `*-query.ts` pure, `*-mutate.ts` side-effecting.
- Usage ledger: extend `server/ai/telemetry.ts` `recordTurn` with per-round model,
  tokens, tool counts → this is also what `/context`-style visibility (v1 §3.1) reads.

---

## 4. Two-pass compaction + prefire + sticky suppression (extends the ledger, keeps $0)

Grok truth: split at ~60% prefix/suffix; Pass 1 summarizes the prefix (NOTE1) *before*
the 85% threshold fires (prefire, cached by prefix fingerprint); Pass 2 folds NOTE1 +
suffix into NOTE2; failures set sticky suppression (stop retrying doomed compactions);
checkpoints make it reversible; plan-mode state survives as an explicit reminder.

Port into `server/ai/compaction.ts` family:
- Keep the deterministic ledger as **Pass 0** (always present, $0). Two-pass *summarization*
  becomes Pass 1/2 executed only when history exceeds a threshold - and only when a
  summarizer is available (it costs a model call on the shared free allowance; gate it
  exactly like web search is gated today).
- Prefire: grok's best idea. When history crosses ~70% of budget, kick off Pass 1 in the
  background (fingerprint = hash of the prefix slice; cache keyed on it). The focused
  turn then only pays Pass 2. Rook turns are short today, so prefire matters most for
  the CLI chat histories and long workroom threads - exactly where users feel compaction.
- Sticky suppression: a failed/empty summarization sets a per-session `compactSuppressed`
  flag (in-memory + journaled) so we stop burning model calls on doomed retries - this
  generalizes the existing `isMaxTokensError` one-retry-then-stop discipline.
- Plan-mode preservation: if a plan artifact exists, the compaction output must restate
  "plan mode active + current step" - one line, test-pinned.

## 5. Sampler guards (doom-loop, idle timeout, error taxonomy)

Grok truth: `SamplerActor` spawns per-request tasks; `request_task` enforces idle-chunk
timeout (default 300s), doom-loop detection (repetitive generation), structured
`SamplingError` (IdleTimeout/DoomLoop/Api/Auth/EmptyResponse) driving retry decisions.

Port into `server/ai/`:
- Add `DoomLoop` + `IdleTimeout` to the error taxonomy next to `isTransientAgentError` /
  `isMaxTokensError`: a turn that repeats the same tool-call fingerprint ≥3 rounds running
  aborts with a one-line honest state (we already compute `toolCallFingerprint` - the
  signal exists, only the guard is missing); a stalled SSE stream gets `reader.read()`
  deadlines in `openai-stream.ts` (today only connect timeouts exist).
- Keep retry placement: transient → fallback router; auth/config → surface; doom/idle →
  abort + friendly message. One test per variant, mirroring grok's parity tests.

## 6. Tool runtime: registry, notifications, error codes

Grok truth: `ToolRegistry` resolves local vs remote tools per session (`bind_tool_session`);
`subscribe-before-send` guarantees streaming order; typed notifications
(tool-start/chunk/done, permission prompts, plan-mode transitions); `ToolErrorWire`
standardizes retryable-vs-fatal codes.

Port:
- `executeAgentTool` already branches per family; add a **registry table**
  (`TOOL_REGISTRY: name → { family, risk, parse, run, timeoutMs, title }`) so timeouts
  (today hardcoded 20s/10s per branch) and risk live with definitions, and new families
  append without touching dispatch. Keep the frozen order + annotation test.
- Notifications: our `AgentStreamEvent` kinds (trace/token/approval/proposal) already cover
  grok's taxonomic ground; add two kinds - `tool_start` (before execution, carries timeout
  + risk) and `tool_result` (after, carries char count + truncation flag). This gives the
  CLI/web the data for live progress rows and is the hook point for §7.
- Error codes: tag every tool failure `{ retryable: boolean, code }` (WORKSPACE_UNAVAILABLE
  style) instead of free-text status strings; the retry policy reads codes, not strings.

## 7. Permissions: deny layer + Auto (keep the proposal UX)

Grok truth: CompiledPolicy deny rules → mode (Ask/Auto/AlwaysApprove) → classifier →
interactive prompt cards; yolo pin; folder trust for project configs.

Port:
- Deny layer: `server/integrations/tool-policy.ts` - static glob/command patterns evaluated
  *before* `executeAgentTool`, configured per deployment (env) + per user (settings).
  Denied ⇒ tool result `{ status: "denied", code: "POLICY_DENIED" }` (feeds §6 codes).
  This is deterministic and free.
- Auto mode: replace/augment `shouldSearchPublicWeb`-style regexes with the Jev-style
  calibrated scorer (v1 companion + prior Jev doc). Keep human UX identical: proposals
  still pause for approval; Auto only governs what *runs*, exactly as grok's Auto governs
  execution while prompt cards still exist for Ask.
- Folder trust: Rook's analogue is connector OAuth scope - already trusted. No new build.

## 8. Hooks (narrow, in-process first)

Grok truth: declarative `HookSpec`, event taxonomy (Session/Turn/Tool/Safety/User/Memory),
command + HTTP runners, blocking PreToolUse (exit-code-2 deny), output-rewriting
PostToolUse, Stop gate, fail-open on crash, trust scopes.

Port as `server/ai/hooks.ts` with exactly five events:
`SessionStart | PreToolUse | PostToolUse | Stop | UserSubmit`. In-process handler
functions first (redaction, trimming, audit log); command-runner parity later behind a
flag; skip HTTP runners. Semantics to copy verbatim: **exit-code-2 denies, any other
crash fails open**, `PreToolUse` may rewrite args, `PostToolUse` may replace output
(redact secrets, trim walls of text - the sanctioned alternative to blind 12k truncation).
Hook executions emit trace steps so the activity feed shows them (grok surfaces
`HookExecution` in scrollback - our trace already renders tool steps the same way).

## 9. Subagents: attribution + journal; background done right

Grok truth: SubagentCoordinator (spawn/park/wake/kill), shared hunk ledger for
attribution, worktree isolation option, journaled attempts (header + incremental
updates + outcome, size-capped).

Port:
- Attribution: extend `ComputerProposal`/approvals with `origin: { botId, taskId,
  parentTaskId? }` so background/detached work is attributable - the shared-hunk-ledger
  idea without git. Cheap, high trust value.
- Attempt journal: bounded JSONL per task (header, calls, outcomes; 32KB/msg, total cap -
  copy grok's caps) persisted next to telemetry. Replays safely: replay ⇒ same
  fingerprints ⇒ dedup ⇒ no double proposals (§2 journal).
- Skip worktree isolation (no git worktrees in Rook's model); skip Rhai workflows.
- `/loop` semantics (v1 §3.6): detached, result-only, 50-task cap, 7-day expiry -
  implement on Rook's existing scheduler, not a new system.

---

## 10. Prompt assembly as template (extend/full + compat discipline)

Grok truth: agents are Markdown+YAML frontmatter (`name/promptMode/tools/disallowedTools/
permissionMode/completionRequirement`); `promptMode: extend|full` controls merge with
the base; MiniJinja renders sections; AGENTS.md/Claude.md/SKILL.md inject by precedence;
compat scanning is flag-gated per vendor.

Port:
- Keep `buildRookSystemPrompt` but template its *sections* (`identity/rules/tools/live`)
  so Bots become data: `promptMode extend` = bot purpose appended to base;
  `promptMode full` = bot supplies whole prompt (power users). This is today's string
  builder grown a schema - no rewrite.
- Add `disallowedTools` per Bot (today only allowlists exist via connector selection) -
  the missing half of grok's tools/disallowedTools pair.
- AGENTS.md analogue: Rook's `skills/` + bot purpose already cover project rules; add repo
  `.agents/rules` discovery only if users ask. Skip vendor-compat scanning (.claude/,
  .cursor/) - no evidence Rook users keep those; revisit on demand.

## 11. Memory: threshold flush + sanitized recall

Grok truth: `~/.grok/memory/` + SQLite FTS5 + sqlite-vec hybrid recall; `should_flush`
soft/hard token gates; LLM-extracted summaries validated (reject no-reply, require
headers, truncate) then written; global vs workspace scope.

Port into `server/ai/memory.ts`:
- Flush gates: run `extractMemoryCandidates` output through soft/hard thresholds
  (turn-count + char-count based, no new infra): soft ⇒ suggest; hard ⇒ auto-append +
  journal. This is grok's `should_flush` minus the database.
- Sanitization: copy the validation trio verbatim - reject empty/noreply, require a
  key-like shape, truncate to cap. (Our SECRETY regex stays as the first filter.)
- Recall: global (user) vs per-Bot scope already exists via botMemory; add keyword recall
  over InstantDB history only if threads get long. Defer vectors/FTS5 - no evidence of
  need at our scale (same call v1 made: our 20-line field needs retrieval like a fish
  needs a bicycle - until threads grow).

## 12. Config + ACP contract discipline (no new systems)

Grok truth: flags > env > overlay > config.toml > managed > defaults, cryptographically
pinned at the top; ACP `session/update` is a versioned contract with parity tests.

Port:
- Document Rook's actual precedence (ROOK_* env > CLI flags? today flags and env race in
  `defaultApiUrl`) in `docs/cli.md` and pin with a test - grok's lesson is that
  precedence must be *written down and tested*, not that it needs six layers. Defer
  signed enforcement until org features exist.
- ACP parity lesson: version `AgentStreamEvent` + `shared/agent-trace.ts` with a
  `STREAM_CONTRACT_VERSION` and add the sync test `lib/workroom-helpers.ts` already
  foreshadows - every producer/consumer pair asserts the same kinds. No ACP adoption;
  our SSE contract is the equivalent surface.

## 13. Circuit breaker + hunk attribution (small, sharp)

- Breaker: add min-samples-before-trip + split 401/429/5xx handling to
  `server/ai/fallback-router.ts` (3/60s today). Copy grok's env-tunable shape (`CB_*` →
  ours stays hardcoded but documented) and its parity tests.
- Hunks: extend proposals with `filesTouched: string[]` + `origin` (§9) - attribution
  without git. Rewind stays out of scope (no file ownership in chat product).

## 14. Build order (dependency-sorted)

| Order | Work | Files | Rough size |
|---|---|---|---|
| 1 | Turn-context builder + contributors registry | `server/ai/turn-context.ts`, contributors in `server/ai/` | ~300 LOC + tests |
| 2 | `buildTurnRequest()` + read/mutate split | `server/ai/turn-request.ts` | ~150 LOC |
| 3 | Tool registry table + notifications + error codes | `agent-tool-executor.ts` (refactor in place) | ~200 LOC |
| 4 | Hooks (5 events, in-process) + trace surfacing | `server/ai/hooks.ts` | ~150 LOC |
| 5 | Deny policy layer | `server/integrations/tool-policy.ts` | ~100 LOC |
| 6 | Sampler guards (doom/idle taxonomy) | `agent-reliability.ts` + `openai-stream.ts` | ~120 LOC |
| 7 | Compaction Pass 1/2 + prefire + suppression | `compaction.ts` family | ~200 LOC |
| 8 | Breaker min-samples + classes | `fallback-router.ts` | ~60 LOC |
| 9 | Prompt template sections + disallowedTools | `system-prompt.ts` | ~100 LOC |
| 10 | Memory flush gates + sanitization | `memory.ts` | ~80 LOC |
| 11 | Attempt journal + attribution | telemetry + proposals | ~120 LOC |
| 12 | Contract versioning + precedence doc | trace/stream + docs | ~80 LOC |

Total ≈ 1,660 LOC of additive, test-pinned TypeScript - no new dependencies except
possibly `rhai`-equivalent scripting which we explicitly reject.

## 15. Explicit rejects (so nobody rebuilds them later)

- **Actor runtime / mailboxes / Tokio patterns** - Rook has no long-lived sessions;
  contributor ordering + journaling carry the invariants.
- **Rhai workflow engine + MiniJinja** - no embedded scripting language in Rook; string
  builders with pinned order are the equivalent.
- **Vendored Mermaid stack, voice, video_gen, dashboard/fleet, ZDR plumbing, external
  OTEL** - no product mapping.
- **Kernel sandbox (Landlock/Seatbelt/bwrap)** - unenforced on Windows (majority of Rook
  desktops); Rook Node validation + proposal gates stay the enforcement layer.
- **sqlite-vec / FTS5 memory + vector recall** - premature at our scale; keyword recall
  only if threads grow.
- **Full ACP adoption** - our SSE `AgentStreamEvent` contract is the equivalent; ACP
  belongs to the *embed* view (v1), not the internal view.
- **Vendor-compat scanning (.claude/.cursor)** - no user evidence; revisit on demand.

## 16. Sources
- DeepWiki internals (indexed 2026-09-20, rev 4247f6): Session Actor (xai-agent-lifecycle,
  run_loop/spawn, LeaderServer), Conversation Compaction (two-pass, prefire, suppression,
  build_compacted_history), LLM Sampling Layer (SamplerActor, request_task, doom-loop,
  idle timeouts), Configuration System (layer order, signed policy, GROK_CONFIG overlay),
  Chat State Actor (mutations/queries, image_budget, UsageLedger), Memory System
  (storage layout, FTS5+vec, flush gates), Hooks & Extensions (event taxonomy, runners,
  exit-code-2/fail-open), Workflow Engine (Rhai, journaling, WorkflowTracker),
  ACP (xai-acp-lib methods, MvpAgent handlers), Tool Protocol (frames, Transport,
  subscribe-before-send, registry), Agent Definition (frontmatter, MiniJinja, discovery).
- Rook code read for mapping: agent-tool-executor.ts (TOOL_RISK, orderToolset,
  executeAgentTool), fallback-router.ts (breaker), system-prompt.ts (v3 layout),
  agent-reliability.ts (budgets, dedup, error maps), excel-agent.ts (prepareAgentTurn),
  agent-stream.ts (events, partial-stream honesty), memory.ts (regex extract, caps).

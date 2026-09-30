# Agent harness efficiency and /btw — implementation record

Status: in progress. Starting point: main `7463c95`, clean checkout, 2026-09-28. No commits or pushes. This document is not a completion claim. The line-by-line prompt proposal is in [agent-system-prompt-audit.md](agent-system-prompt-audit.md); no prompt rewrite is enabled.

## Harness map

| Layer | Current implementation | Observed limitation / next change |
| --- | --- | --- |
| Shared request setup | `server/integrations/excel-agent.ts:prepareAgentTurn` | Combines identity, model route, standing instructions, clock, connector status, memory, search snippets, skills and ledger in one system message. |
| Turn execution | `runRookAgent`, `server/ai/agent-stream.ts` | Separate existing loops share setup and dispatcher. Extend both; do not add another loop. |
| Tools | `agent-tool-executor.ts`, Excel/GitHub/computer/cloud definitions | Frozen family order already present. Tool schemas resend each round. Writes propose approval, not success. |
| History | `filterRelevantContext`, `partitionRecentContext`, `compaction.ts` | Relevance gate runs before 6,000-token heuristic budget. Overflow becomes an extractive ledger; no searchable transcript pointer. |
| Tool results | `formatToolOutput`, `server/ai/tool-output.ts`, aggregate turn budget | Results over the inline limit (12,000 chars, less the remaining 36,000-char turn budget) are sanitized and retained on disk; the model gets a bounded descriptor (reference, size, 400-char preview, 1,200-char tail) and reads ranges via `read_tool_output`. Retrieval is re-authorized against live connector state (see chunk 2 below). |
| Transport | `openrouter.ts`, `router-gateways.ts`, `openai-stream.ts` | JSON retries occur inside transports; outer-loop counts alone miss them. |
| Opaque provider paths | `chatgpt.ts`, `opencode.ts` | SDK retries and OpenCode internal rounds are not fully visible to Rook. Final usage alone is not whole-task spend. |
| Fallback | `fallback-router.ts`, `ai/index.ts` | Cross-provider breaker exists. ChatGPT fallback in index is broader than the taxonomy; review in reliability phase. |
| Detached work | `server/background/*`, durable turn seam | Fenced persistence and replay already exist. Telemetry must retain requests when an attempt parks or exits early. |
| Side questions | Not yet implemented | Add lightweight answer path and independent UI state; no tools or main-thread persistence. |
| Telemetry | `telemetry.ts`, new `request-accounting.ts` | In-memory, last 100 turns, per process. Diagnostic window, not durable billing ledger. Per-tool outcome counts (`toolOutcomes`, `ai.turns.toolUsage`) added in chunk 3; see [tool-description-audit.md](tool-description-audit.md). |

## Accounting implemented first

OpenAI-compatible transports now record each physical completion request, including internal retries and rejected reasoning requests. Streaming consumes usage-only chunks and replaces cumulative usage snapshots instead of adding them together. JSON and streamed fallbacks preserve reported usage. The transport adds no caching hints, model changes, or new request options in this phase.

The accounting scope isolates concurrent turns using AsyncLocalStorage. An ephemeral HMAC groups the same owner/Bot/task within a process without storing their identifiers. `ai.turns` exposes request details and task-window aggregates. Those are observed Rook task IDs, not inferred natural-language projects; callers that create a new task per message will naturally report one turn per task.

Each request includes input, cached input, uncached input, output, cache writes, reasoning output, reported cost, timing and coverage. Unknown values remain null. Reasoning is an output subset. Cache writes are a subset of uncached input and require a separate rate when priced differently. Aggregates carry known subtotals AND unknown-request counts. A zero known subtotal with unknown requests is not zero total usage.

ChatGPT SDK calls and OpenCode managed-agent calls are explicitly marked as such, not labelled physical inference requests. Their missing usage is no longer fabricated as zero. Early exits retain observed request usage; interrupted records mark tool/approval summary fields incomplete. Hard process termination still loses this in-memory telemetry.

Source attribution records serialized character counts only. Known skills, ledger, memory, search and live setup blocks are separated from the initial system text. No prompt text, argument values, request headers, URLs, or raw exceptions are included in these new measurements. Source counts are a request-shape diagnostic, not native tokenization or proof of cache placement.

## Baseline: actual assembled requests, fixture completions

`tests/harness-baseline.test.ts` runs the real setup, loop, serialization, dispatcher and transport with fictional context, a stubbed provider and disconnected connectors. It exercises a two-request computer-status turn as well as attached skills, search and relevant history overflow. It does not measure model intelligence, live latency or billed cost.

To regenerate the local full rendered requests:

```powershell
$env:ROOK_WRITE_HARNESS_BASELINE = '1'
corepack pnpm exec vitest run tests/harness-baseline.test.ts --maxWorkers=2 --minWorkers=1
```

Output: `.cache/harness-evaluation/baseline.json` (ignored, fictional data only). Table below is the first request per fixture; the JSON retains all requests, including the computer result round.

| Task | Requests / turn | System chars | Live setup | Tool schemas | Skills | History | Ledger | Search | Total serialized chars |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| hey | 1 | 4,698 | 1,169 | 1,502 | 447 | 0 | 0 | 0 | 7,940 |
| fix it + code context | 1 | 4,700 | 1,169 | 1,502 | 1,909 | 131 | 0 | 0 | 9,540 |
| latest Expo SDK? | 1 | 4,700 | 1,169 | 1,502 | 447 | 0 | 0 | 283 | 8,238 |
| is my computer online? | 2 | 4,698 | 1,169 | 1,502 | 447 | 0 | 0 | 0 | 7,959 |
| continue migration task | 1 | 4,700 | 1,169 | 1,502 | 447 | 21,788 | 1,136 | 0 | 30,897 |

Totals also include user input and JSON/protocol fields. System text is about 59% of greeting request characters; history is about 71% of the long follow-up. These are not spend shares. Five fixture tasks produce six requests and five agent turns. The one scripted tool invocation succeeds; that is wiring evidence, not a production tool-use frequency estimate.

| Cost by source × billing type | Uncached input | Cached input | Output |
| --- | --- | --- | --- |
| System / setup / schemas / skills / history / ledger / results | Unmeasured; source character sizes above | Unmeasured; cache placement unavailable | Not input sources |
| Generated answer / tool arguments / reasoning | Not output sources | Not output sources | Unmeasured |
| Whole task | Unknown | Unknown | Unknown |

No live before/after cost reduction or quality equivalence is claimed. The fixtures deliberately omit usage rather than converting characters into fake billed tokens. This table must be supplemented with matched live provider runs before enabling behavior-changing optimization flags.

## Provider evidence

Reviewed 2026-09-28:

- [OpenRouter usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting): native usage and account cost arrive with JSON responses or the final streaming event. Cache and reasoning details may be present. Its former usage-inclusion request options are deprecated, so this implementation does not add them.
- [OpenRouter prompt caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching): behavior depends on the upstream model/provider. Prefix reuse and model identity matter; some routes support explicit cache controls, while others cache automatically. No universal TTL or price multiplier should be hardcoded across Rook's catalog.
- OrcaRouter/TokenRouter and plan-backed ChatGPT/OpenCode billing rates have not yet been independently established. Labels saying “Free” or “Your plan” are not substitutes for complete usage evidence.

The pure pricing helper accepts a verified rate snapshot; it does not ship guessed prices. Capture model-specific rate provenance for live comparisons. Provider-reported total cost cannot be accurately divided among source sections without additional attribution assumptions.

## Ranked opportunities after the baseline

| Rank | Change | Savings hypothesis | Quality risk | Validation / rollback |
| --- | --- | --- | --- | --- |
| 1 | Separate stable instructions from live setup | Reuse more of the measured ~4.7k-character system block; cache savings not yet measured | Low to medium: message placement changes interpretation | Compare exact prefix bytes and live cache data; revert assembly change |
| 2 | Audit and shorten prompt behind flag | Largest removable static source in short requests; no percentage estimate before audit | Medium/high: may affect honesty or initiative | Same tasks/models, blinded quality checks; default off |
| 3 | File-backed retrievable tool results | Reduces repeated large output while retaining data; fixture set needs a large-output case | Medium: storage scope and read-back failures | Redaction, ownership, range-read and unavailable-storage tests; revert formatter |
| 4 | On-demand tool families | Potential schema savings depend on connected-tool use, absent from these disconnected fixtures | High: first-turn calls may fail or add costly turns | Track tool errors, added requests and whole-task cost; default off |
| 5 | Compact history with plan + transcript pointer | Long fixture dominated by history; extractive ledger already small | High: lost intent and obligations | Multi-turn completion and retrieval tests; default off |
| 6 | Model/routing/reasoning changes | Unknown; may affect whole-task spend more than prompt size | High | Proposal only, no silent routing changes |

## /btw design direction and acceptance

Reference: [Grok Build slash-command guide, /btw](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/04-slash-commands.md). Its aside is separate from the main turn, dismissible, and ignores replies to an already-dismissed panel.

Rook direction: a small “Side question” panel near the composer on desktop/web and an accessible compact sheet/panel on mobile. A visible affordance opens a separate draft; `/btw` provides keyboard discoverability. Neither the main draft nor active stream is consumed by opening it. Dismissal cancels only the aside and invalidates its request identity. The main work continues.

Implemented: additive authenticated API, bounded context, one tool-free provider response, independent streaming/cancellation, local-only answer state, keyed mobile/web and desktop panels, stale-response guards, keyboard controls and regression tests. See [side-question report](btw-side-questions.md) for the real provider measurement, UI evidence and remaining device/latency limits.

## Reliability changes after baseline capture

Both loops now use the shared retry taxonomy, including an explicit `shrink` decision for one output-budget retry. Authentication/configuration takes precedence even when its error text also mentions timeout or max_tokens. Transient failures after earlier tool rounds can recover with backoff. Three consecutive identical tool fingerprints stop with the existing honest one-line state; completed calls still execute once. UNKNOWN_TOOL results end the turn without a further model call. The direct ChatGPT dispatch path now applies the same retry classification before considering fallback, closing an auth/config bypass outside the resilient router.

`tests/agent-loop-reliability.test.ts` tests both loops with the same scenarios. Existing partial-stream behavior remains in place. Foreground durable replay extensions and typed tool-error coverage remain outstanding; per-Bot denials and coding/research procedures were added in the subsequent iteration below.

## Remaining acceptance evidence

- Request accounting for opaque SDK retries/internal agent rounds and durable spend across process crashes remains incomplete.
- Finish per-tool error metrics and measured source × billing attribution with explicit assumptions.
- Complete foreground replay, typed tool-error coverage and the tool-description audit. Bot denials and coding/research procedures are implemented, with the limits noted below.
- Complete reviewable or default-off prompt/offload/compaction variants; perform live quality/cost comparisons before enabling them. Stable/setup separation is implemented without enabling rewritten standing instructions.
- Implement retrievable large outputs and flagged compaction/offloading; broaden /btw acceptance to authenticated full-app and physical-device scenarios.
- Run final check, full tests, build, relevant desktop gates and UI verification after all changes.

Loop history is retained in ignored `LOOP_STATE.md`. No database drill or schema operation is part of this phase.


## Subsequent implementation evidence (2026-09-29)

Stable/setup separation is implemented with v3 standing wording preserved. The compatibility document renderer remains; both agent paths share the new preparation. `tests/agent-cache-layout.test.ts` checks stable bytes, exact tool-list ordering and setup/source attribution. The original fixture baseline remains `.cache/harness-evaluation/baseline.json`; a fresh capture is `.cache/harness-evaluation/after-layout-skills.json`. Added skill catalog entries increase setup size, so this is not a prompt-shrink result.

Per-Bot `disallowedTools` is an optional list of exact tool names in Bot config and reply/schedule inputs. It survives desktop cloud mapping, travels through both chat routes and detached jobs, filters advertised schemas without reordering other tools, and is enforced before dispatch/hooks/proposals. The detached executor checks the persisted Bot policy before replay or approval resolution. An OpenCode Bot with restrictions receives a typed, honest unsupported-policy response rather than running an unenforced managed toolset. This is an owner-configured Bot preference, not a new authorization boundary between a user and their own request API; a dedicated settings editor is not implemented.

`plan-edit-verify` and `multi-hop-research` are now invocable through the skill library. The coding procedure has the literal post-edit verification trigger; research separates snippets from pages read, follows references and cross-checks claims. These skills cannot conjure unavailable readers or bypass approvals. Existing detached replay already uses TurnJournal fingerprints and fenced checkpoints; the current foreground stream still lacks durable crash/resume coverage, so parity is not claimed yet.

Policy/reliability/runtime tests: 90 passed after correcting an implementation ordering error exposed by existing approval/recovery tests. Desktop cloud mapping/jobs tests: 12 passed. Full final gates continue to be rerun after the current changes. No percentage efficiency saving or no-quality-drop conclusion is established by these unit fixtures.


### Latest verified gates and rendered capture

After the policy/layout/skills changes: root check PASS; full suite PASS **687 tests, 2 existing skips** (100 passed test files); root build PASS (430.4 kB); desktop typecheck/build PASS (613.12 kB JS, existing non-blocking chunk-size warning). Desktop cloud mapping and jobs regressions passed 12 tests. Full test log is `.cache/harness-evaluation/final-tests.log`.

The new capture still has five fixture tasks, six requests, and a byte-identical 4,690-character stable system message across fixtures. Greeting setup is 1,202 serialized characters, and the skill catalog is 719 characters versus 447 before the two new skills. Coding attachment plus catalog is 2,181 versus 1,909 before. No provider billing attribution or task-quality score is inferred from these numbers. Setup boundaries were tested; caching improvement remains an unmeasured hypothesis.

The complete goal remains active. The remaining substantive work is foreground durable crash recovery, retained and authorized retrieval of large outputs, tool result/error telemetry and description audit, prompt/offload/compaction proposals or flags with rollback, and realistic matched quality/cost evaluation. The new procedures do not by themselves prove capability parity. The detailed user-requested implementation prompt is saved as `docs/rook-agent-implementation-prompt.md`.

## Foreground durable replay (follow-up chunk 1)

Clients may send an opaque `turnId` (8-128 chars, `[A-Za-z0-9_-]`) on `/api/agent/stream` and `workroom.reply`. With it, the server journals the turn in an append-only, unique-keyed log (`server/ai/foreground-replay.ts`, InstantDB entity `foregroundTurnEvents`, 24 h TTL, keyed by sha256 of owner/Bot/task/turn so one account can never read another's events). Without it, or when storage fails, the turn is byte-for-byte today's non-durable behavior.

- **Rounds**: each tool-requesting model response is recorded once; a retry replays it instead of asking the model again. If two attempts race, the first recorded response is canonical.
- **Side effects**: approval-gated tools atomically claim `sha256(toolCallFingerprint)` before dispatch (`TurnJournal` completion semantics, same fingerprints as the background runtime) and record their outcome, approvals and computer proposals afterwards. A retry rehydrates those into the result; a claim without an outcome (killed mid-step) is never re-dispatched and ends the turn with an honest "may already be waiting for approval" message (`OUTCOME_UNKNOWN`).
- **Read-only tools** re-run on replay and are never persisted, so connector data (cells, files) is not copied into the log. Secret-bearing rounds and outcomes are not persisted verbatim (`sanitize`).
- **Client**: the stream response carries `X-Rook-Turn-Replay: 1` when journaled; only then does the app retry through `workroom.reply` after tools already ran. Proposal UX is unchanged.
- **Deploy**: run `pnpm db:push` for the new entity before relying on it; missing schema fails open (no replay).

Verified hermetically (`tests/foreground-replay.test.ts`, both loops): kill after a completed step, kill between claim and outcome, concurrent duplicate attempt, recorded-error replay, no-`turnId` inertness, store failure, secret rounds, cross-user isolation, TTL. Not verified: a live InstantDB uniqueness conflict (the store test uses a fake that mimics it) and a real process kill on a deployed server.

## File-backed outputs and authorized retrieval (follow-up chunk 2)

Audit result: the retention mechanism already existed (`tool-output.ts`: sanitized JSON file per output, opaque `rook-output:<id>` reference, 7 day TTL, size caps, owner+Bot scope, range/search reads, typed failures) and the earlier harness-map row calling truncation "blind" was stale. The real gap was authorization: retrieval checked only owner and Bot, so output from a connector stayed readable for 7 days after the user disconnected it, deselected the repo, or the Bot began denying the source tool.

Changed:

- Each retained file records its source (`tool`, plus GitHub `repo` or Excel `account_id` when the call named one). Format version bumped to 2; version-1 files (no provenance) are unreadable, so they fail closed.
- `read_tool_output` re-authorizes that source at every read (`server/integrations/retained-output-scope.ts`): the source tool must not be in the Bot's `disallowedTools`; GitHub needs a live connection with the repo still in the working set; Excel needs a connected account (the named one, when recorded); computer/cloud file reads need a reachable computer target (`resolveComputerTarget`); skill text is allowed; unknown sources and any status-lookup failure deny.
- A denial returns the same `OUTPUT_UNAVAILABLE` error as a missing, expired, or foreign reference, so it does not reveal what exists.
- References remain opaque IDs, never filesystem paths; the model cannot name a path.

Measured (character counts, not billed tokens): a fixture GitHub read of 120,052 characters reaches the next model request as a 2,220-character descriptor in both loops. The five harness fixtures are unchanged by this chunk: per-source input characters are identical before and after (only the wall-clock line in the live setup differs), so there is no cost-table delta on the normal path. Cost impact appears only when a tool result exceeds the inline limit, and that behavior is unchanged from main.

Known limits: the store is local disk (`ROOK_TOOL_OUTPUT_DIR`, default the OS temp dir). On serverless or multi-instance hosting a later turn may land on an instance without the file and see `OUTPUT_UNAVAILABLE`; within one turn's rounds the file is normally present. Moving retention to shared storage needs a storage decision and is deferred. GitHub repo scope compares the repo named in the tool call before any PreToolUse hook rewrite (the hook registry is empty by default).

## Decision probe runner (follow-up chunk 5)

The matched quality/cost comparison is implemented as an operator-run probe over `chatgpt:` models through the existing authenticated session path, returning numbers only. It enforces a $25 cap per model request (operator-supplied rates, persistent ledger), starts at 5 repetitions and escalates to 10 only when a computed projection shows more data would be decisive, judges each variant on the pairs it actually changed, and prints a ship/no-ship scoreboard. Protocol, requirements, decision rule and statistical limits (notably that plan compaction can only `pass` with near-zero disagreement on its 30 to 60 exposed pairs) are in [eval-probe.md](eval-probe.md). No real numbers exist yet: the runner is verified offline with a scripted model only.


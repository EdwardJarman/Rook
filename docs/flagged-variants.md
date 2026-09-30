# Flagged variants (follow-up chunk 4)

Every variant is **default-off**, independent, and unevaluated for quality. None may be enabled outside the chunk 5 eval until that eval shows no success-rate regression beyond noise. A variant that saves characters but fails that test does not ship. Flags are read from the process environment (`ROOK_VARIANT_*`), or from a server-owned per-call `variants` override on `RookAgentInput` used by the eval harness. Chat routes strip unknown request fields, so clients cannot set either. Enabled variant names are recorded on each telemetry turn (`TurnRecord.variants`) for attribution. Flag-off requests are byte-identical to the pre-variant harness (pinned by tests).

| Variant | Env flag | Status |
| --- | --- | --- |
| Lean prompt | `ROOK_VARIANT_LEAN_PROMPT=1` | Implemented, tests green, quality unevaluated |
| Tool offload | `ROOK_VARIANT_TOOL_OFFLOAD=1` | Implemented, tests green, quality unevaluated |
| Plan compaction | `ROOK_VARIANT_COMPACT_PLAN=1` | Implemented, tests green, quality unevaluated |

## Lean prompt

Rewrites the stable system message per the keep/rewrite/delete decisions in [agent-system-prompt-audit.md](agent-system-prompt-audit.md) (`leanStable` in `server/ai/system-prompt.ts`, `ROOK_LEAN_PROMPT_VERSION = 1`). Removed: the duplicate identity sentence, the vendor-name list, "ultra-think/ultra-code", blanket "keep answers tight", capitalised emphasis, the truncation workaround (replaced by the retained-output pointer, now that file-backed results exist) and the "doctrine" wording. Rewritten: assumption guidance (low-stakes: assume and say so; blocking: ask), current-message priority (continuation of earlier work is allowed, not treated as a fresh start), citation ("title and URL"). Kept in substance: identity delimiting and escaping, route transparency, no invented success, approval-only writes, secret and private-reasoning boundaries, snippet-vs-page honesty, connector preference, batching, precise references, shared-computer facts and its approval and credential boundaries. Setup, tools, history and the user turn are untouched.

Measured (`tests/harness-baseline.test.ts`, serialized characters, not billed tokens; regenerate with `ROOK_VARIANT_LEAN_PROMPT=1 ROOK_WRITE_HARNESS_BASELINE=1`):

| Task | System chars off → on | First-request total off → on |
| --- | ---: | ---: |
| greeting | 4,690 → 3,251 (-1,439) | 9,205 → 7,721 (-16.1%) |
| ambiguous-code | 4,690 → 3,251 | 10,858 → 9,374 (-13.7%) |
| research | 4,690 → 3,251 | 9,508 → 8,024 (-15.6%) |
| computer-status | 4,690 → 3,251 | 9,224 → 7,740 (-16.1%) |
| long-followup | 4,690 → 3,251 | 32,211 → 30,727 (-4.6%) |

The stable prompt alone is 4,666 → 3,210 characters (-31%) for the test bot. No other request source changes. These numbers say nothing about answer quality, honesty or initiative, which is the risk the audit flagged as medium/high. Character counts are also not a cost claim: caching may already discount this prefix, so realised savings could be smaller.

Untested risks to watch in the eval: fewer explicit "tight answer" cues may lengthen replies (more output tokens); dropping "ultra-code" may change coding depth; the stale-topic regression guard was reworded.

**Rollback:** unset `ROOK_VARIANT_LEAN_PROMPT` (or set it to anything but `1`/`true`) and redeploy or restart. No data or schema is involved. Code revert: `git revert` the chunk 4a commit; the legacy builder was never modified.

## Tool offload

Five low-use tools stop riding every request: `excel_list_tables`, `excel_add_worksheet`, `excel_create_workbook`, `github_repo_overview`, `computer_propose_task` (`OFFLOADABLE_TOOL_NAMES` in `server/ai/tool-offload.ts`). **This list is a hypothesis from tool purpose, not measured call share** (PR #38's audit found no real usage data). In their place a small `load_tools` tool, appended last, lists them with one-liners. Calling `load_tools({names})` returns their full definitions and activates them for the rest of the turn (`ToolActivation`; rebuilt from message history on a resumed turn). If the model calls an offloaded tool directly, the dispatcher still runs it (all policy checks unchanged) and activates it, so a model that knows the name is never blocked, only possibly slower or less accurate without the schema. Read, search, edit and shell tools are never offloaded (pinned by test). Bot `disallowedTools` are respected for both the pointer and the loaded tool; the pointer is omitted when nothing offloadable is permitted or offered. `load_tools` is read-only and registered in `TOOL_REGISTRY` / `TOOL_RISK` (offered-tool count pin 19 -> 20).

Measured (characters, not tokens):

| Scenario | Tool definitions off → on |
| --- | ---: |
| All connectors (19 offered tools) | 11,551 → 9,307 (-2,244, -19%); 15 tools |
| Harness fixtures (no connectors) | 2,247 → 1,950 (-297, -13%) |

Costs not counted above: an extra round (and its full-request resend) whenever the model loads a tool before using it; and the tool list changes mid-turn on load, which can defeat provider prefix caching for later rounds. Either can exceed the schema saving on tasks that do use an offloaded tool. Per the pre-registered rule in the audit, the eval must show no rise in `invalid_arguments`/error rate, extra rounds, or success regression, and share of the offloaded tools must be confirmed low on real traffic (>=500 calls, <2%).

**Rollback:** unset `ROOK_VARIANT_TOOL_OFFLOAD` and restart. Code revert: `git revert` the chunk 4b commit (removes `load_tools`, restores the 19-tool pin).

## Plan compaction

**Finding first.** The existing checkpoint ledger cannot engage through the real API. The chat routes accept at most 8 context entries of 2,000 characters (about 4,100 tokens by the 4 chars/token heuristic) against a 6,000-token verbatim budget, and a relevance gate runs before the budget. Only the synthetic 40-entry harness fixture ever overflows. So compaction is currently a no-op in production, and full history (up to about 16,000 characters) is resent every turn.

The variant (`ROOK_VARIANT_COMPACT_PLAN`) lowers the verbatim budget to 1,500 tokens (`PLAN_HISTORY_BUDGET_TOKENS`) and replaces the extractive ledger with `buildPlanLedger` (deterministic, no model call, capped at 1,600 characters): the oldest user request (usually the goal), the four newest user asks, up to three bot commitments, and, when possible, a pointer to the full condensed messages. Those are retained through the existing scoped output store as a redacted transcript (`conversation_transcript` source, owner + Bot scoped, 7 day TTL, readable with `read_tool_output`; credentials are redacted before writing). No pointer is added, and nothing is written, when the Bot disallows `read_tool_output` or storage fails. The relevance gate, the newest-messages-verbatim rule and the honesty header are unchanged.

Measured (characters, not tokens):

| Scenario | Verbatim history off → on |
| --- | ---: |
| API maximum (8 x 2,000, all relevant) | 16,000 → 4,000; +775 setup characters (ledger and pointer); 6 turns condensed |
| Harness `long-followup` (40 entries, beyond API limits, best case) | 21,788 → 3,961; first request 32,211 → 14,305 (-55.6%) |
| Other four fixtures (no history overflow) | unchanged |

Risks not measured: **lost intent and obligations** are the main danger (rank 5 in the opportunity table was High risk); the ledger keeps asks and commitments by pattern, not by understanding, so a constraint stated in a middle turn can be dropped from the ledger and only be recoverable if the model chooses to read the transcript (an extra round). It also changes what the model sees on every multi-turn chat, unlike the other variants. No success-rate evidence exists.

**Rollback:** unset `ROOK_VARIANT_COMPACT_PLAN` and restart. Transcript files already written expire in 7 days and hold only redacted conversation text the same owner sent. Code revert: `git revert` the chunk 4c commit.

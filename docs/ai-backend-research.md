# AI Backend Research — agentic skills + big-tech harness guidance

**Date:** 2026-09-10 · **Purpose:** ground Rook's backend refinements in primary sources, not lore.
Every section ends with what Rook adopts, rejects, or already does.

## 1. Anthropic — Agent Skills (SKILL.md, open standard)

- **Format** (`agentskills.io/specification`, `github.com/agentskills/agentskills`):
  folder `skill-name/SKILL.md`, frontmatter `name` (1–64ch, lowercase-hyphens,
  matches dir) + `description` (1–1024ch, what + **when to use**), optional
  `license`, `compatibility`, `metadata{str:str}`, `allowed-tools`
  (experimental, space-separated). Body `<500 lines`.
- **Progressive disclosure** (anthropic.com/engineering, platform.claude.com):
  L1 metadata (`name+description` only, resident) → L2 full body on match →
  L3 `references/` + `scripts/` on demand (script *output*, not source).
  Rule of thumb: always-on facts live in `CLAUDE.md`; procedures stay in skills.
- **Harness** (code.claude.com, harnessing-Claude's-intelligence):
  static-first ordering (`system+tools → CLAUDE.md → session → messages`),
  `__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__` for prompt caching, deferred MCP
  tool-search, auto-compact with the *same* system/tools to preserve cache,
  re-attach last skill post-summary. Permissions: Ask/AskUserQuestion gates,
  plan-mode as a tool-level state, denied ≠ retry-verbatim.
- **Adopt:** progressive-disclosure *principle* (resident index, ephemeral
  detail), static-first prompt ordering, plan-vs-act separation in guidance,
  "prefer typed tools, batch independent reads" disciplines.
- **Reject (for now):** full SKILL.md directory/discovery runtime — Rook's
  client Skill type carries no instruction bodies, so there is nothing to
  disclose yet; building discovery without content would be theater.

## 2. OpenAI — Codex loop, Responses API, function calling

- **Loop** (`openai.com/index/unrolling-the-codex-agent-loop`):
  strict `instructions / tools / input` separation; SSE streaming with tool
  execution only on `output_item.done`; *stateless* requests (no
  `previous_response_id`) for ZDR; prompt caching needs **exact prefix
  match** — static content first, variable content last, frozen tool order
  (their real bug: unsorted MCP tools killed the cache); auto-compaction
  behind a threshold with the compacted window treated as canonical.
- **Function calling** (developers.openai.com function-calling guides):
  verb-first names, units/formats/edge-cases in descriptions, `<20` eager
  tools, `strict:true` schemas (`additionalProperties:false`, all-required),
  `parallel_tool_calls:false` for mutating tools, gate phases with
  `tool_choice` instead of mutating the tool list, always return
  `function_call_output` keyed by `call_id` (`{ok,error,retryable}` on
  failure — never throw/skip), never repeat completed side-effects.
- **Adopt:** static-first prompt layout, frozen tool order (pinned by test),
  failure-as-tool-output (already Rook's shape), one-write-per-turn
  (already), reasoning/tool items replayed verbatim (already).
- **Already aligned:** stateless turns (multi-provider forces this anyway),
  no provider-side IDs.

## 3. Google — ADK, Gemini calling; Microsoft — AutoGen, agent checklists

- **ADK** (google.github.io/adk-docs): separate *planner policy* from *tool
  registry*; session state scopes (`session:`/`user:`/`app:`/`temp:`);
  memory = `store()` consolidated facts at handoff end + `recall()` top-N at
  start (hybrid BM25+vector), never raw logs; **eval sets from day one**
  (`tool_use_quality`, `multi_turn_task_success`, 5–10 iterations).
- **Gemini calling** (ai.google.dev): parallel + compositional chaining,
  `VALIDATED` mode, 10–20 active tools, round-trip signed parts unmodified,
  `thinking_level` cost control.
- **AutoGen** (microsoft.github.io/autogen): Selector pattern (meaningful
  agent descriptions + `TextMention("TERMINATE") | MaxMessage(n)` bounds);
  Magentic-One outer/inner ledgers; composable termination.
- **Microsoft checklists** (learn.microsoft.com/agents): explicit confirmation
  for destructive/open-world calls, AI disclosure, editable outputs.
- **Adopt:** store/recall memory split (Rook: extract→client store→inject —
  same shape, no vector DB needed at this scale), golden-case evals,
  termination bounds (already: 6 rounds + budgets).

## 4. MCP spec (2025-11-25; draft 2026-07-28)

- **Tool annotations** (spec + 2026-03-16 blog — verified verbatim):
  `readOnlyHint` (default false), `destructiveHint` (default true),
  `idempotentHint` (default false), `openWorldHint` (default true).
  **Hints, not contracts** — untrusted servers can lie; safety lives in
  deterministic controls. Client mapping: readOnly→skip confirm,
  destructive→warn, idempotent→safe retry, openWorld→scrutinize output.
  Pessimistic defaults are the point.
- **Elicitation** (client/elicitation): `form` for parameter approval,
  `url` mode for credentials/payments; always declinable. (Rook's Updates
  approvals are the same pattern, human-first.)
- **Do NOT build on:** Sampling + Roots — deprecated (SEP-2577, 1-yr grace).
- **Client best practices:** progressive discovery (catalog→inspect→execute),
  `isError` text (not transport errors) so models self-correct, stable
  ordering for cache, strict `inputSchema`, `server_verbNoun` naming.
- **Adopt:** honest risk metadata on Rook's own tools (trusted first-party,
  so hints *are* actionable here), when-to-use-first descriptions,
  failure-as-text (already).

## 5. xAI — Grok Bot (docs.x.ai/grok-bot, x.ai/bot)

- One shared computer per account (files/logins shared, per-Bot screens —
  separate surfaces, not security boundaries); connector-first, browser when
  no clean API; skills (`/`) + connectors (`@`) + scheduled routines;
  approvals for consequential actions; takeover flow for secrets (never paste
  passwords/2FA into chat); persistent named teammates with memory.
- **Adopt:** already Rook's architecture (Rook Node = user-owned shared
  computer, connector-first Excel/GitHub, proposals+approvals, takeover
  guidance, memory loop). No change — confirmation, not a gap.

## What this loop implements (traceability)

| # | Change | Sources |
|---|--------|---------|
| 1 | Static-first system prompt (stable rules up front, volatile clock/computer/memory/search trailing) + frozen tool order pinned by test | Anthropic harness, OpenAI caching |
| 2 | Deterministic conversation checkpoint (ledger for dropped history, no silent loss, no extra model call) | OpenAI compaction, ADK sessions |
| 3 | Tool risk metadata + when-to-use-first, unit/format-tightened descriptions | MCP annotations, OpenAI function-calling |
| 4 | Golden multi-turn loop tests with mocked providers (eval-set seed) | ADK evals |
| 5 | Tool-use disciplines codified in prompt (typed tools, batch reads, no re-call) | Anthropic authoring lessons |

## Explicit non-goals (rejected with reason)

- SKILL.md directory/discovery runtime: no instruction bodies exist yet.
- Vector memory / embeddings: 20-line memory field doesn't need retrieval.
- Server-side reasoning replay (encrypted thought signatures): providers
  Rook uses don't expose them; verbatim message replay already done.
- `strict:true` function flag: non-standard for OpenRouter free models;
  standard strict-*shaped* schemas instead (already sent).

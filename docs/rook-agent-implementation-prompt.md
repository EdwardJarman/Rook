# Rook: capability, efficiency, and side questions

Implement improvements in this repository that make Rook more capable, reliable, and responsive while reducing price-weighted token cost per completed task. Task quality must not measurably decline. Use the existing architecture and providers; preserve ongoing uncommitted work. Do not commit, push, deploy, or change a database target without explicit authorization.

## Start from evidence

Read the saved goal objective, repository instructions, current git status/diff, and LOOP_STATE.md. Map both agent loops, request assembly, system prompts, tool registration/dispatch, provider gateways, retry/fallback logic, history/compaction, skills, policy/hooks, telemetry, and mobile/web/desktop chat entry points. Extend shared paths rather than creating a third agent loop. State which parts are already implemented and verified before changing them.

Instrument request usage first: output, uncached input, cached input, cache writes where reported, reasoning usage, provider-reported cost, model identity, request status and latency. Attribute all physical requests and retries to a task and include child-agent spend where observable. Missing usage is unknown, never zero. Keep credentials and conversation content out of telemetry. Render representative assembled requests using fictional or explicitly authorized data, then measure their sections with a tokenizer or provider usage where available. Character counts are useful diagnostics but are not billed tokens or cost attribution.

Report whole-task costs, turns, cache hits, tool usage/error rates, and quality outcomes. Rank opportunities by spend share × removable fraction ÷ quality risk. Verify current provider-specific caching and pricing from official sources; avoid invented universal cache TTLs or rates.

## Improve the harness

Keep stable instructions and deterministic tool ordering before volatile setup. Move dates, live capabilities, repository state and per-turn skills/context after the stable prefix. Preserve reasoning items across provider turns. Add reversible infrastructure fixes directly; keep behavior-changing prompt edits, tool offloading, formatting and compaction behind default-off flags or documented proposals until matched evaluations support them. Model routing and reasoning-default changes are proposals, not silent production changes.

Audit prompt lines as keep, rewrite, delete or move, with reasons. Describe tools plainly. Keep high-frequency and first-turn tools available. Make other families discoverable without letting missing tools cause repeated errors. Large results should be sanitized, stored under the correct owner/task, and returned as a reference with a small preview and a functioning authorized range-read path. Do not truncate away the only copy. Compaction should retain goals, decisions, plan state, unfinished work and a retrievable full-history pointer. Do not tell the model to do less or conserve effort.

Close reliability gaps in both streaming and non-streaming loops: terminal auth/config/policy/unknown-tool failures, bounded transient retries, one budget shrink-and-retry, repeated-call detection, and crash replay that does not double-execute side effects. Enforce per-Bot disallowed tools alongside existing allowlists. Keep coding plan/edit/verify and multi-hop research available as skills. Tie special prompt instructions to observed failures, and describe actual tool, approval and Coffeehouse boundaries honestly.

## Build /btw as a real product feature

A user can ask a quick side question while an agent works or while drafting a main message. Choose a calm, discoverable interaction that fits Rook. A separate dismissible panel with its own input is a strong starting point, but use judgment about layout, accessibility and small screens.

Support both an obvious visible control and `/btw <question>`. Opening the aside preserves the main draft and attachments. Asking, stopping, retrying or dismissing affects only the aside: no cancelled foreground/background work, persisted chat message, task creation, memory write, approval, or conversation pollution. On account, Bot or conversation changes, hide the old answer and discard late responses. Keep keyboard focus predictable and offer mobile-sized touch controls.

Use one lightweight, bounded, tool-free model response grounded in a small snapshot of the visible conversation. Treat quoted context as data. Explain when the answer would require an action in the main chat. Reuse existing authentication and provider transport. Streaming and buffered clients must consume the same response rather than regenerate an answer. Use independent cancellation, timeouts, concurrency protection and actionable error/retry states. Show the model actually used. A distinct small/free model is acceptable for this new feature when justified; do not change the main Bot's selected route.

Measure first-token and end-to-end latency and reported cost on real, harmless examples. Aim for fast perceived response, but do not claim an instant or reliable latency target from one sample. Preserve room to improve wording, visual design and implementation where the requirements leave choices open.

## Validate and finish

Use deterministic tests with injected clocks/randomness where needed. Cover cancellation and stale replies, streaming fragmentation and JSON fallback, auth/errors/concurrency, main-state isolation, replay dedup, denials, and retrieval authorization. Exercise actual components on desktop and narrow mobile/web layouts. Distinguish fixture verification from real provider or device acceptance.

Run a fixed set of realistic short/ambiguous tasks before and after. Compare success, whole-task cost, turns, tool errors, latency and cache hits. Record null results and missing evidence; don't ship quality regressions or claim savings without measurements. Finish with root check, full tests and build, plus relevant desktop checks/build. Rerun known flaky suites without weakening assertions. Update LOOP_STATE.md each iteration.

Deliver a concise report with the harness map and baseline, ranked changes and savings estimates with assumptions, implemented changes and per-line prompt audit, flag/proposal test and rollback plans, /btw design and measured behavior, gate results, and unresolved gaps. Keep all changes reviewable and wait for the user's push decision.

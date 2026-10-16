# Rook side questions (/btw)

Implemented 2026-09-29. No commits, pushes, schema changes or database drills were performed in this phase.

## Behavior and design

The composer has a Side question control (desktop labels it `/btw`). It opens an independent input and dismissible answer panel. Opening it preserves the main draft and attachments. Sending `/btw <question>` consumes that command from the main input, preserves attachments, and creates no main message or task. A bare `/btw` opens the aside input. Ordinary mentions of `/btw` within prose remain regular messages.

The aside has its own request identity, AbortController, draft, streaming text and retry state. Stop/dismiss never touches a main-turn abort handle or background job. Account/Bot/conversation changes remount the panel and invalidate late responses. Desktop additionally scopes it to the workspace. Web and desktop support Enter to ask, Shift+Enter for a newline, and Escape from the input to dismiss; mobile has 44-pixel controls. Answers remain local to the mounted panel and do not enter persisted conversation history or memory. The panel gives enough context to understand the answer without making another chat thread.

`POST /api/agent/btw` uses existing authentication, validates input, permits one active aside per authenticated owner in that server process, and releases the slot on failure or disconnect. It returns SSE or JSON from the same answer operation. The native buffered path never regenerates an answer when streaming is unavailable. The client supports native AbortSignal polyfills without `throwIfAborted`.

The provider receives one bounded, tool-free response request: question up to 1,600 characters, at most eight recent messages/6,000 body characters, optional 1,000-character current-work excerpt, and a 900-token output limit. A 30-second signal bounds generation. Quoted context stays in a user message rather than system instructions. No dispatcher, memory write, notification, task or approval operation is called by the aside service. Existing transport may perform its own compatibility retry, which request accounting observes.

The selected stream-capable model is preserved. For ChatGPT-plan/OpenCode routes, the aside uses the existing `openrouter/free` route to avoid launching a separate heavyweight managed agent; it does not change the main Bot setting. This requires that existing route to be configured and available. The returned model is shown below the answer. Main-model routing defaults were not changed.

## Evidence

Hermetic tests cover explicit slash parsing, context bounds, duplicate-send suppression, stop/retry, stale tokens/completions, auth cancellation, SSE fragmentation and Unicode, buffered SSE, JSON fallback, incomplete streams, error redaction, endpoint authentication/validation/concurrency/disconnect, service timing and unexpected tool calls. These are service/controller contracts, not a physical Android install test.

Browser QA rendered the actual desktop and React Native Web panel components in an ignored local fixture with simulated replies and a 350-pixel compact layout. Verified independent inputs, answer formatting, Enter-to-ask, retry feedback, slash entry, and panel removal while answering on conversation change. Host theme/auth/transport were fixture adapters; no authenticated production UI acceptance or physical-device acceptance is claimed. Pointer automation in the in-app browser was offset; keyboard activation completed the interaction checks.

Real service probe at 2026-09-29T11:51:06.291Z used fictional DNS context and the existing configured free route, with no DB calls:

| Measurement | Observed |
| --- | --- |
| Requested / resolved model | openrouter/free / dots-studio/dots-3-note-preview:free |
| Provider requests | 1 |
| First answer token, including setup/catalog | 4,787 ms |
| Answer completion, including setup/catalog | 6,107 ms |
| Provider request latency / first token | 5,073 ms / 3,753 ms |
| Input / uncached / cached tokens | 161 / 161 / 0 |
| Output tokens | 258, including 189 reported reasoning tokens |
| Provider-reported cost | $0 |
| Result | Correctly expanded DNS TTL and interpreted 300 seconds as five minutes |

This single cold-route example proves a real response and telemetry; it does not establish p50/p95 latency, a cost saving, or equivalence across models. Further latency work should benchmark selected small models with fixed tasks and propose a default only after evaluating quality and availability. Do not quietly change main-model routing.

Raw fictional probe evidence: `.cache/harness-evaluation/btw-live.json`. Temporary UI fixture: `.cache/btw-qa/` (ignored). Review the implementation prompt in `docs/rook-agent-implementation-prompt.md` and the broader harness findings in `docs/agent-harness-efficiency.md`.

## Validation and remaining work

Root check, full suite (677 passed, 2 skipped), root build, desktop typecheck and desktop production build passed before the final native AbortSignal compatibility patch; its focused regression passed (17 tests across client/service/route). Desktop build retains a non-blocking large-chunk warning (612.85 kB). No full-task efficiency or capability-parity completion claim is made: foreground durable replay, output retrieval, and optimization evaluations remain tracked in the harness report; per-Bot denials, invocable skills and stable/setup separation were subsequently implemented.


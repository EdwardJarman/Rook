# Decision-grade probe (follow-up chunk 5): operator protocol

A local runner that compares the baseline harness with each flagged variant (`docs/flagged-variants.md`) on 25 fixed, short, ambiguous tasks, using **real `chatgpt:` model calls through Rook's existing authenticated session path**. It runs on the operator's machine with the operator's own ChatGPT plan. No shared provider key is used or accepted, no key or session reaches any other environment, and the output is a numbers-only JSON file plus a printed scoreboard.

Nothing here has been run against a real session. The runner, meter, scoring and statistics are verified offline with a scripted model (`tests/probe-runner.test.ts`, `tests/probe-meter-wiring.test.ts`). Real ChatGPT behaviour, rate limits and cache reporting are unverified until the operator's smoke run.

## Terms agreed with the owner

- **$25 hard cap, enforced by the runner** (details below). The cap can be lowered (`ROOK_EVAL_BUDGET_USD`) but never raised: values above 25 are rejected.
- **Start at 5 repetitions per task; go to 10 only when the data shows more repetitions would be decisive** (escalation gate below). `ROOK_EVAL_ESCALATE=off` pins it at 5.
- **Anything without measured success parity stays off.** The scoreboard ships a variant only with a `pass` verdict on the pairs it actually changed and a demonstrated saving.

## What you need (the "session-bearing environment")

| Variable | Purpose |
| --- | --- |
| `CLERK_SECRET_KEY` | Required by the *existing* ChatGPT path: it verifies the Clerk token and decrypts the stored ChatGPT session with a key derived from it. Your app's Clerk secret, not a model-provider key. Never logged or written. |
| `ROOK_EVAL_SESSION_TOKEN` **or** `ROOK_EVAL_SESSION_TOKEN_CMD` | A Clerk session JWT for a user who has connected ChatGPT, or a command that prints a fresh one (re-run when older than 45 s; default Clerk tokens live about 60 s). A `rook_` CLI token does not work here. |
| `ROOK_EVAL_MODEL` | Pinned model, `chatgpt:<slug>` exactly as in your model list (the runner lists your models and refuses an unknown one). |
| `ROOK_EVAL_RATE_INPUT_PER_M`, `ROOK_EVAL_RATE_OUTPUT_PER_M` | **Required.** USD per million tokens from a rate snapshot you verified. The runner never assumes prices. Optional `ROOK_EVAL_RATE_CACHED_PER_M` (defaults to the input rate). Reasoning tokens are a subset of output and are priced as output. |
| `ROOK_EVAL_CONFIRM=run` | Guard so `pnpm eval:probe` never spends anything by accident. |

The runner **refuses to start** if `OPENROUTER_API_KEY`, `ORCAROUTER_API_KEY` or `TOKENROUTER_API_KEY` is set (on a transient ChatGPT failure the router would fall back to the shared route and contaminate the eval). Any trial whose provider is not `chatgpt` is also recorded invalid (`fallback_used`). All connector backends are stubbed, so nothing is read from or written to real services.

## How the $25 cap is enforced

The ChatGPT path reports tokens, not dollars, so cost is computed at your rates. **With a subscription the dollar figure is an API-equivalent budget; your plan's own usage limits are a separate constraint the runner cannot see.**

- **Per model request, at the router boundary.** The entry wraps the real `invokeAiResilient`. Before each request the meter reserves its worst case (twice the estimated input at 3 characters per token, plus at least 6,000 output tokens or 1.5x the largest output seen, all doubled for an SDK retry it cannot see). The request is sent only if `spent + reserve <= 95% of the cap` ($23.75 at the default). Otherwise it is refused without a provider call and the run stops with `truncated: budget_cap`.
- **Fail closed.** With no meter installed the wrapper refuses every model call, so nothing can bypass it. Tested against the real router function.
- **Charges are conservative.** Actual usage x 1.1. Unknown cached tokens are charged as uncached. Missing usage is charged from an estimate and counted (`estimatedCharges`). A failed request is charged its estimated input.
- **Cumulative across runs.** A ledger file (`.cache/harness-evaluation/probe-spend.json`, or `ROOK_EVAL_LEDGER`) persists spend and the in-flight reservation, written before each call, so a killed process still counts and a second run cannot spend the same dollars again. A corrupt ledger stops the run instead of resetting. Delete it only deliberately.
- **Before each trial** the runner also stops if the remaining budget is under 1.5x the average trial cost, so a trial is not started that would be cut off.

What this does **not** guarantee: the cap is per-request pre-authorization with 5% ($1.25) headroom. It is not mathematically unbreakable. A single response costing more than its reservation by more than the headroom (for example a reasoning response beyond roughly 12,000 output tokens), hidden SDK retries beyond the assumed factor of 2, or provider-side usage under-reporting could exceed it. The smoke run prints real spend so you can check the reserve against reality before the full run.

## Run it

Smoke first (2 trials, about 2 to 4 requests). It confirms the session, the model, the rates, the fallback guard and the ledger, and tells you real dollars per trial.

```powershell
$env:CLERK_SECRET_KEY = '...'           # your existing local secret
$env:ROOK_EVAL_SESSION_TOKEN_CMD = '<command that prints a Clerk session JWT>'
$env:ROOK_EVAL_MODEL = 'chatgpt:<slug>'
$env:ROOK_EVAL_RATE_INPUT_PER_M = '<usd>'; $env:ROOK_EVAL_RATE_OUTPUT_PER_M = '<usd>'
$env:ROOK_EVAL_CONFIRM = 'run'
$env:ROOK_EVAL_TASKS = 'small-talk,model-identity'; $env:ROOK_EVAL_ARMS = 'baseline'; $env:ROOK_EVAL_REPS = '1'
corepack pnpm eval:probe
```

Then the real run (unset the three smoke variables; POSIX shells use `export`). Defaults: 5 reps, escalating to at most 10 under the gate, cap $25:

```powershell
Remove-Item Env:ROOK_EVAL_TASKS, Env:ROOK_EVAL_ARMS, Env:ROOK_EVAL_REPS
corepack pnpm eval:probe
```

Optional: `ROOK_EVAL_ARMS` (`baseline, baseline_repeat, lean_prompt, tool_offload, compact_plan, all_variants`; default is the first five), `ROOK_EVAL_REPS`, `ROOK_EVAL_MAX_REPS`, `ROOK_EVAL_ESCALATE=auto|off`, `ROOK_EVAL_BUDGET_USD` (at most 25), `ROOK_EVAL_SEED`, `ROOK_EVAL_MIN_INTERVAL_MS`, `ROOK_EVAL_MAX_REQUESTS` (secondary cap), `ROOK_EVAL_OUT`, `ROOK_EVAL_LEDGER` (simple `.json` paths).

Send back the JSON (`.cache/harness-evaluation/probe-<time>.json`) and the printed scoreboard. Both contain numbers and fixed labels only.

### Expected size (measured request sizes, unknown prices)

First-request size over the 25 tasks, from the assembled requests (characters; about 4 per token): baseline 12,006, lean prompt 10,596 (-12%), tool offload 11,083 (-8%), plan compaction 11,935 (-0.6%, because it only changes long-history tasks). Phase one is 25 tasks x 5 arms x 5 reps = 625 trials; escalation adds at most 25 x 5 x (2 baselines + resolvable arms) trials. Requests per trial (1 without tools, 2 or more with) and output/reasoning tokens are **not measured**; take dollars per trial from the smoke run (`spent / trials`), multiply by 625, and compare with $23.75. If it does not fit, the run simply truncates (repetitions are scheduled round by round, each shuffled from its own seed, so truncation leaves matched arms at equal repetitions except for the last partial round), or narrow `ROOK_EVAL_ARMS`.

## What is measured

Arms: `baseline`; `baseline_repeat` (identical, to measure noise); each variant alone; optionally all three together. Every task runs in every arm, repetition by repetition, order shuffled from a seed so backend drift hits all arms alike.

Per trial: success, checks passed, model requests, tool calls, tool errors, invalid-argument calls, skipped calls, `load_tools` calls, approvals, input / cached / output / reasoning tokens, latency, **metered cost**, first-request size. Success is deterministic: every check of the task passes (regexes and tool-call predicates in `evals/probe/tasks.ts`; no model judges another model). The 25 tasks cover small talk, ambiguous fix-it, stale topic, fresh facts, snippet honesty, GitHub read and find-then-read, Excel read, write proposal, not connected, denied write, offload candidates (`excel_add_worksheet`, table append), computer status and propose, a large retained output, a prompt injection in a tool result, credentials in chat, model identity, and **six long-conversation tasks** where a critical fact is stated early: three beyond the compaction ledger's 160-character line cut and three within it. Those six exist because compaction changes nothing on short conversations; whether such constraints are common in real use is unknown, so the compaction result is a stress result, not a prevalence estimate.

Validity: a trial is **invalid, not failed**, when it throws, has no telemetry, used a non-`chatgpt` provider, ended on a provider/session error, or was cut off by the budget. A deliberate loop stop (for example a doom loop) is a real failure. Invalid trials are excluded pairwise. The run stops after 3 consecutive provider failures, when more than 20% of trials are invalid (after 10), at the request cap, or at the budget, and records why.

### Exposure: judge a variant where it acted

A pair is **exposed** when the variant changed the trial's first request (measured, not assumed). Averaging in tasks a variant never touches dilutes both its savings and its regressions; in a test, a regression on 10 exposed pairs out of 125 looked like a pass suite-wide. So the verdict, matched success rates, savings and tool-error comparison are computed on exposed pairs, with noise measured on the same tasks, and suite-wide numbers are shown beside them. Lean prompt and tool offload touch every task; plan compaction touches the six history tasks (30 exposed pairs at 5 reps, 60 at 10).

## Escalation gate (5 to 10 repetitions)

After the first 5 repetitions the runner computes, per undecided variant (verdict `inconclusive`), an optimistic projection: the current interval shrunk by sqrt(5/10) with the mean held fixed. It buys more repetitions only for variants whose projection would **reach a pass** (lower bound within 5 points) **or a kill** (upper bound below zero), and only if the projected extra cost (measured cost per trial, 25% margin) fits the remaining budget. Killed and passed variants stop receiving data; baselines continue. Otherwise it stops and records why (`noise_cannot_resolve`, `no_undecided_variant`, `over_budget`, ...). The report carries the numbers behind the decision: observed disagreement, repetitions a pass would need at that disagreement, projected and remaining dollars. So "the noise demands it" is a recorded calculation, not an assertion.

## Scoreboard and ship rule

Per variant, from matched exposed pairs: success rates (baseline versus variant) and their paired difference with a bootstrap 95% interval; cost per task at your rates (difference and interval); input-token saving; output-token, request and tool-error differences; suite-wide success difference and saving. Verdict (`verdictFor`): `kill` if the interval is entirely below zero or the mean is worse than the baseline-repeat noise interval's lower edge; `pass` if the interval rules out a drop larger than 5 points; `insufficient` under 30 exposed pairs or without a noise estimate; otherwise `inconclusive`.

**SHIP only if** the verdict is `pass` **and** the cost saving interval is entirely below zero **and** tool errors did not rise (interval not above zero) **and** fewer than 10% of costs were priced from estimates. Anything else is NO-SHIP with its reasons (`success_regression`, `success_parity_not_shown`, `insufficient_data`, `saving_not_demonstrated`, `tool_errors_increased`, `cost_mostly_estimated`). Cost never upgrades a verdict.

## Read this before trusting a verdict

The 95% interval on a paired success difference is about 1.96 x sqrt(d / n) for d the share of pairs that disagree and n the pairs. With the full suite (25 tasks) that is about +/-0.08 at 5 reps (125 pairs) and +/-0.055 at 10 reps (250 pairs) when 20% of pairs disagree. A `pass` needs the interval's lower bound above -5 points, roughly n >= 3.84 x d / 0.0025 pairs: at 5 reps it needs disagreement of about 8% or less, at 10 reps about 16% or less. For plan compaction, with only 30 to 60 exposed pairs, a `pass` effectively needs near-zero disagreement (no disagreeing pair at 30, about one at 60); a real regression or even ordinary noise will land on `kill` or `inconclusive`. That is the honest limit of a fixed suite on a plan-backed model, and it is why compaction is unlikely to ship from this evidence whatever its savings.

## Other limits

- **Tokens priced at your rates, not billed dollars.** Cached versus uncached is `null` when the endpoint reports no cache reads, in which case cost is an upper bound for every arm equally but prefix-cache benefits are invisible.
- **Requests are a lower bound** (the SDK retries once inside the call, invisible to Rook; the meter's reservation allows for it).
- **One model; sampling not controllable.** No temperature or seed is exposed; `baseline_repeat` measures the resulting noise.
- **Stubbed connectors and fictional data.** Tool-call shape and validation are real (real dispatcher and schemas); backend content is scripted.
- **Regex checks are proxies.** The same checks apply to every arm, so bias largely cancels; spot-check a disagreeing task in `perTask` before acting on a borderline verdict.
- **Offload candidate list is a guess** (no real call-share data exists). Read its `loadToolsCalls`, `requests` and `toolErrors` differences, not only success.
- **Exposure is measured from first-request size.** A run straddling a month or day boundary can change the clock line's length and mislabel a few pairs as exposed.

## Where the code is

`evals/probe/`: `probe.eval.ts` (operator entry, skipped unless confirmed), `harness.ts` (schedule, phases, escalation, scoring, scoreboard, report guard, preflight), `meter.ts` (spend meter, ledger, rates, cap), `tasks.ts`, `world.ts` and `mocks.ts` (connector stubs), `stats.ts`. `vitest.eval.config.ts` selects only `*.eval.ts`, so `pnpm test` never runs the probe.

Rollback: revert the PR. The only production-code change in the probe line is the additive `errorCode` telemetry field.

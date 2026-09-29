# Decision-grade probe (follow-up chunk 5): operator protocol

A local runner that compares the baseline harness with each flagged variant (`docs/flagged-variants.md`) on 20 fixed, short, ambiguous tasks, using **real `chatgpt:` model calls through Rook's existing authenticated session path**. It runs on the operator's machine with the operator's own ChatGPT plan. No shared provider key is used or accepted, no key or session reaches any other environment, and the output is a numbers-only JSON file.

Nothing here has been run against a real session. Everything below the runner (task loop, stubs, scoring, statistics, report guard) is verified offline with a scripted model in `tests/probe-runner.test.ts`. Real behaviour of the ChatGPT path, rate limits and cache reporting are unverified until you run the smoke test.

## What you need (the "session-bearing environment")

| Variable | Purpose |
| --- | --- |
| `CLERK_SECRET_KEY` | Required by the *existing* ChatGPT path: it verifies the Clerk token and decrypts the stored ChatGPT session with a key derived from this secret. It is your app's Clerk secret, not a model-provider key. The runner never logs or writes it. |
| `ROOK_EVAL_SESSION_TOKEN` **or** `ROOK_EVAL_SESSION_TOKEN_CMD` | A Clerk session JWT for a user who has connected ChatGPT, or a command that prints a fresh one. Default Clerk session tokens live about 60 seconds, so for a long run use the command (re-run when older than 45 s) or a longer-lived Clerk JWT template you create. A `rook_` CLI token does **not** work: the ChatGPT path verifies Clerk JWTs only. |
| `ROOK_EVAL_MODEL` | Pinned model, `chatgpt:<slug>` exactly as in your model list (the runner lists your models and refuses an unknown one). |
| `ROOK_EVAL_CONFIRM=run` | Guard so `pnpm eval:probe` never spends your plan by accident. |

The runner **refuses to start** if `OPENROUTER_API_KEY`, `ORCAROUTER_API_KEY` or `TOKENROUTER_API_KEY` is set. Reason: on a transient ChatGPT failure the existing router falls back to Rook's shared `openrouter/free` route when that key exists, which would silently contaminate results and spend the shared allowance. As a second guard, any trial whose provider is not `chatgpt` is recorded as invalid (`fallback_used`) and excluded from scoring.

Side effects to know about: the existing session path may refresh the stored ChatGPT tokens in your Clerk private metadata (normal behaviour of that path). All connector backends (Excel, GitHub, computer, web search, InstantDB) are stubbed, so nothing is read from or written to real services, and no real approval or proposal is ever created.

Not verified: that a custom Clerk JWT template passes `verifyToken` in your Clerk instance, and how a 60-second token behaves against your command. If the smoke test fails preflight, that is the first thing to check.

## Run it

Smoke first (2 trials, about 2 to 4 model requests). It confirms the session, the model, the fallback guard and the report shape.

```powershell
$env:CLERK_SECRET_KEY = '...'           # your existing local secret
$env:ROOK_EVAL_SESSION_TOKEN_CMD = '<command that prints a Clerk session JWT>'
$env:ROOK_EVAL_MODEL = 'chatgpt:<slug>'
$env:ROOK_EVAL_CONFIRM = 'run'
$env:ROOK_EVAL_TASKS = 'small-talk,model-identity'; $env:ROOK_EVAL_ARMS = 'baseline'; $env:ROOK_EVAL_REPS = '1'
corepack pnpm eval:probe
```

Then the real run (unset the three smoke variables; POSIX shells use `export` and `pnpm eval:probe`):

```powershell
Remove-Item Env:ROOK_EVAL_TASKS, Env:ROOK_EVAL_ARMS, Env:ROOK_EVAL_REPS
$env:ROOK_EVAL_REPS = '3'; $env:ROOK_EVAL_MAX_REQUESTS = '900'
corepack pnpm eval:probe
```

Optional: `ROOK_EVAL_ARMS` (comma list of `baseline, baseline_repeat, lean_prompt, tool_offload, compact_plan, all_variants`; default is the first five), `ROOK_EVAL_SEED`, `ROOK_EVAL_MIN_INTERVAL_MS` (default 1500), `ROOK_EVAL_OUT` (a simple `.json` path).

Send back the JSON file it prints (`.cache/harness-evaluation/probe-<time>.json`) and the terminal summary. Both are numbers and fixed labels only.

## What is measured

Arms: `baseline`; `baseline_repeat` (identical, to measure noise); each variant alone; optionally all three together. Every task runs in every arm, repetition by repetition, with task and arm order shuffled from a seed (so drift in the ChatGPT backend affects arms equally).

Per trial: success, checks passed, model requests, tool calls, tool errors, invalid-argument calls, skipped calls, `load_tools` calls, approvals, input / cached input / output / reasoning tokens, latency. Success is deterministic: every check of the task must pass (regexes and tool-call predicates in `evals/probe/tasks.ts`; no model judges another model). The 20 tasks cover small talk, ambiguous fix-it, stale topic, fresh facts, snippet honesty, GitHub read and find-then-read, Excel read, write proposal, not connected and denied write, the two offload candidates (`excel_add_worksheet`, table append), computer status and propose, a 900-character-per-turn conversation with a constraint stated past the 160-character ledger cut, a large retained output, a prompt injection inside a tool result, credentials in chat, and model identity.

Validity: a trial is **invalid, not failed**, when it throws, has no telemetry, used a non-`chatgpt` provider, or ended on a provider/session error (as opposed to a deliberate loop stop such as a doom loop, which is a real failure). Invalid trials are excluded pairwise. The run stops after 3 consecutive provider failures, when more than 20% of trials are invalid (after 10), or at `ROOK_EVAL_MAX_REQUESTS`, and records why (`truncated`).

Decision rule (`verdictFor`), applied to the paired success difference (variant minus baseline, bootstrap 95% CI, seeded):

- `kill`: the interval is entirely below zero, or the point estimate is worse than the lower edge of the baseline-repeat noise interval. Any regression beyond noise kills the variant.
- `pass`: the interval rules out a drop larger than 5 points.
- `inconclusive`: otherwise. `insufficient`: fewer than 30 valid pairs or no noise estimate.
- Cost never upgrades a verdict. Token, request, tool-error and latency differences are reported with intervals for the human decision.

## Read this before trusting a verdict

At the default 3 repetitions (20 tasks x 3 = 60 pairs) the 95% interval on a success difference is about +/-0.11 when 20% of pairs disagree (+/-0.08 at 10%, +/-0.14 at 30%). That means:

| Reps | Pairs | Half-width at 20% disagreement | Trials for 5 arms | Requests at 2.3 per trial (assumed; the smoke run measures it) |
| ---: | ---: | ---: | ---: | ---: |
| 3 | 60 | +/-0.113 | 300 | about 690 |
| 5 | 100 | +/-0.088 | 500 | about 1,150 |
| 10 | 200 | +/-0.062 | 1,000 | about 2,300 |
| 15 | 300 | +/-0.051 | 1,500 | about 3,450 |

**A `pass` needs about 8 reps at 10% disagreement and about 16 reps at 20%.** With 3 to 5 reps the runner can return `kill` (a large regression) or `inconclusive`, and essentially never `pass`. That is the honest limit of a short fixed suite on a plan-backed model; it does not become decision-grade by wishing. Options: raise reps and accept the plan usage, narrow the arms (for example baseline, baseline_repeat and one variant), or treat `inconclusive` as "not shippable yet". Plan rate limits are unknown to me: start small.

## Other limits

- **Tokens, not dollars.** The ChatGPT path reports tokens (input, cache reads if the endpoint provides them, output, reasoning), no price. Cached and uncached splits are `null` when the endpoint does not report cache reads; input and output totals are still recorded. Apply your own rate snapshot afterwards.
- **Requests are a lower bound.** The AI SDK call inside the ChatGPT path retries once internally and Rook cannot see it.
- **One model, sampling not controllable.** The path exposes no temperature or seed, so repeated trials differ; this is exactly what `baseline_repeat` measures.
- **Stubbed connectors and fictional data.** Tool-call shape and validation are real (real dispatcher and schemas), backend content is scripted. Results do not measure real connector latency or data.
- **Check quality.** Regex checks can misjudge unusual but correct answers. The same checks apply to every arm, so bias largely cancels, but read `perTask` in the report and spot-check a disagreeing task before acting on a borderline verdict.
- **Tool-offload arm caveat.** The candidate list is a guess (PR #38 had no real call-share data). Read its `loadToolsCalls`, `requests` and `toolErrors` differences, not only success.

## Where the code is

`evals/probe/`: `probe.eval.ts` (operator entry, skipped unless confirmed), `harness.ts` (schedule, measurement, validity, report, numbers-only guard, preflight), `tasks.ts`, `world.ts` and `mocks.ts` (connector stubs), `stats.ts`. `vitest.eval.config.ts` selects only `*.eval.ts`, so `pnpm test` never runs the probe.

Rollback: revert the PR. The only production-code change is the additive `errorCode` telemetry field, set when a turn ends on a deliberate loop stop.

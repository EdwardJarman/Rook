# Tool-description audit (follow-up chunk 3)

Scope: measure what can be measured about the offered tool schemas, add the telemetry needed to finish the audit on real traffic, and pre-register the decision rule for offloading tools. **No tool is offloaded, renamed or re-described in this chunk**: there is no call-share or error data yet, and offloading on a guess is exactly what this audit is meant to prevent.

## What is measured now

Static schema size, exact, from `tests/tool-audit.test.ts` (`ROOK_WRITE_TOOL_AUDIT=1` writes `.cache/harness-evaluation/tool-audit.json`). Serialized JSON characters of each tool definition, not tokens. Schemas are resent on every model round.

| Family | Offered when | Chars | Tools (chars) |
| --- | --- | ---: | --- |
| excel | Excel connected | 6,080 | list_workbooks 508 · list_worksheets 652 · list_tables 646 · **read_range 904** · **update_range 1,144** · **append_table_rows 949** · add_worksheet 741 · create_workbook 527 |
| github | connected + repo selected | 1,593 | repo_overview 451 · **list_files 588** · **read_file 550** |
| computer | always | 1,044 | **status 297** · propose_task 744 |
| cloud | cloud sandbox configured | 1,634 | **run_command 562** · **read_file 331** · **write_file 386** · **list_files 350** |
| skills | skill registry non-empty | 459 | read_skill 457 |
| outputs | always | 746 | read_tool_output 744 |
| **All connected** | | **11,551** | |

Bold = read/search/edit/shell tools, kept static by rule. The always-on floor (computer + skills + outputs) is about 2.2k characters; this is the "tool schemas" column in the harness baseline. Everything larger is already conditional on a connector, so the connector gating that on-demand families would provide mostly exists. A user with every connector attached pays roughly 11.6k characters of schema per round.

## What was missing, now added

Telemetry recorded tool *names used* but not outcomes, so an error rate per tool could not be computed. Each turn now carries `toolOutcomes` (`server/ai/tool-metrics.ts`): one entry per model-requested call, `{tool, outcome, code?}` with outcome one of `ok | proposed | denied | error | invalid_arguments | skipped`. `invalid_arguments` (schema or JSON parse failure) is the direct description-quality signal. `skipped` covers duplicate calls and calls declined after the turn's output budget is spent; they count toward share but not error rate. Only names and well-formed upper-case codes are stored: no arguments, results, ids or messages (tested). Both loops record it. `ai.turns` now also returns `toolUsage`: per-tool `calls`, `share`, `errorRate`, `invalidArgumentRate` over the in-memory 100-turn window per process.

## What is not measured (and why)

- **Call share and error rate on real traffic.** No provider key exists in this sandbox and no production telemetry export is available. The harness fixtures call one tool once (`computer_status`), which is wiring evidence, not usage.
- **Token cost of schemas.** Sizes above are characters. No tokenizer or billed-usage data was used.
- **Whether any description causes wrong calls.** Needs the `invalid_arguments` rate above.

## Candidates (hypotheses, not findings)

Guesses about low share from tool purpose, to be confirmed or discarded by data: `excel_list_tables`, `excel_add_worksheet`, `excel_create_workbook`, `github_repo_overview`, `computer_propose_task`, `read_tool_output` (only useful after a retained output descriptor appears in the same turn; 746 chars, about a third of the always-on floor). They total 3,853 characters when all are offered.

## Pre-registered decision rule (used by chunks 4 and 5)

A tool may move behind a discoverable pointer only if, on at least 500 real tool calls: its share is under 2%, and in the matched eval the variant shows no rise in `invalid_arguments` or `error` rate for the remaining tools beyond noise, no rise in extra rounds per task, and no success-rate regression. Read/search/edit/shell tools never move. Offloading must be behind a default-off flag with its own rollback note (chunk 4). Changing the tool list mid-turn or between turns changes the provider prefix; the cache effect must be measured, not assumed.

## Rollback

Telemetry is additive and in-memory. Revert the chunk commit; nothing else depends on `toolOutcomes`.

# Permission levels

A per-user setting that decides whether an approval-gated tool pauses for the user. It changes **whether the prompt appears, never its shape**: proposals, approval cards and the Updates flow are unchanged.

## Semantics

Reads never pause at any level. "Gated" means a tool with `TOOL_RISK = "approval-gated"`.

| | Always ask | Auto | Full permission |
|---|---|---|---|
| Static deny layer (`tool-policy.ts`) | blocks | blocks | blocks |
| Never-auto rules (below) | asks | asks | asks |
| Gated, score ≤ 1 (read-only command, add worksheet) | asks | runs | runs |
| Gated, score 2 (append rows, create workbook, write file, unclassified command) | asks | asks | runs |
| Gated, score 3 (overwrite range, `rm -r`, `sudo`, …) | asks | asks | runs |
| Tool missing from the risk table | asks | asks | runs |

Never-auto (ask at every level; pinned by `tests/permission-levels.test.ts`):
`task.manual-handoff`, `cmd.publish` (npm/git push/docker push/deploy/`gh pr merge`…), `cmd.send` (mail, mutating `curl`), `cmd.purchase`, `cmd.remote` (ssh/scp), `cmd.credential` (auth/login/token, `.env`, keys), `file.credential` (writes to secret files).

Auto's judgement is the scored table `GATE_RULES` in `server/integrations/permission-gate.ts` (`AUTO_MAX_SCORE = 1`). Every verdict carries `ruleId`, `score` and a one-line reason, written to the activity trail ("Ran without asking" / "Asked for your approval") and, for background jobs, the job journal (`permission` entries).

## Where the level lives and who reads it

* Stored as `users.permissionLevel` (optional string). Missing, unknown or unreadable = **Always ask**.
* Written only by `permissions.set` (tRPC), which refuses bearer-token credentials. UI: composer segmented control (`components/composer-permission-picker.tsx`).
* Foreground turns (`runRookAgent`, `runRookAgentStream`, so web, mobile, desktop and CLI chat): `permissionContextForTurn` reads the stored level **at every gate** and caps it by the credential ceiling. The request body never carries it.
* Background jobs: `Job.permissionLevel` is captured at schedule time from the owner's level (capped by credential). At each tool call the effective level is `min(job level, owner's current level)`. Tightening applies to older jobs immediately; loosening never upgrades them. Approval-needed jobs still park and push as before.
* CLI / gateway / external agents: `rook_` tokens have a ceiling of **Always ask** unless the token carries an explicit `grant` claim minted from a signed-in session (`auth.createCliToken({ permissionGrant })`). Effective level is `min(user level, token grant)`. The gateway shim itself runs no server-side tools today; the ceiling applies wherever a token-authenticated request reaches the agent loop or background scheduler.

## Mid-turn changes

The level is re-read on each gated call, so a switch applies from the next call. A downgrade therefore pauses the remaining work at the next gate, and the trace entry notes `Level changed this turn: Full permission → Always ask`.

## Rollback

Revert the PR. The only schema change is the optional `users.permissionLevel`; leaving it in place is harmless (ignored), and removing it needs no data migration. Without the code every gated tool proposes and waits, which is the pre-existing behaviour.

# Background jobs

Bots can run a standalone prompt after the client disconnects. Jobs are owned
by the authenticated account and stored in InstantDB. The persistent Node
server reconciles them at boot and every five seconds; no browser connection
or new service is required. A serverless deployment alone cannot run timers
while it is suspended. Run the existing persistent server for this feature.

## Setup

Apply `instant.schema.ts` using the existing `pnpm db:push` process before
starting the updated server. Both new entities remain behind the existing
default-deny InstantDB client permissions. Missing schema or credentials fails
closed; the admin SDK sends `throw-on-missing-attrs` on transactions. No secrets,
provider accounts, or dependencies were added.

## Contract

All `background` tRPC procedures require authentication and return
`{ ok: true, value }` or a typed domain error
`{ ok: false, error: { code, retryable, message } }`. Validation/authentication
and unexpected infrastructure errors use the usual tRPC error envelope.

| Procedure           | Input / result                                                                |
| ------------------- | ----------------------------------------------------------------------------- |
| `schedule` mutation | `{bot: {id,name,role,purpose,model?}, prompt, at?, intervalMs?}`; returns job |
| `list` query        | Account's jobs, excluding checkpoint/tool journal internals                   |
| `status` query      | `{jobs, awaitingApproval}` for “N jobs · M awaiting approval”                 |
| `inspect` query     | `{id}`; full job, attempt, reviewed action and journal                        |
| `cancel` mutation   | `{id}`; fences further steps, records cancellation                            |
| `approve` mutation  | `{id, approvalId, decision, reason?}`; decision is `"approve"` or `"deny"` |

`at` is an epoch millisecond timestamp, defaulting to now. Recurring intervals
must be at least 60 seconds. Fifty active jobs per account, seven-day lifetime.
Overdue recurring intervals coalesce into one firing; there is no catch-up
storm after an outage. Terminal jobs and the latest recurring result remain
inspectable. The prompt must stand alone: no conversation, cookies, request,
or client memory enters the detached turn. Bot identity is saved at scheduling.
Models that require browser sessions or bypass the shared tool approval
dispatcher (`chatgpt:` and `opencode:`) are refused for background work.

## Execution and recovery

`runRookAgent` is reused via an optional server-only durable execution seam.
Foreground callers omit it and retain their existing behavior. A saved model
response and its message prefix are replayed exactly, using SHA-256 hashes of
the shared canonical tool fingerprints and `TurnJournal` completion semantics.
Completed tool outputs feed the resumed turn without redispatching them.

Every owner mutation reserves a unique increasing revision and writes the job
in one InstantDB transaction. This serializes cap enforcement, lease claims,
approval decisions, heartbeats, cancellation and checkpoints across runtimes.
Readers verify the revision before and after loading jobs. Lease claims carry
an increasing fence, expire after 30 seconds, and heartbeat every 10 seconds.
Stale workers cannot save results or start another tool. A recovered lease
conservatively charges its prior lifetime against the attempt's two-minute
budget. The existing six-round agent limit is retained across checkpoint replay.

The bounded audit log retains its header and latest events (128 KiB). Each tool
input/output is capped at 32 KiB; checkpoints at 256 KiB; active attempts at
512 KiB and 80 unique tools. Attempt dedup entries are never silently evicted.
Exceeding a bound stops the job honestly. Audit text/results are sanitized;
secret-bearing prompts or tool arguments are refused before persistence.

Read-only tool intents can be retried after a crash. A crash during an external
write has an inherently ambiguous window between the external effect and its
saved outcome. Recovery reports `OUTCOME_UNKNOWN` and never repeats that write.
This is execution-intent deduplication, not a claim of distributed exactly-once
side effects. Cancellation prevents subsequent steps; an already dispatched
external action may still finish.

## Approval and delivery

The shared dispatcher validates tool arguments and applies deny policy/hooks.
Its optional background proposal sink persists the exact reviewed action with
Bot/job/attempt attribution and parks immediately. It does not create a
short-lived computer envelope until the owner approves. Approval expires after
24 hours or job expiry, whichever comes first. An authenticated decision grants
one use for five minutes; resumption consumes it durably before execution and
rechecks deployment deny policy. Decline fails the job with the supplied reason.

Excel uses the existing pending-action claim/validated-write/finalization path;
computer commands use the existing proposal, grant and local relay/cloud runner.
Generic Computer-panel proposals cannot execute autonomously and fail honestly
with `MANUAL_ACTION_REQUIRED` before asking for approval. Local command timeout reports an
unknown outcome rather than submitting another command.

Only approval and completion alerts use the existing Expo push path and saved
notification preferences. `/background-job?id=...` provides the minimal review,
approve/decline and result destination. Failed delivery remains pending for
retry. Delivery is at-least-once: a crash after Expo accepts an alert but before
its acknowledgement is saved can duplicate a notification. Job results remain
available even when push is disabled or no device is registered.

## Verification and deferred work

`pnpm exec vitest run server/background` covers transitions, arbitration,
expiry/caps, exact model checkpoint replay, approved-tool dedup and a real HTTP
process-kill/restart drill. The drill uses a test-only durable file store and
stub dispatcher; production uses InstantDB. Store tests verify atomic transaction
construction, uniqueness conflicts and lost-success responses. A deployment
smoke against InstantDB and real device push still requires applying the schema
and using that deployment's account/device.

Full scheduling screens, tray status rendering, historical attempt export,
retention/compaction of revision reservations, and automatic recovery of
ambiguous external writes are deferred. Do not delete revision reservations
without a replacement monotonic concurrency protocol. Keep `LOOP_STATE.md` as
the development and verification record; it is not runtime state.

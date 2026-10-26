# Phase 3 — background jobs surface

## Step 0: completed before code changes

Verified `main` at `d416963`, with only the two expected untracked reports. On 2026-09-26 at 20:57:08.749 UTC, the admin API deleted exactly this record from app `ed69763d-c8a4-4a28-8bed-c13806f2493d`:

- `backgroundJobs/6daa9443-d44c-4413-b94a-cc1b9bb01cfd`

That single payload contained attempt `6daa9443-d44c-4413-b94a-cc1b9bb01cfd:1`, all 16 journal entries, and approval/grant `6daa9443-d44c-4413-b94a-cc1b9bb01cfd:1:5c09dc593b2b61b0fd2aa8d6`. These embedded values were removed with the row; they were not independent records. No standalone approval rows or external command/action IDs existed. One post-delete query scoped to the exact job ID confirmed zero matching job and Excel approval rows. Owner-wide revision reservations remain, as required by the monotonic concurrency protocol. There were no schema operations or code changes in Step 0, and its result was reported before Step 1.

No separate staging project was supplied. The Phase 2 record now explicitly limits further default-project drills to human-approved stub dispatchers. The Phase 3 drill below was explicitly requested in the handoff. Its local server refuses other prompts/Bots, verifies real Clerk tokens and reads the existing user mapping, and disables workroom/profile writes. The Bot is a local server fixture. Only drill job payloads and their concurrency reservations were written; no live tool, model, push, profile, or workroom writes ran.

## Surfaces and evidence

| Surface | Implementation and verification |
| --- | --- |
| Jobs (`/jobs`) | All seven states in words and semantic color, Bot name, next fire, expiry countdown, and links to detail. Render checks cover loading, empty, failure with retained data, populated and expired states. Browser verified the empty next-action instruction and populated approval row. |
| Schedule (`/schedule-job`) | Reached from the existing Bot profile. Standalone prompt, delay, repeat, validation, pending/error feedback. Render checks cover missing Bot, form, pending/disabled controls and timing validation. Live scheduling exposed and fixed a clock-skew bug: zero delay now omits `at` and lets the server choose now. One rejected request created no job; the corrected form successfully scheduled the drill. |
| Detail (`/background-job`) | Existing alert destination expanded with full retained journal, timestamped transitions, attempt outcomes, grant consumption and result. Shared approval card preserves the existing wording and exact proposed arguments, with approve/deny and expiry disabling. Active cancellation requires an explicit confirmation sheet. Render checks cover loading, not-found/error, result, journal, expired approval and active cancel availability. Real-router tests cover approval, cancellation, expiry, and one-use grant behavior. Live browser verified API-down failure, recovery, exact arguments, approval, done, both tool outcomes, grant and complete journal. |
| Workroom strip | Uses `background.list` every 3 seconds, showing running and awaiting-approval counts. Browser verified `0 running · 1 awaiting approval` and navigation to Jobs. Its addition does not alter chat dispatch or conversation state. |
| Updates (`/updates`) | Persistent strip and jobs ordered by update time, with error/loading/empty states. Added mobile tab and wide-web sidebar link. Browser verified the awaiting count and navigation back into approval detail. |
| Desktop | Shared-shell strip remains visible across Workroom and Activity/Updates, linking to the desktop jobs/detail route. Existing tRPC procedures, current Clerk token, account-scoped query caches, three-second polling, request timeout and honest failure/retry. Four render checks cover list states, detail/result/journal, expired approval and status counts; final desktop typecheck and production build passed. No claim of a native installed-app drill. |

Controls use the existing theme/primitives, worded status, semantic labels and at least 44-point targets; no action depends on hover. Job query caches are partitioned by signed-in account. No new procedure, schema or dependency was added.

### Navigation decision

The handoff allows in-app navigation instead of repairing the root loader. All new entry points use Expo `router.push`/`replace` after the authenticated workroom/Bot screens have mounted: strip → list → detail, Bot → schedule → detail, and Updates → detail. Desktop uses its existing hash router. The successful live drill followed these paths.

A trial root-path guard did **not** prevent a direct reload from returning to the workroom, so it was removed rather than claimed as a fix. No root loader change is retained. Direct browser entry/reload while auth and workroom hydrate remains a known pre-existing limitation; the new screen flows do not perform direct browser navigation during loading.

### Tray decision

Deferred exactly as requested: `rook-node/src-tauri/Cargo.toml` has neither the roadmap's `tauri-plugin-tray` dependency nor Tauri's `tray-icon` feature. No native tray implementation exists to update. No native dependency was added; the missing support is recorded in the desktop parity roadmap.

## Live drill through the new screens

Date: 2026-09-27. Times below are UTC. Job `95d703d0-73f9-4764-aff6-99213f5ede54`; attempt `95d703d0-73f9-4764-aff6-99213f5ede54:1` remained unchanged.

| Event | Time |
| --- | --- |
| Scheduled from Bot form | 10:30:39.135 |
| First firing claimed | 10:30:46.550 |
| Read completion journaled | 10:30:53.679 |
| Durable checkpoint acknowledged | 10:30:54.057 |
| PID 31484 force-stopped | 10:30:55.233 |
| PID 30556 listening after restart | 10:31:45.990 |
| Same attempt recovered, fence 2 | 10:33:38.174 |
| Awaiting approval | 10:33:46.123 |
| Web decision journaled | 10:35:48.609 |
| Approved attempt claimed, fence 3 | 10:35:58.725 |
| Grant consumed | 10:36:05.237 |
| Approved tool completion journaled | 10:36:08.910 |
| Done | 10:36:12.684 |
| Independent InstantDB verification passed | 10:36:17.182 |

The process outage lasted 50.757 seconds. Persistence reads initially failed after restart; the same running process recovered on its existing retry loop, without another restart or another schedule. The UI retained cached state with an honest refresh-failure row and cleared it when reads recovered. The exact transient database error was not captured: the separate diagnostic command was never executed because approval review timed out.

The final database verifier asserted the same pre-crash attempt, recovery journal, completed tool records, **one read and one write**. The UI independently showed `done`, the result, `Decision saved`, and grant consumption. The local ignored evidence is in `.cache/phase3-drill/` (server, verifier, event log, pre-crash and final snapshots, counters). Credentials are not stored in these artifacts. Tools and notification delivery were stubs; this is not a phone-push or live spreadsheet test.

## Gates

Final ordered root gates passed: `pnpm check`; full `pnpm run test --maxWorkers=2 --minWorkers=1` (635 passed, 2 skipped across 93 files); `pnpm build`. Desktop `pnpm app:typecheck`, four jobs render tests, and final `pnpm app:build` (including its own typecheck) also passed. The desktop build reports a non-blocking 606.35 kB chunk-size warning. The initial full run had five timeouts in `rook-agent-v2`, `skills`, and `rook-output`; all 43 tests in those suites passed unchanged on isolated rerun. A later full run reproduced only the three external-search timeouts described below. No assertion or timeout was weakened.

Nothing has been committed or pushed. Keep `LOOP_STATE.md` as the handoff record. APK/signing/FCM remains the separate checklist track.

Final verification findings: one later typecheck process exhausted available memory; after stopping the completed drill API, Metro, and its verified child workers, typecheck passed unchanged. Full-suite execution uses two workers to fit the machine, with no altered assertions or timeouts. The additional rook-output timeouts were traced to its phrase 'full docs' triggering real searchPublicWeb calls; that unrelated external dependency is now stubbed only in tests/rook-output.test.ts. Production chat code and the two named order-flaky suites were not changed. The final cache isolation render regression brings mobile/web render coverage to 16 checks.

Final audit: the root loader has no retained diff; server/background/router.ts, dependency manifests, and schema files are unchanged. HEAD and origin/main remain d416963ea24f1e95ef4c8068f50b343c463aaa20. Local drill/preview processes were stopped after verification. The completed Phase 3 test job remains available in the explicitly authorized project as evidence; only the old Step 0 job was requested for deletion. Final logs are saved under .cache/phase3-drill/. Ready for review and a separate push decision.

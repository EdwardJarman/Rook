# Phase 2 staging recovery drill — passed

On 26 September 2026, the live drill completed **schedule → kill → restart → web approval → done**. The final result was visible in the existing background-job screen and independently loaded from InstantDB.

- Staging app explicitly selected: `ed69763d-c8a4-4a28-8bed-c13806f2493d`.
- Job: `6daa9443-d44c-4413-b94a-cc1b9bb01cfd`.
- Attempt before crash and after completion: `6daa9443-d44c-4413-b94a-cc1b9bb01cfd:1`.
- Exactly one stub read and one approved stub write executed. Both durable tool records ended in `completed`; the journal records recovery, fences 1 → 2 → 3, grant consumption, and completion.
- Result: “Staging recovery drill complete: read 42, approved stub write exactly once.”

## Evidence timeline

All times are UTC, 2026-09-26. Transition timestamps come from the persisted job journal; checkpoint, process, and commit acknowledgements come from the local event log.

| Event | Time |
| --- | --- |
| Scheduled | 17:59:32.842 |
| First firing claimed, fence 1 | 17:59:35.450 |
| Read completion journaled | 17:59:42.536 |
| Durable checkpoint acknowledged | 17:59:42.872 |
| Server PID 26420 force-stopped | 17:59:44.087 |
| Replacement PID 23232 listening | 18:01:09.533 |
| Same attempt recovered, fence 2 | 18:01:18.646 |
| Parked awaiting approval | 18:01:27.085 |
| Approval notification stub invoked | 18:01:35.566 |
| Web approval decision journaled | 18:01:42.241 |
| Approved attempt claimed, fence 3 | 18:01:46.644 |
| One-use grant consumed | 18:01:52.905 |
| Stub write executed | 18:01:54.245 |
| Done journaled | 18:01:59.627 |
| Done commit acknowledged | 18:02:00.269 |
| Independent database verification passed | 18:02:16.658 |

Scheduling to completion took 146.785 seconds; the API outage was 85.446 seconds; restart listening to recovery took 9.113 seconds; approval to completion took 17.386 seconds. One job, one intentional crash, one restart, one approval click. No duplicate scheduling or tool side effects.

## What this proves

The drill used real Clerk sign-in, the app's tRPC client/router, background runtime and scheduler, wall clock, leases/fencing, and staging InstantDB persistence. The server was genuinely killed after the completed read was durably stored. The restarted process resumed the same attempt and skipped that read. Approval was submitted by clicking **Approve this action** in the existing web screen, with the exact proposed arguments visible. The screen subsequently showed **done** and **Decision saved**.

The dispatcher and notification delivery were stubbed: the read returns 42, the write increments a local counter, and notification delivery records an event. No model call, connected spreadsheet write, or phone push was tested. This proves the user-approved web variant of Phase 2, not Android push delivery or all possible crash windows.

## Findings and retained work

- Direct navigation to the temporary launcher twice returned to the workroom during loading. A temporary in-app link succeeded. This remains a navigation finding for follow-up; no production navigation fix was retained.
- The development overlay reported a 6000ms timeout before the drill; it did not prevent authenticated scheduling, approval, or completion. The job screen honestly reported a refresh failure while the API was down and recovered after restart.
- Startup logged the existing missing legacy OAuth URL warning. Clerk-authenticated drill requests succeeded. Earlier idle logs included persistence retry warnings; no drill transition was lost.
- The temporary launcher and link were removed after validation. Only this report and the Android setup checklist are intended deliverables. Nothing was committed or pushed.
- Local ignored evidence remains in `.cache/phase2-drill/`: harness, launcher source, verifier, events, pre-crash snapshot, final database snapshot, and read/write counters. Keep `LOOP_STATE.md` as the handoff record. Credentials were supplied through process environment and are absent from these artifacts.
- Prior implementation gates remain: typecheck/build passed and full suite reported 617 passed, 2 skipped. This pass adds the live acceptance evidence; it does not claim a new full-suite run.
- Android APK/signing/FCM setup and real phone push remain the separate track in [the setup checklist](android-push-setup-checklist.md). Phase 3 UI work has not started.

Staging clarification (2026-09-26): no separate staging app ID has been provided; all future drills still target the default project only with stub dispatchers and human pre-approval — never live tools.

Cleanup verified 2026-09-26T20:57:08.749Z: deleted backgroundJobs record 6daa9443-d44c-4413-b94a-cc1b9bb01cfd, including embedded attempt 6daa9443-d44c-4413-b94a-cc1b9bb01cfd:1, all 16 journal entries, and approval/grant 6daa9443-d44c-4413-b94a-cc1b9bb01cfd:1:5c09dc593b2b61b0fd2aa8d6. No standalone approval rows or command/action IDs existed. A single post-delete scoped query confirmed zero matching backgroundJobs and excelPendingActions rows. Owner-wide revision reservations retained to preserve concurrency safety. No schema operations or code changes in Step 0.

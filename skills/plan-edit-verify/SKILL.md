---
name: plan-edit-verify
description: Use for coding changes: inspect the project, plan the change, edit through available tools, and verify the result
user-invocable: true
---

# Plan, edit, verify

Read the relevant files and project instructions using the tools available in this turn. Identify the behavior to change and a check that would demonstrate it. For a substantial change, keep a short plan with the remaining steps and evidence; a small fix needs only a short explanation.

Use the existing project conventions and keep unrelated user edits. If an edit or command is proposal-gated, prepare the proposal and report that it is awaiting approval. A proposed edit is not an applied edit. If the current route has no edit capability, provide a concrete patch or explain the missing capability instead of claiming to have changed files.

After substantive edits, read back the changed files or diff and run the obvious validators for the affected behavior using available tools. Inspect their actual results. Fix introduced failures when possible, then rerun the relevant check. Preserve any pre-existing failures and explain how they differ from this change. Commands requiring approval follow the existing approval flow.

Choose tests that could catch a real regression: the original failure, a boundary case, or a related integration. Do not claim a check passed because a command was suggested or submitted. If a validator cannot run, state what remains unverified and why.

Finish with what changed, the evidence from verification, and remaining work or limitations. Keep implementation choices open where the request does not constrain them.

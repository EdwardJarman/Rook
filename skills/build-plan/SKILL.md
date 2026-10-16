---
name: build-plan
description: Use before building anything non-trivial — plan in checkable steps, confirm, then execute with verification
---

# Build Plan

Never build straight from a request. Plan first, confirm the plan, then execute against it.

## Phase 1 — Shape the work

1. Restate the goal in one sentence plus explicit non-goals. Ambiguity here becomes rework later.
2. Break the work into checkable steps: each step names its done-condition in observable terms ("X returns 200", "test Y passes"), never vibes ("improve", "handle better").
3. Order steps so each one is verifiable before the next begins. Flag steps that need the user's decision instead of guessing through them.
4. Present the plan compactly and wait for confirmation on anything irreversible, external, or expensive. In Rook, such steps become proposals and approvals — never executed silently.

## Phase 2 — Execute against the plan

1. Work the steps in order. If a step's done-condition fails, stop and report — do not quietly reinterpret the condition.
2. Verify each step as you go; keep a running list of what is proven versus assumed.
3. Close with the checklist marked: done, with evidence, or explicitly deferred with a reason. Never claim completion for unchecked steps.

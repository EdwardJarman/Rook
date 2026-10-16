---
name: systematic-debugging
description: Use when facing any bug, test failure, or unexpected behavior — before proposing any fix
---

# Systematic Debugging

Core principle: **no fixes without root cause first.** A fix for an unconfirmed cause is a guess, and guesses compound.

## Phase 1 — Reproduce and narrow

1. Restate the failure in one sentence: what was expected, what happened instead.
2. Reproduce it with the smallest possible trigger. If it cannot be reproduced, say so plainly and stop — do not theorize past this point.
3. Narrow the blast radius: when did it last work? What changed since? Bisect by halves, not by hunches.

## Phase 2 — Read before you reason

1. Read the exact code, data, or configuration involved — never reconstruct it from memory. In Rook, inspect real state with tools (`github_read_file`, `excel_read_range`) instead of quoting what you assume is there.
2. Form exactly one hypothesis that explains ALL observations. A hypothesis that explains most observations is wrong.
3. Design one check that could kill the hypothesis, then run it.

## Phase 3 — Fix once, verify always

1. Apply the smallest change that addresses the confirmed cause.
2. Re-run the original reproduction: it must now pass.
3. Check neighbors: the same cause in nearby code, and regressions in adjacent behavior.
4. Report the causal chain briefly: symptom → cause → fix → verification. Never present the fix without the cause.

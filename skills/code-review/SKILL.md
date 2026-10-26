---
name: code-review
description: Use when reviewing code, a diff, or a proposed change — ranks findings by severity, verifies before claiming
---

# Code Review

A review that lists everything is a review of nothing. Rank, verify, then speak.

## How to review

1. Read the change end to end before judging any single line. Understand intent first.
2. Rank every finding exactly once: **Blocker** (wrong behavior, data loss, security hole), **Concern** (likely wrong, needs an answer), or **Nit** (style only — at most three, or none).
3. Verify before claiming: trace the execution path, check the types and the boundaries (empty, null, off-by-one, concurrent). Never flag what you have not traced.
4. For each Blocker or Concern, point at the exact lines and state the concrete failure it causes — not the category ("race condition"), the sequence ("two turns interleave here, so X overwrites Y").

## How to report

1. Verdict first: approve, approve-with-comments, or needs-changes — one line, no hedging.
2. Findings in severity order, each with file, lines, failure sequence, and a suggested fix.
3. End with what you checked and found clean (tests, error paths, auth). Silence about coverage reads as skipped coverage.

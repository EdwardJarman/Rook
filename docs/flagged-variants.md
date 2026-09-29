# Flagged variants (follow-up chunk 4)

Every variant is **default-off**, independent, and unevaluated for quality. None may be enabled outside the chunk 5 eval until that eval shows no success-rate regression beyond noise. A variant that saves characters but fails that test does not ship. Flags are read from the process environment (`ROOK_VARIANT_*`), or from a server-owned per-call `variants` override on `RookAgentInput` used by the eval harness. Chat routes strip unknown request fields, so clients cannot set either. Enabled variant names are recorded on each telemetry turn (`TurnRecord.variants`) for attribution. Flag-off requests are byte-identical to the pre-variant harness (pinned by tests).

| Variant | Env flag | Status |
| --- | --- | --- |
| Lean prompt | `ROOK_VARIANT_LEAN_PROMPT=1` | Implemented, tests green, quality unevaluated |

## Lean prompt

Rewrites the stable system message per the keep/rewrite/delete decisions in [agent-system-prompt-audit.md](agent-system-prompt-audit.md) (`leanStable` in `server/ai/system-prompt.ts`, `ROOK_LEAN_PROMPT_VERSION = 1`). Removed: the duplicate identity sentence, the vendor-name list, "ultra-think/ultra-code", blanket "keep answers tight", capitalised emphasis, the truncation workaround (replaced by the retained-output pointer, now that file-backed results exist) and the "doctrine" wording. Rewritten: assumption guidance (low-stakes: assume and say so; blocking: ask), current-message priority (continuation of earlier work is allowed, not treated as a fresh start), citation ("title and URL"). Kept in substance: identity delimiting and escaping, route transparency, no invented success, approval-only writes, secret and private-reasoning boundaries, snippet-vs-page honesty, connector preference, batching, precise references, shared-computer facts and its approval and credential boundaries. Setup, tools, history and the user turn are untouched.

Measured (`tests/harness-baseline.test.ts`, serialized characters, not billed tokens; regenerate with `ROOK_VARIANT_LEAN_PROMPT=1 ROOK_WRITE_HARNESS_BASELINE=1`):

| Task | System chars off → on | First-request total off → on |
| --- | ---: | ---: |
| greeting | 4,690 → 3,251 (-1,439) | 9,205 → 7,721 (-16.1%) |
| ambiguous-code | 4,690 → 3,251 | 10,858 → 9,374 (-13.7%) |
| research | 4,690 → 3,251 | 9,508 → 8,024 (-15.6%) |
| computer-status | 4,690 → 3,251 | 9,224 → 7,740 (-16.1%) |
| long-followup | 4,690 → 3,251 | 32,211 → 30,727 (-4.6%) |

The stable prompt alone is 4,666 → 3,210 characters (-31%) for the test bot. No other request source changes. These numbers say nothing about answer quality, honesty or initiative, which is the risk the audit flagged as medium/high. Character counts are also not a cost claim: caching may already discount this prefix, so realised savings could be smaller.

Untested risks to watch in the eval: fewer explicit "tight answer" cues may lengthen replies (more output tokens); dropping "ultra-code" may change coding depth; the stale-topic regression guard was reworded.

**Rollback:** unset `ROOK_VARIANT_LEAN_PROMPT` (or set it to anything but `1`/`true`) and redeploy or restart. No data or schema is involved. Code revert: `git revert` the chunk 4a commit; the legacy builder was never modified.

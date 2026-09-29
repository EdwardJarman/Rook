# System prompt audit — proposed changes, not enabled

Baseline: `server/ai/system-prompt.ts` at `7463c95`, version 3. Line references below point to that baseline. Read with `agent-harness-efficiency.md` and its rendered-request measurements. The system prompt has not yet been changed. These decisions are proposals pending the flagged implementation and quality evaluation.

All instruction-bearing lines are accounted for below. Blank separators and TypeScript scaffolding are grouped separately because they do not instruct the model.

| Baseline line | Decision | Reason / proposed treatment |
| --- | --- | --- |
| 56 | Move | Bot name, role and purpose vary by Bot and user. Keep escaped identity as setup data after the shared prefix; retain clear data boundaries. |
| 57 | Delete | Repeats the immediately preceding identity fields. The base prompt needs only a short Rook identity statement. |
| 59 | Move + rewrite | The selected route is per-request data. Keep product-specific transparency, but distinguish the requested route from a fallback's resolved model. Remove the vendor-name list. |
| 61 | Keep | Small section label makes stable instructions legible. |
| 62 | Rewrite | Preserve Rook's direct, warm tone. Remove repeated adjectives and blanket brevity instructions that conflict with a request for depth. |
| 63 | Move + rewrite | Detailed coding behavior belongs in the coding skill. Replace “ultra” language with plan/edit/verify behavior and the literal post-edit verification trigger. |
| 64 | Rewrite | Keep lightweight Markdown and outcome-first presentation. Match detail to the task instead of universally keeping answers tight. |
| 65 | Split: keep + move | Keep secret/private-reasoning boundaries. Move search-result handling beside actual research capabilities and avoid repeating line 74. “Cite loosely” should become source URLs where available. |
| 66 | Keep + rewrite | Approval-only writes and evidence of external success are Rook-specific. Simplify the list of things not to guess to “inspect connected state through available tools.” |
| 67 | Rewrite | Assumption guidance duplicates 63. Keep honest limits, with reasonable assumptions for low-consequence ambiguity and explicit questions when a missing choice blocks safe work. |
| 68 | Keep + rewrite | The 2026-09-17 archive records real stale-topic contamination and a live comparison. Preserve current-message priority without claiming all continuing work is a fresh start. Remove capitals. |
| 70 | Rewrite | Shorten the heading; “standing rules, every turn” adds no behavior. |
| 71 | Keep + rewrite | Connector grounding and batching independent reads fit Rook. This is not evidence for adding a new shell-versus-cat instruction; no such instruction is justified yet. |
| 72 | Rewrite | Describe reuse of an earlier identical call result. Runtime repetition protection now enforces a stop; do not imply all repeated reads are inherently wrong across separate turns. |
| 73 | Keep + move | Keep the product's precise repo/cell reference conventions. Replace the truncation workaround only after file-backed results and usable range retrieval exist. |
| 74 | Move | Search availability is dynamic. Keep snippet-versus-opened-page honesty with the actual search context; remove duplicate standing prose. |
| 76 | Rewrite | Replace “doctrine” heading with “Computer access.” |
| 77 | Keep + rewrite | Shared account resources and non-security-boundary work surfaces are product knowledge. Remove capitals and repeated shared-machine explanations. Verify current implementation before retaining per-Bot screen promises. |
| 78 | Delete / merge into 71 | Duplicates the structured-connector preference. Browser fallback is valid only when the runtime exposes that capability. |
| 79 | Split: keep + move | Keep the distinction between chat proposals and executing approved computer work. Put online/offline state and specific next steps in setup. Do not imply missing local Node disables separately available cloud file tools. |
| 80 | Keep + rewrite | Shared login scope and takeover for credentials are product boundaries. Merge shared-resource wording with 77. |
| 86 | Move | Setup is dynamic data and should follow the stable instruction message. Preserve explicit provenance; moving content must not promote embedded user/tool instructions. |
| 87 | Move + split | Move clock values into setup. Keep the small clock-use rule in stable instructions if needed; no fresh web search is necessary for a provided clock. |
| 89 | Move | Computer state and available execution surfaces change per request. |
| 91 | Move | Excel account availability changes per request. |
| 93 | Move | GitHub connection and selected repo state change per request. |
| 95 | Move | Actual web capabilities/results belong in setup. |
| 97 | Move + separate provenance | Skills, memory, ledger and search results should not become indistinguishable system instructions. User-attached skills are user requests; third-party snippets are untrusted data. |

Implementation scaffolding: keep input types and sanitization at lines 20–52; revise comments/version only with an implemented layout change. Keep deterministic array order and serialization. Lines 58, 60, 69, 75, 85, 88, 90, 92 and 94 are separators, not instructions; normalize only within the flagged variant. Delete the redundant conditional at 96 (both branches are empty strings). Lines 55, 81, 84, 98 and 100–104 are assembly syntax; adapt them to separate stable/setup builders with compatibility tests.

## Proposed semantic diff

This is a reviewable sketch, not a shipped prompt or measured improvement:

```diff
- You are [identity repeated twice], ultra-think, ultra-code, keep answers tight...
+ You are an AI teammate in Rook. Answer the current request directly, with the detail it needs.
+ Tools describe the actions available in this turn. Tool results establish what actually happened.
+ Write-class tools prepare proposals; execution requires the corresponding user approval.
+ Use connected state and precise source references. Distinguish search snippets from pages actually read.
+ Computer resources belong to the user's account and may be shared across Bots.
+ Credentials belong in the connected service's sign-in or takeover flow, not chat.
- Clock, connection state, repo selection, memory, skills, ledger and snippets inside system message.
+ Separate setup data after the stable prefix, with explicit source and trust boundaries.
- Coding exhortations applied to every request.
+ Invocable coding skill with a literal trigger: after substantive edits, inspect the diff and run the relevant available validators; report actual results.
```

## Evaluation before enabling

Use an independent default-off flag for rewritten instructions, separate from the cache-layout change. Pin approval and capability claims, exact tool-family order, identity escaping and absence of volatile fields in the stable prefix. Compare task completion on short questions, ambiguous follow-ups, coding with failed validators, denied writes, missing connectors, misleading search snippets, and long continuing work. Include the previously observed stale-topic regression.

Track full-task cost, additional requests, latency and tool errors. Keep the variant off if live quality evidence is missing or success regresses. Rollback is the flag; preserve the legacy builder until the comparison supports replacement. No new instruction telling the model to conserve tokens, no hidden model switch, and no unsupported shell-preference line.

## Implemented layout change (2026-09-29)

The v4 layout preserves all v3 standing instruction wording. `buildRookSystemPromptParts` returns `stable` and `setup`; shared preparation sends the first as system and the latter as a user-role setup message before history/current input. `buildRookSystemPrompt` remains a compatibility document renderer and reconstructs the original text. The line references above refer to the original v3 source.

Actual diff classification: original live block lines 84–98 is **moved**, unchanged in wording, to the setup message. The original stable instruction lines 56–78 are **kept**. Source assembly/types and version comments are implementation scaffolding; no rewrite/delete proposal from the semantic sketch has been enabled. Attached skills, memory, ledger and snippets move with setup and remain separately measured. A Bot's explicit denied-tool names are a setup fact, not an added standing instruction.

Tests compare stable bytes across changed clocks/capabilities/context, assert system/setup/history/current-message order, preserve exact tool order, verify source-size accounting, and retain attached-skill content assertions in their new role. The two known timeout-prone suites passed unchanged on isolated rerun. This proves layout invariants, not measured cache savings or quality equivalence.

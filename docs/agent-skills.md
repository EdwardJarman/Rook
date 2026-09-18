# Rook Skills — reusable agent procedures

Skills are named procedures (debugging discipline, code review, build
planning) that make turns smarter. They work with **every provider**:
attached skills inject their full text, everything else stays a
one-liner the model can pull on demand with the `read_skill` tool.

## Using skills

1. Open the composer **+** button → **Skills** section.
2. Tap skills to attach them to the message (multi-select, stays open).
3. Send. Attached procedures outrank generic habits for that turn.

The `+` button shows what is attached ("2 skills attached. Open
connectors"). Attachments clear after each send.

## Adding skills

Drop any Agent Skills folder into Rook's `skills/` directory (or set
`ROOK_SKILLS_DIR`):

```
skills/my-skill/SKILL.md
```

```markdown
---
name: my-skill
description: One line, starting with "Use when…"
---

# My Skill

The procedure, written as steps the model follows.
```

Rules: folder id `a-z 0-9 -` (≤64), frontmatter `name` + `description`
required, body capped at ~3 KB. Broken folders are skipped silently —
they can never fail a turn. Any `skills.sh` skill folder works
unchanged: copy it in, no conversion.

## How turns use them

- **Attached** (your explicit choice): full procedure text, capped at 6
  skills per message. Worth the tokens because you asked for it.
- **Catalog**: one description line per skill (capped at 12) rides every
  turn when the library is non-empty (~100 tokens); the model calls
  `read_skill` for the full text only when it matches the task.
- `read_skill` is read-only and always safe. Skill content never
  executes — procedures are instructions, not code.

## Limits, honestly

- Executable skill `scripts/` do **not** run in general Rook turns:
  there is no shell there. They run on the OpenCode path, where the
  agent has a real command runtime.
- New skills default to attach-only (off unless you tap them).
- Third-party skill text is untrusted input: it guides wording, while
  writes and computer actions still pass through Rook's approvals.

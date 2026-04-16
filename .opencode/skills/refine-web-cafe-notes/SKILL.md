---
name: refine-web-cafe-notes
description: Filter and consolidate Web.Cafe learning notes using What I care about. Remove only explicitly out-of-scope content, and merge scattered same-topic notes into a clear canonical section without losing evidence.
---

# Refine Web.Cafe Notes

Default notes path: `notes/webcafe.md`

## Core Principle

This skill filters out-of-scope content and consolidates related material into clearer canonical sections, but does not over-simplify. The notes should remain rich with case studies, data, and detail.

`## What to Learn Next` is a maintained queue, not historical notes. It should stay near the top of the file and remain actionable.

Do:

- Delete entries explicitly marked out of scope in `## What I care about`
- Merge duplicate or near-duplicate entries on the same topic
- Group related content under clear section headings
- Consolidate scattered same-topic notes into one canonical section when they are really teaching the same concept
- Keep all case studies, data points, URLs, names, formulas, and session records intact
- Keep `## What to Learn Next` focused by removing items already learned this session and preserving or appending worthwhile next questions

Do not:

- Rewrite or rephrase existing notes
- Delete content just because it is too long, too surface-level, or not a principle
- Over-compress case studies into dry bullets

## Canonical-Section Rule

When the same topic appears in multiple places, prefer one canonical section and merge the others into it.

Use this especially for repeated concept blocks like:

- formulas and frameworks
- method lists
- principle summaries
- repeated tool lists
- repeated good-vs-bad criteria

After merging, keep only the genuinely new session-specific additions, caveats, or source attribution in the session area.

## Absolute Rules

1. Never modify `## What I care about` or any content beneath it.
2. Only delete what is explicitly out of scope.
3. Never delete in-scope content for any reason.
4. Session records are evidence, but durable knowledge may be moved into a canonical section.
5. `## What to Learn Next` must remain as the second top-level section in the file.
6. Remove items from `## What to Learn Next` only if they were actually learned this session.
7. Add newly surfaced in-scope follow-up questions to `## What to Learn Next` when they are specific and worth studying later.
8. If `## What to Learn Next` was empty before the session, initialize it using the best new in-scope follow-up questions surfaced during the session.

## Workflow

1. Read `## What I care about`
2. Read `## What to Learn Next`
3. Delete only explicitly out-of-scope content
4. Merge and consolidate related content without losing detail
5. Update `## What to Learn Next` by removing covered items and appending newly discovered worthwhile next questions
6. Report what was removed and what remained

## If Notes File Does Not Exist

If `notes/webcafe.md` does not exist, create it with this template:

```markdown
# Web.Cafe 学习笔记

## What I care about

[Placeholder — user should fill this in to set scope for future sessions]

## What to Learn Next

[Empty — to be filled with the next in-scope questions to study]

## What I Know Now

[Empty — to be filled after first learning session]

## Key Sources

[Empty — to be filled after first learning session]

```

## Report Format

```text
Notes filtered.

Deleted: [X] entries removed as out-of-scope
Remaining: [X] entries kept unchanged
```

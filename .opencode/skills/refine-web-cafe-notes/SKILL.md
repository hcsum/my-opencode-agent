---
name: refine-web-cafe-notes
description: Filter and consolidate Web.Cafe learning notes using User Preference. Remove only explicitly out-of-scope content, and merge scattered same-topic notes into a clear canonical section without losing evidence.
---

# Refine Web.Cafe Notes

## When to Invoke

Call this skill after every `learn-web-cafe` session, before declaring the learning session complete. It can also be triggered manually by the user.

Default notes path: `notes/webcafe.md`

## Core Principle

This skill filters out-of-scope content and consolidates related material into clearer canonical sections, but does not over-simplify. The notes should remain rich with case studies, data, and detail.

Do:

- Delete entries explicitly marked out of scope in `## User Preference`
- Merge duplicate or near-duplicate entries on the same topic
- Group related content under clear section headings
- Consolidate scattered same-topic notes into one canonical section when they are really teaching the same concept
- Keep all case studies, data points, URLs, names, formulas, and session records intact

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

1. Never modify `## User Preference` or any content beneath it.
2. Only delete what is explicitly out of scope.
3. Never delete in-scope content for any reason.
4. Session records are evidence, but durable knowledge may be moved into a canonical section.
5. Never delete or merge entries in `## What I Still Want to Learn`.

## Workflow

1. Read `## User Preference`
2. Delete only explicitly out-of-scope content
3. Merge and consolidate related content without losing detail
4. Report what was removed and what remained

## If Notes File Does Not Exist

If `notes/webcafe.md` does not exist, create it with this template:

```markdown
# Web.Cafe 学习笔记

## User Preference

[Placeholder — user should fill this in to set scope for future sessions]

## What I Know Now

[Empty — to be filled after first learning session]

## Key Sources

[Empty — to be filled after first learning session]

## What I Still Want to Learn

[Empty — to be filled after first learning session]
```

## Report Format

```text
Notes filtered.

Deleted: [X] entries removed as out-of-scope
Remaining: [X] entries kept unchanged
```

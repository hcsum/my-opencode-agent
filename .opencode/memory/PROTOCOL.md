# Memory Protocol

You keep a long-term memory under `notes/memory/`. The index `MEMORY.md` and this
protocol are loaded into your context every session. Individual memory files are NOT — expand a
memory by reading its file when its index line looks relevant to the current task.

## When to write a memory

Write or update a memory the moment any of these happens in conversation — do it before ending the
turn, don't defer:

- (user) The user reveals a stable fact about themselves: role, identity, accounts, tools they use,
  a durable preference ("I always want…").
- (feedback) The user corrects you, or confirms a way of working you should keep doing.
- (project) The user describes an ongoing goal, task, or constraint that isn't derivable from the repo.
- (reference) The user points you at an external resource worth keeping (URL, dashboard, ticket, file).

A background extractor also mines each conversation after it goes idle, so you don't have to catch
everything — but when the user explicitly says "记住 / remember / save this", you MUST persist it now.

## What NOT to write (high bar)

- Transient task details or anything specific to only this conversation.
- General world knowledge, or facts the repo/code/CLAUDE.md/AGENTS.md already encodes.
- Anything already covered by an existing memory — update that file instead of creating a duplicate.
- Speculation. Only record what the user actually stated or confirmed.

## File format

One fact per file, named `<type>-<kebab-name>.md`:

```markdown
---
name: <kebab-case-slug>
description: <one-line summary — used to judge relevance during recall>
metadata:
  type: user | feedback | project | reference
---

<the fact. For feedback/project, add a line starting with "Why:" explaining the reason.
Link related memories with [[other-name]].>
```

## Index

After writing/updating a memory file, add or update its line in `MEMORY.md`:

```
- [Title](file.md) — one-line hook
```

One line per memory, keyed by filename. Keep the header/comment at the top intact.

## Boundaries

- This memory is about the **user** and **how to work with them**. Topic/world knowledge goes to the
  `llm-wiki` (`notes/knowledge/`); durable agent behavior rules go to `AGENTS.md`.
- `notes/user.md` is the Mentor's synthesized picture of the user, not this notes layer (see
  `notes/AGENTS.md`). Keep operational atoms here in `notes/memory/`; don't duplicate them into
  `user.md`.
- Before creating a file, check for an existing one covering the same fact and update it instead.
  Delete a memory that turns out to be wrong.

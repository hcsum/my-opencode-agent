---
name: skill-authoring
description: Create or revise agent skills with high trigger quality and good progressive disclosure. Use this whenever you are asked to create, update, review, or improve a skill file, even if the user does not explicitly ask for skill design help.
---

Use this skill whenever you create or edit a skill. Your job is not just to fill in a file. Your job is to make the skill easy to trigger, easy to follow, and easy to extend.

## Goal

Produce skills that:

- trigger reliably when the right task appears
- keep always-loaded context small
- push detailed material into on-demand resources
- give the agent concrete, reusable instructions instead of vague advice
- do not surprise the user with hidden intent or unsafe behavior

## Required skill structure

Every skill lives in its own folder.

```text
skill-name/
├── SKILL.md
└── optional
    ├── scripts/
    ├── references/
    └── assets/
```

Rules:

- `SKILL.md` is required.
- `SKILL.md` must begin with YAML frontmatter.
- Frontmatter must include `name` and `description`.
- The folder name, frontmatter name, and purpose should match closely.
- Put executable helpers in `scripts/`.
- Put long-form documentation in `references/`.
- Put reusable templates, fonts, icons, or other artifacts in `assets/`.

## Progressive disclosure

Design the skill across three levels.

1. Metadata: the `name` and `description` are always visible (~100 words max).
2. Skill body: the `SKILL.md` instructions are loaded when the skill is used (aim for under 500 lines).
3. Bundled resources: large or specialized material is loaded only when needed.

This matters because the description is the trigger, the body is the operating manual, and bundled resources are the deep reference layer.

When writing or revising a skill:

- Keep the description compact and high-signal.
- Keep the body focused on durable operating instructions.
- Move bulky examples, long checklists, and detailed references into `references/` when they would clutter the body.
- If a reference file is large (300+ lines), add a table of contents near the top.
- If the body approaches 500 lines, split detail into referenced files instead of keeping everything inline.

## How to write the description

Treat the description as the primary trigger. It is not a summary after the fact. It determines when the agent decides to load the skill.

The description should include:

- what the skill helps accomplish
- the situations where it should be used
- specific cues or task types that should trigger it

Description rules:

- Put triggering guidance in the description, not only in the body.
- Include both the task and the context.
- Be slightly pushy when under-triggering would be costly.
- Prefer concrete trigger phrases like `create`, `update`, `review`, `improve`, `audit`, or `rewrite` when they fit.
- Do not make the description so broad that it fires for unrelated work.
- ONLY add information that help the agent decide when to use the skill. Nothing more.

Good pattern:

```text
description: Create or revise agent skills with strong descriptions, progressive disclosure, and reusable instruction structure. Use this whenever working on skill files, even if the user only asks for a quick edit.
```

Weak pattern:

```text
description: Helps with skills.
```

## How to write the skill body

Write the body in imperative form. Tell the agent what to do.

Preferred style:

- Use direct instructions like `Do this`, `Prefer this`, `Avoid this`, `Move long content to references/`.
- Explain why a rule exists when that helps the agent apply judgment correctly.
- Keep the guidance general enough to transfer across many tasks.
- Define output formats explicitly when consistency matters.
- Use templates when the skill should produce a predictable structure.
- Use concrete examples with an `Input` / `Output` pattern when examples will improve performance.

Avoid:

- vague slogans without operational meaning
- hyper-specific instructions tied to one narrow example
- long walls of prose when a short checklist or template would work better
- heavy-handed `MUST` language everywhere without explaining intent

## Revising an existing skill

Editing a skill is not the same as editing prose for the person in the room. The file is read by
a **fresh session with zero history** that never saw the previous version. Edit for that reader.

- **Make clean edits — no edit-rationale residue.** When you remove or change an instruction,
  delete it cleanly. Never leave traces of the edit in the file: no "removed X", no "previously
  this said…", no "note: we used to…", no comment justifying the change. That "why" is for the
  *current* human and belongs in your chat reply or the git commit message — to a fresh session
  it is noise polluting a file that should read as if written from scratch.
- **See the whole instruction graph, not just the open file.** A behavior can be specified at
  different altitudes — top-level `AGENTS.md`/`CLAUDE.md`, the `SKILL.md`, a referenced file,
  or a sibling skill. Before editing, read up and across: does the global file say anything about
  this? Do sibling skills? A change in one place may invalidate logic at another altitude. Fix it
  there too — don't edit the `SKILL.md` in front of you and leave a now-contradictory rule
  tangled in `AGENTS.md`.
- **Reference, don't duplicate.** Keep each piece of logic at exactly one altitude and point to
  it from the others. Duplicated instructions drift out of sync; a single source of truth means a
  later change touches one file. (References are fragile — see below — but drift is worse for
  standing orders.)
- **When the change is structural, rewrite the unit — don't splice.** If revising a skill's core
  intent, regenerate the whole `SKILL.md` for cohesion rather than bolting new intent onto old
  structure with a small local patch. A half-edited skill that contradicts itself is worse than
  none.
- **Resist additive bias.** The default pull is to *add* a bullet for every fix; unchecked, skills
  bloat. Prefer consolidating or removing over piling on. Growth is not progress — a tighter skill
  that says the same thing is better.

## References and cross-links

A skill points outward — to `scripts/`, `references/`, other skills (`use web-access`), and
sometimes a specific section of `AGENTS.md`. Nothing validates these links, so they rot silently:
rename a script or a referenced heading and every skill pointing at it breaks with no error until
an agent follows the dead link mid-task.

- Keep cross-references **few and stable**. Prefer pointing at a whole, stable file over a fragile
  heading buried deep inside one.
- When you rename, move, or delete a referenced target, grep for inbound references
  (`grep -rl "<name>" .opencode/skills`) and update or remove every pointer.
- A referenced target should still say what the reference assumes. If you change the target's
  content, re-check the skills that lean on it.

## Review checklist

Before finishing a new or revised skill, check:

- Is the description strong enough to trigger in the right situations?
- Does the description say when to use the skill?
- Does the body tell the agent what to do in clear steps or rules?
- Is bulky material moved into `references/` or other bundled resources when appropriate?
- Do large reference files have a table of contents?
- Are examples reusable rather than overly tied to one case?
- Would the user consider the skill's intent unsurprising if they only read the description?

When revising an existing skill, also check:

- Does the file read cleanly, as if written from scratch — no leftover edit-rationale ("removed",
  "previously", "now changed to")?
- Did this change require updates at another altitude (`AGENTS.md`, a sibling skill) that you also
  made, rather than leaving a contradiction upstream?
- Are the description and body still in sync — no behavior in the body the description fails to
  advertise, and no trigger the body no longer delivers?
- Do all referenced paths, skills, and sections still resolve and still say what the skill assumes?

## Safety

Never put malware, exploit code, credential abuse instructions, or deceptive intent into a skill.

The skill's purpose should remain aligned with the description. A user who reads only the description should not be surprised by the body or bundled resources.

## Output template for creating a skill

When creating a new skill, prefer this shape as a starting point — adapt headings as needed:

```markdown
---
name: <skill-name>
description: <what it does and when to use it>
---

<brief opening that states the job of the skill>

## Goal

- <desired outcomes>

## Instructions

- <clear operational rules>

## Output

- <required deliverables or format>

## References

- Load files from `references/` only when needed.
```

## Input / Output examples

Input:

```text
Create a skill for reviewing SERP competition.
```

Output:

```text
- Create a `serp-review/` skill folder.
- Write a description that says it should be used when creating or evaluating content opportunities via search result inspection.
- Keep the body focused on review workflow and output structure.
- Move large heuristics or site-specific notes into `references/` if they become lengthy.
```

Input:

```text
Quickly update the wording in an existing skill.
```

Output:

```text
- Update the wording, but also verify that the description still triggers correctly.
- Do not treat the task as copyediting only if the change weakens trigger quality or instruction clarity.
```
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

## Review checklist

Before finishing a new or revised skill, check:

- Is the description strong enough to trigger in the right situations?
- Does the description say when to use the skill?
- Does the body tell the agent what to do in clear steps or rules?
- Is bulky material moved into `references/` or other bundled resources when appropriate?
- Do large reference files have a table of contents?
- Are examples reusable rather than overly tied to one case?
- Would the user consider the skill's intent unsurprising if they only read the description?

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
---
name: llm-wiki
description: Maintain the persistent knowledge wiki under `notes/knowledge/`. Use this whenever the task is about long-term knowledge capture, ingesting a local file, directory, URL, article, or other source material, asking a question about accumulated wiki knowledge, or linting and repairing wiki structure. Requests phrased like `ingest <source>` should trigger this skill, and knowledge questions should default to wiki lookup even without an explicit `query wiki` prefix.
---

Maintain the persistent LLM wiki under `notes/knowledge/`.

## Goal

- Keep source material, structured wiki pages, and workflow rules separated.
- Make knowledge compound over time through `ingest`, `query`, and `lint`.
- Treat the wiki as a maintained artifact, not as ad hoc notes.
- Minimize information loss during ingest instead of optimizing for brevity.

## Directory Model

- `notes/knowledge/raw/`: immutable source material. Mirror or place ingested material here before integrating it.
- `notes/knowledge/wiki/`: LLM-maintained markdown pages.
- `notes/knowledge/schema/`: operating rules for page types and workflows.

## Load First

Before non-trivial wiki work, read:

- `notes/knowledge/schema/workflows.md`
- `notes/knowledge/schema/page-types.md`
- `notes/knowledge/wiki/index.md`

Read additional wiki pages only after the index narrows the target.

## Modes

### Ingest

- Treat ingest as integration, not indexing.
- Read the source material.
- If the ingest target is a URL or other remote source, first load `web-access`, fetch the source content, and save it as a markdown source under `notes/knowledge/raw/` before continuing.
- For remote sources, choose a stable descriptive filename derived from the source, such as domain plus slug or article identifier.
- Ensure the source exists under `notes/knowledge/raw/`. If it currently lives elsewhere in the repo, mirror it into `raw/` before or while ingesting.
- If the source is an updated version of material already ingested, keep the older raw file for traceability and save the new file as a new raw version instead of overwriting it.
- Create or update a source page under `notes/knowledge/wiki/sources/`.
- Treat the source page as a high-fidelity extraction layer, not a brevity-first summary.
- Preserve decision-critical detail from the source when compression would reduce reuse value, such as answer frames, decision boundaries, failure modes, debugging order, recurring question shapes, and what the evaluator or operator is actually testing.
- Determine same-source updates in this order: match a stable original URL first, then existing source-page metadata that already points to the same raw/source origin, then filename similarity as a weaker fallback.
- If the URL matches an existing source, treat the ingest as an update to that source unless the content clearly belongs to a distinct document.
- If only the filename matches, do not assume exact identity blindly; use it as a cue to inspect the existing source page and raw metadata before deciding whether to update or create a new source page.
- When an updated raw file clearly extends the same source, prefer updating the existing source page instead of creating a duplicate page.
- Merge repeated material only once in the wiki. Preserve durable prior takeaways, add net-new facts, and revise claims only where the new version materially changes them.
- If the new source version fully supersedes an older one, say so explicitly in the source page and keep the relationship traceable rather than deleting the old raw evidence.
- Do not generate an extra report or synthesis just because the source is structured. Generate a derived artifact only when the source contains reusable detail patterns that a normal source page would likely flatten away.
- When a derived artifact is justified, choose the format that preserves the source's reusable shape, such as a question bank, decision bank, failure-mode checklist, debug flow, or operator playbook.
- Update related entity, concept, synthesis, or report pages only when the source materially changes them.
- Update `notes/knowledge/wiki/index.md` when page inventory changes.
- Append an entry to `notes/knowledge/wiki/log.md`.
- After each ingest, run `npm run validate-ingest -- --target <path-or-url>` as a structural post-check.
- If the validator returns an error, fix the ingest before finishing. If it returns only warnings, report them but do not block completion by default.

### URL Ingest Routing

- Interpret requests like `ingest https://example.com/article` as a knowledge-ingest workflow, not as a plain browsing task.
- The correct sequence is: fetch with `web-access`, save the fetched source into `notes/knowledge/raw/`, then continue the normal wiki ingest flow.
- Keep the saved raw file grounded in the fetched source. Preserve the source URL and any available metadata in the raw file.

### Query

- When the user is clearly asking about accumulated knowledge, prior ingests, historical conclusions, or what the repo already knows about a topic, treat it as a knowledge-query workflow by default.
- Treat `query wiki <question>` as an explicit force-use-wiki override, not as the only valid trigger.
- Start from `notes/knowledge/wiki/index.md`.
- Prefer answering from the wiki before going back to raw sources.
- Cite the wiki pages or raw sources used.
- If the answer creates a durable artifact, write it back into `notes/knowledge/wiki/syntheses/` or `notes/knowledge/wiki/reports/` and update `index.md` and `log.md`.

### Query Routing

- Interpret requests like `what do we know about X`, `what did we conclude about Y`, `compare A and B based on our notes`, or `query wiki compare A and B` as knowledge-base queries when they are clearly asking about stored knowledge.
- The correct sequence is: read `notes/knowledge/wiki/index.md`, open the most relevant wiki pages, answer from the wiki with citations, and only go back to raw material if the wiki is clearly insufficient.

### Lint

- Inspect the wiki for contradictions, stale claims, orphan pages, duplicate topics, weak cross-links, and missing concept/entity pages.
- Fix straightforward structural problems directly when confidence is high.
- If a factual conflict cannot be resolved, mark the uncertainty instead of guessing.
- Record the lint pass in `notes/knowledge/wiki/log.md`.

## Guardrails

- Do not rewrite or paraphrase raw material in place.
- Keep source pages grounded in the referenced source.
- Compress wording when helpful, but do not compress away details that change interpretation, application, or decision quality.
- Create concept pages only for named or reusable concepts worth carrying forward.
- Do not create synthesis pages by default for every source; create them only when cross-source or higher-level synthesis is genuinely useful.
- Prefer a small number of strong pages over many shallow pages.

## Output

- For ingest: report what sources and wiki pages changed.
- For query: answer the question and cite the pages used.
- For lint: report concrete issues found, fixes applied, and any remaining gaps.

## References

- Use `notes/knowledge/schema/` as the durable operating manual.

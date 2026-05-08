---
name: llm-wiki
description: Maintain the persistent knowledge wiki under `notes/knowledge/`. Use this whenever the task is about long-term knowledge capture, ingesting a local file, directory, URL, article, or other source material, querying the knowledge base, or linting and repairing wiki structure.
---

Maintain the persistent LLM wiki under `notes/knowledge/`.

## Goal

- Keep source material, structured wiki pages, and workflow rules separated.
- Make knowledge compound over time through `ingest`, `query`, and `lint`.
- Treat the wiki as a maintained artifact, not as ad hoc notes.

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
- Create or update a source page under `notes/knowledge/wiki/sources/`.
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

- Start from `notes/knowledge/wiki/index.md`.
- Prefer answering from the wiki before going back to raw sources.
- Cite the wiki pages or raw sources used.
- If the answer creates a durable artifact, write it back into `notes/knowledge/wiki/syntheses/` or `notes/knowledge/wiki/reports/` and update `index.md` and `log.md`.

### Lint

- Inspect the wiki for contradictions, stale claims, orphan pages, duplicate topics, weak cross-links, and missing concept/entity pages.
- Fix straightforward structural problems directly when confidence is high.
- If a factual conflict cannot be resolved, mark the uncertainty instead of guessing.
- Record the lint pass in `notes/knowledge/wiki/log.md`.

## Guardrails

- Do not rewrite or paraphrase raw material in place.
- Keep source pages grounded in the referenced source.
- Create concept pages only for named or reusable concepts worth carrying forward.
- Do not create synthesis pages by default for every source; create them only when cross-source or higher-level synthesis is genuinely useful.
- Prefer a small number of strong pages over many shallow pages.

## Output

- For ingest: report what sources and wiki pages changed.
- For query: answer the question and cite the pages used.
- For lint: report concrete issues found, fixes applied, and any remaining gaps.

## References

- Use `notes/knowledge/schema/` as the durable operating manual.

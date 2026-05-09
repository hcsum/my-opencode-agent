# Knowledge Wiki Schema

This directory defines how the agent should maintain the persistent wiki under `notes/knowledge/wiki/`.

## Core Model

- `notes/knowledge/raw/` is the evidence layer. Treat it as source material and do not rewrite the original content.
- `notes/knowledge/wiki/` is the maintained knowledge layer. The agent may create and update markdown pages here.
- `notes/knowledge/schema/` is the operating manual for ingest, query, and lint behavior.

## Directory Rules

- New, unprocessed material belongs in `notes/knowledge/raw/inbox/`.
- After ingest, raw sources may be moved or mirrored into `notes/knowledge/raw/processed/`.
- Binary files such as images, PDFs, or downloaded attachments belong in `notes/knowledge/raw/assets/`.
- Every durable wiki page must live under one of: `sources/`, `entities/`, `concepts/`, `syntheses/`, or `reports/`.

## Ingest Rules

- Ingest means integrating source material into the wiki, not merely indexing it.
- Create or update a source page for each ingested item.
- Resolve same-source candidates in this order: original URL match, existing source-page metadata match, then filename match as a weaker fallback.
- If the original URL matches an existing source page, default to updating that source instead of creating a parallel page unless the new material is clearly a different document.
- If only the filename matches, inspect the existing source page and raw metadata before deciding whether it is truly the same source.
- For updated versions of the same source, keep raw files versioned instead of overwriting older evidence.
- If a newer raw file is clearly the same source with additional material, update the existing source page instead of creating a duplicate topic page.
- De-duplicate repeated content in the wiki layer: keep stable takeaways once, add only net-new facts, and revise older claims when the new source supersedes them.
- When one source version supersedes another, mark that relationship explicitly in the source page while preserving the older raw file for traceability.
- Update any related entity, concept, or synthesis pages when the source adds important information.
- Preserve uncertainty and contradictions instead of flattening them.
- Update `notes/knowledge/wiki/index.md` and append a concise entry to `notes/knowledge/wiki/log.md`.
- Default language policy for ingest: keep source pages in the source language, while writing concept, synthesis, and report pages in Chinese.
- If the user passes `--all-zh`, use Chinese for all derived wiki pages.
- If the user passes `--preserve-language`, keep all derived wiki pages in the source language unless a bilingual term is needed for clarity.

## Query Rules

- If the question is clearly about accumulated knowledge, prior ingests, or historical conclusions, treat it as a wiki query even without an explicit `query wiki` prefix.
- Treat `query wiki <question>` as an explicit force-use-wiki override when the user wants to bypass ambiguity.
- Start from `notes/knowledge/wiki/index.md` to identify relevant pages.
- Prefer answering from the wiki before re-reading raw sources.
- Cite the wiki pages or raw sources that support the answer.
- When a query produces a durable artifact, store it in `notes/knowledge/wiki/syntheses/` or `notes/knowledge/wiki/reports/`.

## Lint Rules

- Look for orphan pages, stale claims, duplicate concepts, weak cross-linking, and gaps in coverage.
- Fix simple structural issues directly when confidence is high.
- If a factual conflict cannot be resolved, mark it explicitly instead of guessing.
- Record the lint pass in `notes/knowledge/wiki/log.md`.

## Writing Conventions

- Use markdown.
- Prefer concise, factual writing over conversational style.
- Use internal links when referencing other wiki pages.
- Keep raw evidence and synthesized conclusions distinguishable.
- Preserve original-language terms inline when translation would blur meaning.

## Trigger Model

- The knowledge system operates through `ingest`, `query`, and `lint` workflows.
- The agent should load the `llm-wiki` skill for long-term knowledge capture, knowledge-base query, and wiki maintenance.
- Knowledge-base questions do not require a fixed trigger phrase; the agent should infer wiki-query intent when the user is clearly asking about stored knowledge.
- The agent decides how to execute the workflow, but should keep all knowledge work under `notes/knowledge/`.

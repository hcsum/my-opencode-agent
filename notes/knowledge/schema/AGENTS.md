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
- Update any related entity, concept, or synthesis pages when the source adds important information.
- Preserve uncertainty and contradictions instead of flattening them.
- Update `notes/knowledge/wiki/index.md` and append a concise entry to `notes/knowledge/wiki/log.md`.
- Default language policy for ingest: keep source pages in the source language, while writing concept, synthesis, and report pages in Chinese.
- If the user passes `--all-zh`, use Chinese for all derived wiki pages.
- If the user passes `--preserve-language`, keep all derived wiki pages in the source language unless a bilingual term is needed for clarity.

## Query Rules

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
- The agent decides how to execute the workflow, but should keep all knowledge work under `notes/knowledge/`.

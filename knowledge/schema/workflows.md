# Workflows

## Ingest

1. Read the requested raw source.
2. Create or update a source page in `knowledge/wiki/sources/`.
3. Update any affected entity, concept, or synthesis pages.
4. Refresh `knowledge/wiki/index.md` if page inventory changed.
5. Append an entry to `knowledge/wiki/log.md`.

## Query

1. Read `knowledge/wiki/index.md` first.
2. Read the most relevant wiki pages.
3. Answer from the wiki before going back to raw material.
4. If the answer is durable, save it under `knowledge/wiki/syntheses/` or `knowledge/wiki/reports/`.
5. Append an entry to `knowledge/wiki/log.md` when a durable artifact is created.

## Lint

1. Check for stale claims, orphan pages, duplicate topics, and missing links.
2. Check whether important referenced concepts or entities lack dedicated pages.
3. Repair straightforward structural issues when safe.
4. Append an entry to `knowledge/wiki/log.md` with findings and fixes.

# Workflows

## Ingest

1. Read the requested raw source.
2. Ensure the source is present under `notes/knowledge/raw/`.
3. Check whether it matches an existing source by original URL, then by existing source-page metadata, then by filename as a weaker fallback.
4. If it is a newer version of an already ingested source, keep it as a new raw version instead of overwriting the older raw file.
5. Create or update a source page in `notes/knowledge/wiki/sources/`.
6. Preserve reusable detail in the source page when a shorter summary would flatten answer frames, decision boundaries, failure modes, debugging order, or other high-value structures.
7. For same-source updates, update the existing source page, fold repeated material together, and add only net-new or changed claims.
8. Create an additional report or synthesis only when the source contains reusable detail patterns that deserve their own artifact.
9. Mark superseded source versions explicitly when the newer source replaces earlier claims or coverage.
10. Update any affected entity, concept, synthesis, or report pages.
11. Refresh `notes/knowledge/wiki/index.md` if page inventory changed.
12. Append an entry to `notes/knowledge/wiki/log.md`.
13. Apply the ingest language policy or any explicit override such as `--all-zh` or `--preserve-language`.

## Query

1. If the question is clearly about accumulated knowledge, prior ingests, or historical conclusions, route it through the wiki even without an explicit `query wiki` prefix.
2. Read `notes/knowledge/wiki/index.md` first.
3. Read the most relevant wiki pages.
4. Answer from the wiki before going back to raw material.
5. If the answer is durable, save it under `notes/knowledge/wiki/syntheses/` or `notes/knowledge/wiki/reports/`.
6. Append an entry to `notes/knowledge/wiki/log.md` when a durable artifact is created.

## Lint

1. Check for stale claims, orphan pages, duplicate topics, and missing links.
2. Check whether important referenced concepts or entities lack dedicated pages.
3. Repair straightforward structural issues when safe.
4. Append an entry to `notes/knowledge/wiki/log.md` with findings and fixes.

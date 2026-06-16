---
name: backlink-prospecting
description: Build and triage backlink targets from competitor exports before any live submission work starts. Use when the task is to parse Semrush exports, generate `backlink-candidates-<competitor>.csv`, dedup against `backlink-master.csv`, decide `doable`, or maintain target CSVs. Not for registering on target sites, filling forms, posting content, or placing live backlinks; use `backlink-execution` for that.
---

This skill owns backlink target generation and triage after raw exports exist.

## Prerequisite

- If you still need the Semrush page or CSV export, load `use-semrush` first.
- Prefer exporting both reports for the same competitor: `Backlinks` and `Referring Domains`.
- Keep the raw CSV exactly as downloaded. Do not trim columns before processing.
- Prefer the `Backlinks` report over `Referring Domains` when you need a worked example source page.

## Generate Candidates

Run:

```bash
npx tsx .opencode/skills/backlink-prospecting/scripts/competitor-candidates.ts <competitor-substring>
```

What it does:

- reads the newest `<sub>*-backlinks.csv` plus matching `*refdomains*.csv` from `~/Downloads` and falls back to `notes/seo/site-backlinks/`
- drops every referring domain already present in `notes/seo/backlink-master.csv` using registrable-domain dedup
- picks one representative live link per new domain, preferring dofollow and then higher page authority
- writes `notes/seo/backlink-candidates-<competitor>.csv` sorted by `AS` descending
- preserves any existing `doable` values if the candidates file already exists

Output columns:

- `website, doable, AS, example_source, dofollow`

## Triage Rules

- The only selection criterion is whether the placement looks doable with little effort.
- Do not mark `no` just because the link is low quality, nofollow, or off-topic.
- Very high-AS rows are often search engines, app stores, or aggregators that are not realistically reproducible.
- If Semrush exported a referring domain without any usable per-link example, skip it for now; the script already excludes those rows.

## Handoff To Execution

- This skill stops at target generation, dedup, and `doable` triage.
- Once you decide a target should be worked, load `backlink-execution` for the site-by-site submission flow.
- Keep `doable` focused on whether the target looks realistically placeable with low to moderate effort, not whether you have already completed it.

## Promote Keepers

- Triage `doable` row by row in `backlink-candidates-<competitor>.csv`.
- Promote only the keepers into `backlink-master.csv` so future runs dedup correctly.
- Re-running the script is safe; it preserves prior `doable` decisions already written in the candidates file.

## Caveats

- The script expects the full Semrush export with columns such as `Source url`, `Nofollow`, `Page ascore`, and `Last seen`.
- Semrush caps large per-link exports, so some refdomains may exist in the domain-level export but never appear in the emitted candidates file.

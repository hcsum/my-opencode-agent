---
name: backlink-workflow
description: Turn competitor backlink exports into actionable link candidates and run the backlink prospecting workflow after export. Use when the task is "挖外链", generate `backlink-candidates-<competitor>.csv`, dedup against `backlink-master.csv`, decide `doable`, or maintain backlink candidate/master CSVs. If the raw Semrush export does not exist yet, load `use-semrush` first.
---

This skill owns the backlink prospecting workflow after raw exports exist.

## Prerequisite

- If you still need the Semrush page or CSV export, load `use-semrush` first.
- Prefer exporting both reports for the same competitor: `Backlinks` and `Referring Domains`.
- Keep the raw CSV exactly as downloaded. Do not trim columns before processing.
- Prefer the `Backlinks` report over `Referring Domains` when you need a worked example source page.

## Generate Candidates

Run:

```bash
npx tsx .opencode/skills/backlink-workflow/scripts/competitor-candidates.ts <competitor-substring>
```

What it does:

- reads the newest `<sub>*-backlinks.csv` plus matching `*refdomains*.csv` from `~/Downloads` and falls back to `notes/seo/site-backlinks/`
- drops every referring domain already present in `notes/seo/backlink-master.csv` using registrable-domain dedup
- picks one representative live link per new domain, preferring dofollow and then higher page authority
- writes `notes/seo/backlink-candidates-<competitor>.csv` sorted by `AS` descending
- preserves any existing `doable` values if the candidates file already exists

Output columns:

- `website, doable, AS, example_source, anchor, dofollow, links, flags, src_title`

`flags` may include `form`, `ugc`, `sitewide`, `sponsored`, or `frame`.

## Triage Rules

- The only selection criterion is whether the placement looks doable with little effort.
- Do not mark `no` just because the link is low quality, nofollow, or off-topic.
- `form` and `ugc` are usually the fastest self-serve signals.
- Very high-AS rows are often search engines, app stores, or aggregators that are not realistically reproducible.
- If Semrush exported a referring domain without any usable per-link example, skip it for now; the script already excludes those rows.

## Execution Rules

- For multi-step backlink platforms or rich-text editors, prepare the content and hand the UI clicks to the user instead of forcing full automation.
- Do not abandon a platform on the first blocker; surface captcha, login, or manual-only steps so the user can help.
- Each backlink article or post must use genuinely unique content. Vary angle, headings, prose, and anchor choices.
- Update the backlink tracking CSV after each completed link item, not in a batch at the end.

## Promote Keepers

- Triage `doable` row by row in `backlink-candidates-<competitor>.csv`.
- Promote only the keepers into `backlink-master.csv` so future runs dedup correctly.
- Re-running the script is safe; it preserves prior `doable` decisions already written in the candidates file.

## Caveats

- The script expects the full Semrush export with columns such as `Anchor`, `Source title`, and the backlink flags.
- Semrush caps large per-link exports, so some refdomains may exist in the domain-level export but never appear in the emitted candidates file.

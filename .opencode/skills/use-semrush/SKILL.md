---
name: use-semrush
description: Get SEO data for any provided website or keyword on Semrush. Can also be used to export keyword and backlink data. 
---

## Prerequisite

Load `web-access` 

Then visit: https://sem.3ue.co/home

**IMPORTANT**: Confirm if the website open correctly. If you got redirected to the login page, find credentials from `./notes` and log in manually. After successful login, click "打开" to enter the main dashboard. Only after you can see the dashboard, the skill is ready to use. If you cannot log in successfully, stop and report the issue.

## Export via UI (split workflow)

The user clicks the native 导出/Export button in their browser. The agent opens the right Semrush page and processes the downloaded CSV afterward.

Steps:

1. **Agent**: open the relevant Semrush report URL in the dedicated browser via `web-access` CDP (`/new?url=...`). Pick the URL from the Known URL Formats table.
2. **User**: applies filters in the UI (e.g. Follow only, Active only), then clicks 导出 → CSV. Semrush saves the file to `~/Downloads/`.
3. **Agent**: ingest the CSV by running:
   ```
   npx tsx .opencode/skills/use-semrush/scripts/process-export.ts [filename-substring]
   ```
   The script finds the newest matching CSV in `~/Downloads`, classifies it by filename (`backlinks_refdomains` → refdomains, `-backlinks` → backlinks, `organic.Positions` → keywords), and moves it to `notes/seo/site-backlinks/` or `notes/seo/site-keywords/`. For `-backlinks` exports it then trims the columns to `Page ascore, Source url, Target url, Nofollow, First seen, Last seen` and sorts by `Page ascore` desc in place.
4. **Agent**: run any further task-specific analysis (cross-site joins, filtering by AS threshold, classifying source-page type, etc.) inline on the ingested file.

Prefer the Backlinks report (per-link rows with Source URL) over the Referring Domains report (domain-level aggregate, lacks source URLs). If the user exports the wrong report, just have them re-export — the script always picks the newest matching file.

## Known URL Formats

| Page | URL |
|------|-----|
| Domain overview | `https://sem.3ue.co/analytics/overview/?q={domain}&protocol=https&searchType=domain` |
| Keyword overview | `https://sem.3ue.co/analytics/keywordoverview/?q={keyword}&db=us` |
| Backlinks of a domain | `https://sem.3ue.co/analytics/backlinks/backlinks/?q={domain}&searchType=domain` |
| Keyword Rankings of a domain | `https://sem.3ue.co/analytics/organic/positions/?q={domain}&searchType=domain` |
| Relevant keyword list for a given keyword | `https://sem.3ue.co/analytics/keywordmagic/?q={keyword}&db=us` |

## Filtering and Sorting

- Keyword list can be filtered and sorted by various metrics, such as search volume, keyword difficulty (KD), CPC, etc.
- Backlink list can be filtered and sorted by metrics such as authority score, traffic, etc.

## Data fetch rules

- For search volume, take "Global Volume" (全球搜索量) instead of "Volume" (搜索量) unless user specifies otherwise.

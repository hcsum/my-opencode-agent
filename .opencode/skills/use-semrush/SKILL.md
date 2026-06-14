---
name: use-semrush
description: Get SEO data from Semrush for domains and keywords: domain overview, keyword overview, organic rankings, and keyword ideas. Use whenever the task is to inspect Semrush metrics, review rankings, export keyword reports, or analyze Semrush keyword CSV data.
---

## Prerequisite

Load `web-access`

Then visit: https://sem.3ue.co/home

**IMPORTANT**: Confirm if the website open correctly. If you got redirected to the login page, find credentials from `./notes` and log in manually. After successful login, click "打开" to enter the main dashboard. Only after you can see the dashboard, the skill is ready to use. If you cannot log in successfully, stop and report the issue.

## Export via UI (split workflow)

The user clicks the native 导出/Export button in their browser; the agent opens the right Semrush page and works on the downloaded CSV afterward.

Steps:

1. **Agent**: open the relevant Semrush report URL in the dedicated browser via `web-access` CDP (`/new?url=...`). Pick the URL from the Known URL Formats table.
2. **User**: applies filters in the UI, then clicks 导出 → CSV. Semrush saves the file to `~/Downloads/`.
3. **Agent**: read the raw CSV where it landed and do the task-specific analysis inline.

## Known URL Formats

| Page | URL |
|------|-----|
| Domain overview | `https://sem.3ue.co/analytics/overview/?q={domain}&protocol=https&searchType=domain` |
| Keyword overview | `https://sem.3ue.co/analytics/keywordoverview/?q={keyword}&db=us` |
| Keyword Rankings of a domain | `https://sem.3ue.co/analytics/organic/positions/?q={domain}&searchType=domain` |
| Relevant keyword list for a given keyword | `https://sem.3ue.co/analytics/keywordmagic/?q={keyword}&db=us` |

## Filtering and Sorting

- Keyword lists can be filtered and sorted by search volume, keyword difficulty (KD), CPC, and related metrics.

## Data fetch rules

- For search volume, take "Global Volume" (全球搜索量) instead of "Volume" (搜索量) unless the user specifies otherwise.

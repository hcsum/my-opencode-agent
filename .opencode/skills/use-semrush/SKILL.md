---
name: use-semrush
description: Get SEO data for any provided website or keyword on Semrush. Can also be used to export keyword and backlink data. 
---

## Prerequisite

Load `web-access` 

Then visit: https://sem.3ue.co/home

**IMPORTANT**: Confirm if the website open correctly. If you got redirected to the login page, find credentials from `./notes` and log in manually. After successful login, click "打开" to enter the main dashboard. Only after you can see the dashboard, the skill is ready to use. If you cannot log in successfully, stop and report the issue.

## Export

Script entry:

`npx tsx .opencode/skills/use-semrush/scripts/export.ts <site> [options]`

Supported export types:

- `--type keywords`: export keyword rankings CSV to `notes/keywords/`
- `--type backlinks`: export backlink detail CSV to `notes/backlinks/`
- `--type refdomains`: export referring-domain aggregate CSV to `notes/backlinks/`

Examples:

- `npx tsx .opencode/skills/use-semrush/scripts/export.ts character.ai --type keywords --db us --min-volume 1000 --max-kd 40`
- `npx tsx .opencode/skills/use-semrush/scripts/export.ts <domain> --type backlinks`
- `npx tsx .opencode/skills/use-semrush/scripts/export.ts <domain> --type refdomains`

## Known URL Formats

| Page | URL |
|------|-----|
| Domain overview | `https://sem.3ue.co/analytics/overview/?q={domain}&protocol=https&searchType=domain` |
| Keyword overview | `https://sem.3ue.co/analytics/keywordoverview/?q={keyword}&db=us` |
| Backlinks of a domain | `https://sem.3ue.co/analytics/backlinks/backlinks/?q={domain}&searchType=domain` |
| Referring Domains of a domain | `https://sem.3ue.co/analytics/refdomains/report/?q={domain}&searchType=domain` |
| Keyword Rankings of a domain | `https://sem.3ue.co/analytics/organic/positions/?q={domain}&searchType=domain` |
| Relevant keyword list for a given keyword | `https://sem.3ue.co/analytics/keywordmagic/?q={keyword}&db=us` |

## Filtering and Sorting

- Keyword list can be filtered and sorted by various metrics, such as search volume, keyword difficulty (KD), CPC, etc.
- Backlink list can be filtered and sorted by metrics such as authority score, traffic, etc.

## Data fetch rules

- For search volume, take "Global Volume" (全球搜索量) instead of "Volume" (搜索量) unless user specifies otherwise.

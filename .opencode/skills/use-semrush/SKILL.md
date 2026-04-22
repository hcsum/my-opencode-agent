---
name: use-semrush
description: Get SEO data for any provided website or keyword. 
---

## Prerequisite

Load `web-access` first and run:

```bash
bash .opencode/skills/web-access/scripts/check-deps.sh
```

Then visit: https://sem.3ue.co/home

**IMPORTANT**: Confirm if the website open correctly. If you got redirected to the login page, find credentials from `notes/semrush-credentials.md` and log in manually. After successful login, click "打开" to enter the main dashboard. Only after you can see the dashboard, the skill is ready to use. If you cannot log in successfully, stop and report the issue.

## Known URL Formats

| Page | URL |
|------|-----|
| Domain Overview | `https://sem.3ue.co/analytics/overview/?q={domain}&protocol=https&searchType=domain` |
| Referring Domains (backlinks) | `https://sem.3ue.co/analytics/refdomains/report/?q={domain}&searchType=domain` |
| Keyword Rankings of A Domain | `https://sem.3ue.co/analytics/organic/positions/?q={domain}&searchType=domain` |
| Keyword Overview | `https://sem.3ue.co/analytics/keywordoverview/?q={keyword}&db=us` |
| Relevant Keyword List for A Given Keyword | `https://sem.3ue.co/analytics/keywordmagic/?q={keyword}&db=us` |

## Filtering and Sorting

Keyword list can be filtered and sorted by various metrics, such as search volume, keyword difficulty (KD), CPC, etc.
Backlink list can be filtered and sorted by metrics such as authority score, traffic, etc.

## Data Export

Data from Semrush can be exported as CSV files. Look for a button called "导出", click it, and then choose "CSV" format to download the data. The exported CSV files can be found in the default download folder of the system, usually `~/Downloads`. File name usually contains the keyword or domain name and the date of export.

## Data fetch rules

- For search volume, take "Global Volume" (全球搜索量) instead of "Volume" (搜索量) unless user specifies otherwise.
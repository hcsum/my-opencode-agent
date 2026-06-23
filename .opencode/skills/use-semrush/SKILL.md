---
name: use-semrush
description: Get SEO data from Semrush for domains and keywords: domain overview, keyword overview, organic rankings, and keyword ideas. Use whenever the task is to inspect Semrush metrics, review rankings, export keyword reports, or analyze Semrush keyword CSV data.
---

## Prerequisite

Load `web-access`

Readiness is about **login state**, not the dashboard UI. Test it by navigating directly to a real report URL from the Known URL Formats table (e.g. open `https://sem.3ue.co/analytics/keywordoverview/?q=test&db=us`) and checking whether report data renders:

- **Report data renders** → ready. Proceed; do not visit the dashboard.
- **Redirected to the login page** (`dash.3ue.co/...#/login`) → find credentials in `./notes/credentials/semrush.md`, fill `#input-username` / `#input-password`, click 登录. After login, go **straight to the report URL again** — it now works.

**Do NOT gate readiness on the dashboard's `打开` button.** That button opens an `about:blank` popup that often never navigates (known-broken); waiting for it will hang the skill. The user-center dashboard (`dash.3ue.co/.../home`) is only needed to log in or check the subscription — never as a required step to reach reports.

If login fails (bad credentials, device-limit lockout — Semrush caps simultaneous devices on the shared account), stop and report the issue.

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

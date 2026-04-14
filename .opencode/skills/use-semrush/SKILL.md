---
name: use-semrush
description: Query backlink data for any domain via sem.3ue.co. Returns referring domains, authority scores, and link counts without needing a SEMrush account.
---

# Sem Backlink Lookup

Query backlink and SEO data for any website through the sem.3ue.co SEMrush mirror.

## Prerequisite

Load `web-access` first and run:

```bash
bash .opencode/skills/web-access/scripts/check-deps.sh
```

Before running any Semrush workflow, first confirm the Semrush mirror opens normally:

```bash
curl -s "http://localhost:3456/new?url=https://sem.3ue.co/analytics/overview/?q=example.com&searchType=domain"
```

Then inspect the opened page. If it redirects to login, shows a permission problem, fails to load, or otherwise does not expose Semrush data, stop the workflow and tell the user to fix the Semrush permission/session issue. Do not continue with fallback research until the user confirms the issue is resolved.

## Known URL Formats

| Page | URL |
|------|-----|
| **Referring Domains (backlink detail)** | `https://sem.3ue.co/analytics/refdomains/report/?q={domain}&searchType=domain` |
| Keyword Rankings | `https://sem.3ue.co/analytics/organic/positions/?q={domain}&searchType=domain` |
| Domain Overview | `https://sem.3ue.co/analytics/overview/?q={domain}&searchType=domain` |

## Export Backlinks

Export all backlinks for a domain to `notes/backlinks/{domain}.csv`.

```bash
printf '%s' '{"action":"export","domain":"example.com"}' | npx tsx .opencode/skills/use-semrush/scripts/export.ts
```

The script:
1. Opens the Referring Domains page
2. Clicks the "导出" (Export) button
3. Waits for the download to complete
4. Moves the file to `notes/backlinks/{domain}.csv`
5. Cleans up the original download and the browser tab

## Keyword Discovery Workflow

Use this workflow when you want to mine a site's existing organic keywords as candidate terms to build around.

Goal:
- Find a website's organic keywords
- Filter to `KD 0-40`
- Sort by traffic from high to low
- Review the top `50` keywords as candidate opportunities

Recommended target:
- Start with a site that is already getting SEO traffic in the niche you care about
- Good candidates are fast-growing new sites or strong niche sites, not giant irrelevant brands

Workflow:
1. Confirm the Semrush mirror opens normally and exposes Semrush data. If it does not, stop and ask the user to fix the permission/session issue before continuing.

2. Open the organic positions page:
   ```bash
   curl -s "http://localhost:3456/new?url=https://sem.3ue.co/analytics/organic/positions/?q={domain}&searchType=domain"
   ```

3. Wait for the page to load, then confirm you are on `自然排名`.

4. Apply filters:
   - `KD`: `0-40`
   - Sort by `流量` descending

5. Review the first `50` keywords.

6. Use those keywords as a candidate pool, then manually judge:
   - Is the intent relevant to the kind of site you want to build?
   - Is the current ranking page type something you can reproduce or improve?
   - Is it a one-off term, or can it expand into related long-tail pages?

7. Prefer keyword clusters, not just one keyword:
   - Main term
   - Misspellings / typo terms
   - adjacent variants
   - related long-tail pages

Interpretation rule:
- Do not blindly copy only the head keyword.
- Look at what the site is repeatedly targeting across its top keywords. That repeated pattern is often the real strategy.
- Example: a site may start from one big game keyword, then expand into adjacent game names, typo variants, and similar game pages.

## Manual Workflow

If the export script fails, use CDP manually:

1. **Open a new tab** with the target URL:
   ```bash
   curl -s "http://localhost:3456/new?url=https://sem.3ue.co/analytics/refdomains/report/?q={domain}&searchType=domain"
   ```
   The response contains `targetId`.

2. **Wait for page load** (3-4 seconds), then check:
   ```bash
   curl -s "http://localhost:3456/info?target={targetId}"
   ```

3. **Click "导出"** (Export button) to trigger download:
   ```bash
   curl -s -X POST "http://localhost:3456/clickAt?target={targetId}" -d 'button'
   ```
   If the button selector is ambiguous, inspect the page first:
   ```bash
   curl -s -X POST "http://localhost:3456/eval?target={targetId}" -d 'Array.from(document.querySelectorAll("button")).map((b,i) => i + ": " + b.textContent.trim()).join("\n")'
   ```

4. **Move the downloaded file** from ~/Downloads to `notes/backlinks/{domain}.csv`

5. **Close the tab**:
   ```bash
   curl -s "http://localhost:3456/close?target={targetId}"
   ```

## Notes

- **Do not include `__gmitm`** in URLs — the browser session attaches it automatically.
- **Session expires quickly**: If redirected to `https://dash.3ue.co/zh-Hans/#/login`, inform the user they need to log in again.
- A healthy page title looks like: `{domain}，引荐域名 | Semrush`

## Data Fields (Referring Domains)

| Field | Meaning |
|-------|---------|
| Domain | The backlink source domain |
| Backlinks | Number of links from that source |
| AS | Authority Score (0-100) |
| Follow / Nofollow | Link attribute |
| First Seen / Last Seen | When the link was first/last detected |
| New / Lost | Whether the domain is newly found or no longer links |

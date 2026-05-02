---
name: use-google-trends
description: Open Google Trends for the user to inspect or get Google Trends data for up to 5 keywords, including interest over time, related queries, and top regions. Use this whenever the user asks for Google Trends data, keyword trend comparison, relative search interest, or related/rising Google Trends queries. 
---

## Open Google Trends for user inspection

Do this when "open Google Trends for X", "show me Google Trends for X", "I want to see the Google Trends page for X", or similar.

```bash
open "https://trends.google.com/explore?q=<keyword>,<keyword>&date=today%201-y&geo=Worldwide"
```

Replace the query parameters with the user's requested keywords, time range, and region.

Can exit from here if the user just wants to see the page and does not need you to extract any data from it. If they do want data, proceed to the next section.

## Fetch Google Trends data for up to 5 keywords

Do this when the user asks for Google Trends data, keyword trend comparison, relative search interest, or related/rising Google Trends queries.

### Prerequisite

Load `web-access` if browser access is not already ready.

### Goal

- Return Google Trends data reliably without rebuilding the workflow inline.
- Prefer reusable execution paths that survive proxy response shape changes and transient Google rate limits.
- Return partial results when some widgets fail instead of discarding usable data.
- Distinguish API-only collection from page-UI inspection. They have different tab-focus requirements.

### Approach

- Run the bundled helper script first.
- The script uses a `trends.google.com` page context plus page-side `fetch` to call `explore` and the needed `widgetdata/*` endpoints.
- Treat `TIMESERIES` and `RELATED_QUERIES` as primary outputs. Treat `GEO_MAP` as optional because it is more likely to hit rate limits.
- If the task is about what the page UI shows, pagination controls, or rendered widgets rather than raw API data, inspect an active foreground tab instead of a background tab.
- Only fall back to a manual inline script when debugging the helper or running a one-off experiment.

### Instructions

1. Run the bundled helper script first: `node ./scripts/fetch-trends.mjs --keyword "chatgpt"`.
2. Use `--keyword` with a comma-separated list or repeat the positional keywords, but keep the total at 5 or fewer.
3. Use `--geo` only when the user asked for a specific region; otherwise don't provide this flag for worldwide.
5. If `GEO_MAP` succeeds, present only non-zero regions sorted descending.
6. If one of `TIMESERIES`, `RELATED_QUERIES`, or `GEO_MAP` fails, return the successful sections and surface the corresponding `timeseriesError`, `relatedError`, or `geoError`.
7. If you need to verify whether the website paginates, lazy-renders, or hides rows in the UI, do not rely on a background tab's DOM. Use an active tab and inspect the rendered page state.
9. Only switch to a manual inline script when the bundled helper itself needs debugging.

### Execution stability

- The bundled script already handles the current proxy response shape, retries `429`/HTML widget failures, cleans up the created tab, and returns JSON.
- When creating a new tab through the CDP proxy, read both `id` and `targetId`. Different callers and proxy responses may expose either field.
- If you must debug outside the helper, load `references/manual-debugging.md` and prefer a heredoc-style `node <<'NODE' ... NODE` script over `node -e`.

### Bundled script

Primary helper:

```bash
node ./.opencode/skills/use-google-trends/scripts/fetch-trends.mjs --keyword "chagpt"
```

Useful options:

```bash
node ./.opencode/skills/use-google-trends/scripts/fetch-trends.mjs --keyword "chagpt,claude" --time "today 12-m"
node ./.opencode/skills/use-google-trends/scripts/fetch-trends.mjs --keyword "chagpt" --geo "US"
node ./.opencode/skills/use-google-trends/scripts/fetch-trends.mjs --keyword "chagpt" --no-geo
```

What it returns:

- `averageInterest` keyed by keyword
- `peakWeeks` keyed by keyword
- `timeline` keyed by keyword
- `relatedQueries` as normalized ranked lists
- `topRegions` sorted descending after zero-value filtering
- `timeseriesError`, `relatedError`, `geoError` for partial-failure visibility

### Output

- Report the search scope you used: keywords, region, time range, and property.
- Lead with the most decision-useful signal: overall interest trend, peaks, comparison result, or major related queries.
- If the result is partial, say which sections succeeded and which error fields were populated.

### Why This Works

- A hidden or unfocused Google Trends tab often does not render chart data into the page UI reliably.
- But a `trends.google.com` page context can still call the Trends API directly.
- `about:blank` is not enough; use a `trends.google.com` page as the browser context.
- This means API collection can work from a non-visible tab, while DOM/UI inspection may fail unless the tab is active.

### Data fields

| Field             | Meaning                                                                 |
| ----------------- | ----------------------------------------------------------------------- |
| `averageInterest` | Relative interest score (0-100), only meaningful within this comparison |
| `topQueries`      | Most common searches for this keyword                                   |
| `risingQueries`   | Queries with fastest growing interest (`Breakout` = surge)              |

### Notes

- Average interest is relative, not absolute search volume.
- Direct Node.js requests may fail in this environment; prefer page-side requests inside the `trends.google.com` browser context.
- `web-access` `/eval` responses are JSON wrappers; parse the HTTP body, then read `.value` before handling the actual Trends payload.
- `widgetdata/comparedgeo` is more likely than `multiline` or `relatedsearches` to return an HTML `429` page. Treat this as a recoverable partial failure, not proof that the whole workflow is broken.
- If a widget response is HTML instead of JSON, inspect `status` and the first part of the response body before assuming your JSON parsing is wrong.
- Minimum acceptable result: `multiline` or `relatedsearches` succeeds. Preferred result: both succeed. Region data is optional unless the user explicitly asks for it.
- If `geoMapData` is returned, do not trust the raw order for display. Filter out zero-value rows and sort descending before showing top regions.

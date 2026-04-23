---
name: use-google-trends
description: >-
  Use this skill ONLY when comparing 2-5 keywords simultaneously on Google
  Trends and extracting Rising Queries / Top Queries for each term. Do not use
  this skill for single keyword trend lookup, general Google Trends browsing,
  or tasks that do not require multi-keyword comparison.
---

# Check Google Trends

Use Google Trends as a research source for:

- comparing search demand across multiple keywords (2-5 recommended)
- checking which terms sustain interest over time
- finding top queries per keyword
- spotting adjacent user language and search intent

## Prerequisite

If browser access is not already ready, load `web-access`.

## Command

Run:

```bash
printf '%s' '{"keywords":["<keyword1>","<keyword2>"],"geo":"US","date":"today 12-m"}' | npx tsx .opencode/skills/use-google-trends/scripts/compare.ts
```

- `keywords`: array of 1-5 search terms to compare
- `geo`: optional geography (default: `US`)
- `date`: optional date range (default: `today 12-m`)
- The script returns JSON with `success`, `message`, and `data` containing average interest and top queries per keyword.
- If the proxy is unavailable, get `web-access` ready first, then retry.

## Data fields

| Field             | Meaning                                                                 |
| ----------------- | ----------------------------------------------------------------------- |
| `averageInterest` | Relative interest score (0-100), only meaningful within this comparison |
| `topQueries`      | Most common searches for this keyword                                   |
| `risingQueries`   | Queries with fastest growing interest (`Breakout` = surge)              |

## Notes

- Average interest is relative, not absolute search volume.

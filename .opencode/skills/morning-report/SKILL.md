---
name: morning-report
description: Generate a dense but natural morning briefing based on the user's preferred news sources, portfolio, and ongoing interests.
---

## Scheduling

This report is a natural fit for the scheduler. If the user asks to receive it on a cadence (e.g. "every weekday morning at 8am"), use `schedule_create` with `kind='cron'` and a `prompt` like `"produce the morning report"` so a fresh run fires on schedule.

## News Sources

- Load the `summarization` skill before writing any summaries.
- Use a real browser to access the websites directly.
- For each website:
  - Briefly explain the site's overall mood/theme for the day.
  - Select 2 articles that are most likely to interest the user specifically, not merely the biggest headlines.
  - For each selected article, capture the exact article title and the final article URL from the page or page interaction. Do not guess URLs.
  - Prioritize stories connected to:
    - technology
    - markets
    - geopolitics
    - software/business strategy
    - internet/product trends
    - capital flows
- Summaries should explain:
  - what happened
  - why it matters
  - the deeper narrative or incentive structure behind it
  - important implications or tensions
- Do not turn the report into a headline digest.
- Prefer analyst-style explanation over compressed news blurbs.
- When meaningful, naturally connect narratives across different websites, but do not force synthesis if there is no real connection.
- Treat article links as required output, not an optional extra.
- If you cannot recover a stable article URL for a candidate piece, skip that piece and pick another article you can title and link correctly.

## Output

- Under each website section, list the 2 selected articles with:
  - the exact article title
  - one standalone line containing the article URL
  - the analytical summary below that title/link pair
- Do not batch multiple article links onto one line.
- Do not invent, reconstruct, or hand-edit article URLs.

## Portfolio-Relevant Company News

- Do not focus on daily price moves, percentages, or generic market commentary.
- Search for meaningful developments related to companies the user owns.
- Prioritize:
  - strategy shifts
  - product launches
  - AI positioning
  - regulation
  - earnings implications
  - competitive threats
  - infrastructure/capex
  - management decisions
  - partnerships
  - industry changes
- Explain why the development may matter long term.

## Todos

- Briefly list important todos, reminders, or upcoming items for the day if available.

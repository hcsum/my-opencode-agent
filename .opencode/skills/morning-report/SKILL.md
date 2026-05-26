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
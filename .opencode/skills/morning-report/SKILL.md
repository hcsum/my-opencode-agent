---
name: morning-report
description: Generate a dense but natural morning briefing from the user's preferred news sources plus a separate portfolio check. Use when the user asks for the morning report / 早报 / daily briefing, or when the scheduler fires this task.
---

Produce a daily briefing in two independent rounds: a portfolio-blind news round over the user's favorite websites, then a separate portfolio-news round. Lead with what has actually changed since the previous reports, and stay short and honest on quiet days.

## Before you start

- Load the `summarization` skill before writing any summaries.
- Use a real browser to access the websites directly. Do not guess or reconstruct URLs — capture the exact final article URL from the page or page interaction.
- Read the user's sources, holdings, and interests from `./notes/user.md`. The holdings are used **only** in Round 2.

## Continuity (do this first)

The runtime prepends your most recent previous outputs for this task inside a `<prior_runs>` block. Treat it as a **hard exclusion list**, not soft guidance — repeating yesterday's articles is the main failure mode of this report.

Before selecting anything, extract from `<prior_runs>` the set of every article **title and URL** already published. Then:

- **Hard exclude (no exceptions):** never re-list an article whose title or URL already appeared in `<prior_runs>`. The same piece, the same press release, or the same information restated by another outlet all count as already-covered. Do not re-select it as a "new main story," even if it is still the biggest news of the day.
- **Distinguish repeat from progression.** A new article on a topic you covered before is allowed **only** when it carries a genuinely new development (new decision, new number, new counterparty, new stage). When it does, write **only the delta** in one or two lines, explicitly framed as an update ("较昨日新增：…"), not a fresh full write-up. If you cannot name what is new, it is a repeat — exclude it.
- **When in doubt, exclude.** A shorter, honest report beats padding with yesterday's stories.
- If `<prior_runs>` is absent (first run), just produce the report normally.

You will run a final dedup pass against this exclusion list before sending — see **Before sending** below.

## Round 1 — News (favorite websites), portfolio-blind

Select by **broad significance**: the genuinely most important or most interesting stories of the day across technology, markets, geopolitics, business/software strategy, product/internet trends, and capital flows.

- **Portfolio-blind:** do NOT pick an article because it relates to the user's holdings. Holdings are handled in Round 2. Choosing on portfolio relevance is the main thing that has skewed past reports — avoid it here.
- **Topic diversity (hard rule):** across all selected news articles, AI-centric pieces may be **at most about half**. When the day offers a clearly non-AI story of real significance, include at least one. Consciously vary themes across the three sites; do not let one narrative (e.g. AI) carry the whole report.
- **No forced synthesis:** connect narratives across sites only when there is a real, non-forced link. Do not manufacture a single through-line (especially not an AI one) just to tie the report together.

For each site:

- Open with one short line on the site's overall mood/theme for the day.
- Select 2 articles per the rules above.
- Skip any candidate whose stable URL you cannot recover, and pick another you can title and link correctly.

Per selected article, write analyst-style (not a headline blurb):

- what happened
- why it matters
- the deeper narrative or incentive structure behind it
- important implications or tensions

## Round 2 — Portfolio-relevant news (separate search round)

Run this as its own search round after Round 1 — not a re-selection of Round 1's articles.

- Report a holding **only** when there is genuinely material news: strategy shift, product launch, regulation, earnings implication, competitive threat, capex/infrastructure, management decision, partnership, or industry change. Any material driver qualifies — this is **not** limited to AI angles.
- Do not focus on daily price moves, percentages, or generic commentary.
- **Omit holdings with no material news.** Do not produce a per-stock roster that comments on every ticker.
- If nothing across the portfolio is material today, drop the section — a single line such as `组合层面今天无重大进展` is fine instead of padding.
- Explain why a development may matter long term.

## Quiet days

If little has materially changed versus the previous reports, produce a **short, honest** report: say so briefly and surface only the genuinely new items. Do not pad with generic market commentary, re-explanations, or filler to reach a familiar length.

## Output

- Reply in Chinese (简体) per project rules; keep English titles, product names, tickers, and code identifiers in the original.
- Under each site section in Round 1, list the 2 selected articles, each as:
  - the exact article title
  - one standalone line containing only the article URL (no quotes, backticks, or angle brackets; one link per line)
  - the analytical summary below that title/link pair
- Do not batch multiple article links onto one line. Do not invent, reconstruct, or hand-edit URLs.
- Keep the portfolio section separate from the news section.
- End with a brief **待办 / todos** list of important reminders or upcoming items for the day if any are available.

## Before sending (dedup gate)

Run this check on the finished draft before you send it:

- Compare every article title and URL in the draft against the exclusion list you extracted from `<prior_runs>`.
- If any selected article matches a prior title or URL and is **not** framed as a one-or-two-line "较昨日新增" delta, remove it and either replace it with a genuinely new story or leave the report shorter.
- Confirm no Round 1 article duplicates another within the same run.
- Only send once the draft contains no already-covered full write-ups.

## Scheduling

This report fits the scheduler. If the user asks to receive it on a cadence (e.g. "every weekday morning at 8am"), use `schedule_create` with `kind='cron'` and a `prompt` like `"produce the morning report"` so a fresh run fires on schedule.

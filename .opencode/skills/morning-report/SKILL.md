---
name: morning-report
description: Generate a dense but natural morning briefing from the user's preferred news sources plus a separate portfolio check. Use when the user asks for the morning report / 早报 / daily briefing, or when the scheduler fires this task.
---

Produce a daily news briefing in two independent rounds: a portfolio-blind news round over the user's favorite websites, then a separate portfolio-news round. Lead with what has actually changed since the previous reports, and stay short and honest on quiet days.

## Before you start

- Load the `summarization` skill before writing any summaries.
- Use a real browser to access the websites directly. Do not guess or reconstruct URLs — capture the exact final article URL from the page or page interaction.
- The user's sources, holdings, and interests are already in context from `notes/user.md` (loaded into the system prompt each session) — use that, no need to re-read the file. The holdings are used **only** in Round 2.
- Treat the `## Favorite Websites` list as a **sourcing pool to scan**, not a checklist to fill: you do NOT have to surface something from every site (see Round 1 selection).

## Continuity (do this first)

The runtime prepends your most recent previous outputs for this task inside a `<prior_runs>` block. Treat it as a **hard exclusion list**, not soft guidance — repeating yesterday's articles is the main failure mode of this report.

Before selecting anything, extract from `<prior_runs>` the set of every article **title and URL** already published, and use it to steer selection as you draft. Then:

- **Hard exclude (no exceptions):** never re-list an article whose title or URL already appeared in `<prior_runs>`. The same piece, the same press release, or the same information restated by another outlet all count as already-covered. Do not re-select it as a "new main story," even if it is still the biggest news of the day.
- **Distinguish repeat from progression.** A new article on a topic you covered before is allowed **only** when it carries a genuinely new development (new decision, new number, new counterparty, new stage). When it does, write **only the delta** in one or two lines, explicitly framed as an update ("较昨日新增：…"), not a fresh full write-up. If you cannot name what is new, it is a repeat — exclude it.
- **When in doubt, exclude.** A shorter, honest report beats padding with yesterday's stories.
- If `<prior_runs>` is absent (first run), just produce the report normally.

This exclusion list drives selection in Round 1: you dedup the candidate articles against it (with a script) **before** summarizing anything, so you never spend effort writing up a story you'll have to drop. See Round 1, step 2.

## Round 1 — News (favorite websites), portfolio-blind

Select by **broad significance**: the genuinely most important or most interesting stories of the day across technology, markets, geopolitics, business/software strategy, product/internet trends, and capital flows.

- **Portfolio-blind:** do NOT pick an article because it relates to the user's holdings. Holdings are handled in Round 2. Choosing on portfolio relevance is the main thing that has skewed past reports — avoid it here.
- **Topic diversity (hard rule):** across the selected articles, a dominant theme covers **at most about half**. Consciously vary themes; do not let one narrative carry the whole report.
- **No forced synthesis:** connect narratives only when there is a real, non-forced link. Do not manufacture a single through-line (especially not an AI one) just to tie the report together.

Build Round 1 as a pipeline — **gather → dedup → verify → finalize → summarize** — so deduping happens at *selection* time, not after you've already written everything up.

1. **Gather candidates.** Scan every site in the list (it is a pool, not a per-site checklist — the best stories can all come from one site, and a site contributing nothing today needs no mention). Shortlist the strongest stories by the criteria above and capture each one's exact final URL. Skip any whose stable URL you cannot recover. Do not summarize yet.
2. **Dedup the candidates now, before writing anything.** Write the candidate URLs (one per line) to a temp file, e.g. `/tmp/mr-candidates.txt`, and run:
   `node .opencode/skills/morning-report/scripts/dedup-check.mjs /tmp/mr-candidates.txt`
   It reads the ground-truth bodies of your last runs straight from the report-history DB (not from `<prior_runs>`) and prints any candidate URL you already published. **Drop every flagged URL.** The script only catches exact URL reuse, so also drop, by judgment, any candidate that is the same story under a different URL or the same information restated by another outlet.
3. **Paywall/truncation gate on the survivors — verify before you write, do not trust the lede.** A page that opens (HTTP 200) with a few opening paragraphs is NOT proof you have the full text. For each surviving candidate, run the web-access skill's 付费墙与截断内容 step — that includes loading the target site's `references/site-patterns/{domain}.md` and applying its paywall test — and confirm the body is actually complete. Drop any gated or truncated article (never write it up from partial content) and backfill from your remaining candidates, re-running step 2's dedup check on anything you add. (Skipping this check is exactly what put truncated paywall pieces into past reports.)
4. **Finalize the 3–4** strongest of what survives, across all sites combined. Fewer than 3 is fine on a genuinely quiet day; do NOT force a section, a "今天无新增" line, or a filler pick just to hit a number or represent a site.
5. **Summarize each** finalized article through the `summarization` skill's analytical lens (already loaded) — full analyst treatment at the depth and length that skill intends, not a headline blurb.

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

The report is a news briefing and nothing else — Round 1 news plus, when warranted, the Round 2 portfolio section. Do not append anything after the news.

- Reply in Chinese (简体) per project rules; keep English titles, product names, tickers, and code identifiers in the original.
- Present the 3–4 selected Round 1 articles, each as:
  - the exact article title
  - one standalone line containing only the article URL (no quotes, backticks, or angle brackets; one link per line)
  - the analytical summary below that title/link pair
- Group by site only where it reads naturally; do not add empty or "今天无新增" sections for sites you didn't pick from.
- Do not batch multiple article links onto one line. Do not invent, reconstruct, or hand-edit URLs.
- Keep the portfolio section (Round 2) separate from the news section.

## Scheduling

This report fits the scheduler. If the user asks to receive it on a cadence (e.g. "every weekday morning at 8am"), use `schedule_create` with `kind='cron'` and a `prompt` like `"produce the morning report"` so a fresh run fires on schedule.

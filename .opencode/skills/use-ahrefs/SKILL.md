---
name: use-ahrefs
description: Get SEO data for any provided website or keyword on Ahrefs. 
---

## Prerequisite

Load `web-access` first

## How to run a tool (important — the `input` URL param does NOT auto-run)

Ahrefs **strips `&input={...}` on load** and lands you on the bare `?country=us` page with an empty form. Navigating to the URL alone never produces a result — that's why a result block "never surfaces". You must drive the form:

1. Open the tool URL (the `&input=` part is harmless but ignored; expect to land on the empty form).
2. Fill the keyword/domain box (`input[type=text]`, placeholder `Enter keyword`) by setting its value via the native setter + dispatching `input`/`change` events.
3. Click the submit button (`Check keyword` / `Find keywords` / the backlink-checker equivalent).
4. **Wait ~10–20s** for the async result block, then read it (see per-tool anchors below). Results load far down the DOM — never conclude `No data` from an early `innerText.slice(0, N)`.

Transient `502 Bad gateway` on first load happens — just `navigate` to the bare tool URL again and proceed.

## Keyword Difficulty Checker

`https://ahrefs.com/keyword-difficulty/?country=us&input={keyword}`

- Can collect: `KD`, difficulty label, estimated `RD needed` to reach Top 10, and SERP overview competitiveness hints
- Important: do not judge success or failure from `document.body.innerText.slice(0, N)` or other early-page snippets. On Ahrefs keyword difficulty pages, the actual result block may appear far down in the DOM and load asynchronously.
- Prefer reading the full text or at least the tail, and extract around stable phrases like `Keyword Difficulty for` and `We estimate that you'll need followed backlinks from` before concluding `No data`.

## Keyword Generator

`https://ahrefs.com/keyword-generator/?country=us&input={keyword}`

- Can collect: keyword `Volume` bucket (by country), related keyword ideas, and term variants from the same seed
- Result anchor: read around `Keyword ideas for`. Free tier shows **bucketed volume** (`>100` / `<100`), not exact numbers, and KD as a label (`Easy` / `N/A`) — that's a tier limit, not a failure.

## Backlink Checker

`https://ahrefs.com/backlink-checker/?input={domain}`

- Can collect: domain-level backlink profile summary (backlinks/referring domains) and authority-level snapshot

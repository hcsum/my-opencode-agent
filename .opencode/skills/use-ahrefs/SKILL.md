---
name: use-ahrefs
description: Get SEO data for any provided website or keyword on Ahrefs. 
---

## Prerequisite

Load `web-access` first

## Keyword Difficulty Checker

`https://ahrefs.com/keyword-difficulty/?country=us&input={keyword}`

- Can collect: `KD`, difficulty label, estimated `RD needed` to reach Top 10, and SERP overview competitiveness hints
- Important: do not judge success or failure from `document.body.innerText.slice(0, N)` or other early-page snippets. On Ahrefs keyword difficulty pages, the actual result block may appear far down in the DOM and load asynchronously.
- Prefer reading the full text or at least the tail, and extract around stable phrases like `Keyword Difficulty for` and `We estimate that you'll need followed backlinks from` before concluding `No data`.

## Keyword Generator

`https://ahrefs.com/keyword-generator/?country=us&input={keyword}`

- Can collect: keyword `Volume` bucket (by country), related keyword ideas, and term variants from the same seed

## Backlink Checker

`https://ahrefs.com/backlink-checker/?input={domain}`

- Can collect: domain-level backlink profile summary (backlinks/referring domains) and authority-level snapshot

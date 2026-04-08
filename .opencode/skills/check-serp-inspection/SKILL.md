---
name: check-serp-inspection
description: Inspect live search results to judge SEO competition, SERP weakness, and whether a keyword is realistically beatable.
---

# Check SERP Inspection

Use this skill when the task requires judging whether a keyword is actually worth targeting based on the live search results page, not just trend or community signals.

This skill is about deciding whether a solo founder can win.

## Required browsing mode

All SERP inspection must go through the `web-access` skill.

- Load `web-access` first.
- Use the local browser CDP proxy through `curl` calls to `http://127.0.0.1:3456`.
- Operate in your own background tab.
- Close tabs you created after the inspection is complete.

Do not use generic assumptions about what ranks. Look at the real SERP.

## Core goals

For each keyword, determine:

- what search intent Google is rewarding
- what kinds of pages are ranking
- whether the top results are strong or weak
- whether a solo founder could ship something better or more focused
- what kind of site or page would have the best chance to compete

## Default workflow

1. Open the SERP in the browser
   - Use Google search results for the exact keyword.
   - If the user specifies a locale, respect it. Otherwise use the default visible locale.

2. Read the page shape first
   - Identify whether the SERP is dominated by:
     - tools
     - listicles
     - big brands
     - forums
     - videos
     - directories
     - docs
     - ecommerce pages
   - Note special SERP features if visible: featured snippets, PAA, video blocks, image packs, maps, shopping, app packs.

3. Inspect the top results
   - Review at least the first 5 organic-style results when possible.
   - For the strongest-looking candidates, open the result pages in background tabs and inspect them.
   - Look for weaknesses such as:
     - outdated content
     - thin content
     - weak UX
     - generic AI-style copy
     - intent mismatch
     - poor page speed or cluttered ads
     - no free tool where users clearly want one
     - weak topical depth

4. Judge competition reality
   - If the SERP is dominated by giant trusted brands with strong matching pages, say it is hard.
   - If the SERP has many mediocre pages, low-focus listicles, weak UIs, stale directories, or forum threads, call out the opening clearly.
   - Distinguish between:
     - beatable now
     - only beatable with a niche angle
     - not worth targeting now

5. Recommend the attack angle
   - Explain what should be built to compete:
     - a better tool
     - a more focused landing page
     - a template library
     - a comparison page
     - a directory
     - a programmatic cluster
     - a content hub
   - State the first page or MVP to ship.

## What to capture

When reporting back, try to include:

- keyword
- dominant intent
- top result patterns
- notable SERP features
- weaknesses in current results
- solo-founder opportunity assessment
- recommended page or site type
- verdict: beatable / niche-only / avoid

## Heuristics

Signs the keyword may be attractive:

- forums or UGC rank highly because nobody built a strong dedicated page
- listicles rank but do not satisfy the exact task intent
- the top tools are old, ugly, slow, or limited
- searchers likely want a utility, generator, checker, template, or calculator and the current results do not deliver well
- the SERP mixes very different intents, which may allow a more focused page to win

Signs the keyword may be unattractive:

- multiple top results are dominant brands with excellent exact-match pages
- the SERP is crowded with strong programmatic sites that already cover the long tail deeply
- the query clearly needs authority, trust, or data a solo founder cannot credibly provide
- Google is rewarding a page format the user is unlikely to build well

## Using web-access well

- Start by loading `web-access` and follow its instructions.
- Create a background tab for the SERP with `curl -s "http://127.0.0.1:3456/new?url=..."`.
- Use `/eval` style calls to inspect visible results, titles, snippets, and links.
- Open promising results in separate background tabs for closer inspection.
- Prefer direct page inspection over assumptions.
- Keep the browsing minimal but sufficient to support a decision.

## Avoid

- judging a keyword from trends alone
- treating brand presence as automatic impossibility without reading the pages
- calling a keyword easy without inspecting live results
- inspecting only one result and overgeneralizing
- forgetting to explain what exact page should be built

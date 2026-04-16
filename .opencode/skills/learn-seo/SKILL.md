---
name: learn-seo
description: Visit https://web.cafe to learn indie developer growth methodology from experienced practitioners sharing real-world insights on promotion, niche discovery, market research, and mindset.
---

# Learn from Web.Cafe

## Access

Use the `use-webcafe` skill to browse Web.Cafe content (search, open, read).

## What to extract

First respect `## What I care about` at the top of `notes/webcafe.md`.

Then read `## What to Learn Next`, which appears near the top of the notes and should be treated as the session queue.

- Use it as the scope filter for this session
- If a page is mostly out of scope, skip it. If it mixes high- and low-priority material, keep only the useful parts.
- Prefer learning items listed in `## What to Learn Next` before exploring new gaps.
- If `## What to Learn Next` is empty, choose the highest-value in-scope gaps from `## What I care about`, learn those first, and initialize `## What to Learn Next` after the session.

For each case study or discussion, capture the underlying methodology, not the surface details:

- **Promotion** — how did they drive traffic? What channels, tactics, or strategies did they use?
- **Niche discovery** — how did they find or come up with their niche? What was their thought process?
- **Market research** — what tools and methods did they use to validate demand? How did they assess competition?
- **Methodology and mindset** — what principles or frameworks guide their decisions? How do they think about risk, time investment, and tradeoffs?

## Learning Goal

Understand how experienced indie founders approach building and growing websites — their processes, tools, and mental models. Extract transferable insights about promotion channels, niche selection, market validation, and the mindset required for solo projects. Do not look for specific keywords or traffic numbers — those are symptoms, not causes.

## Working style

1. **Before starting**: Read `notes/webcafe.md` thoroughly, including `## What I care about` and `## What to Learn Next` near the top. Use `What I care about` to decide what is in scope, and use `What to Learn Next` to decide what to study first in this session.
2. **Explore and read**: Always start with `search`. Use `open` to get the URL, then `read` to extract the body. Follow the `What I care about` scope filter. If a page has little text but video, skip it.
3. **Script handles cleanup**: The browse script automatically closes all tabs in its finally block.
4. **If script fails, stop immediately.** Do not fall back to other access methods.
5. **After learning**: Update `## What to Learn Next` in `notes/webcafe.md` by removing items that were actually covered this session and appending newly discovered follow-up questions worth learning next.

## Avoid

- using WebFetch, CDP tools, or any method other than the browse script
- treating one post as proof of a winning strategy
- copying founder claims without extracting the underlying approach or reasoning
- **returning article titles as findings** — titles are not findings
- **surface-level summaries** — always ask "what is this person actually doing and why?"
- looking for specific keywords — focus on how niches are found and validated, not what the keywords are
- relying on a single page when broader evidence is available
- spending session time on topics that `## What I care about` says the user does not care about

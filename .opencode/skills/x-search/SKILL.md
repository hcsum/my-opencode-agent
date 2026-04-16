---
name: x-search
description: Search X posts by query, hashtag, cashtag, or account-related term. Use for trend discovery, sentiment checks, and topic monitoring.
---

# X Search

Use the local X search script when the user wants to find what people are saying on X about a specific topic, brand, product, or person.

## Prerequisite

If browser access is not already ready, load `web-access` first and run:

```bash
bash .opencode/skills/web-access/scripts/check-deps.sh
```

## Command

Run:

```bash
printf '%s' '{"query":"<query>","limit":20}' | npx tsx .opencode/skills/x-search/scripts/search.ts
```

- Replace `<query>` with a short search term.
- The script returns JSON with `success`, `message`, and optional `data`.
- If the proxy is unavailable, get `web-access` ready first, then retry.

## Search workflow

1. Start short
   - Begin with a short query, usually 1-3 words.
   - Prefer the core topic, brand name, product name, hashtag, or person name first.
   - Do not start with a long sentence-like query unless the user explicitly asks for a very specific search.

2. Iterate intentionally
   - If results are too broad, narrow with one modifier at a time.
   - If results are too narrow or empty, broaden, simplify, or rewrite the query.
   - If a query fails, alter it and try again instead of stopping.
   - Use multiple search rounds whenever needed until the user's request is actually satisfied.

3. Escalate from broad to specific
   - Good progression: `cursor` -> `cursor ai` -> `cursor ai pricing`.
   - Try close variants, abbreviations, alternate wording, product aliases, and common misspellings.
   - If useful, shift between topic words, company names, hashtags, and user handles.

4. Stop when signal is sufficient
   - Do not keep searching once the answer is clear.
   - Do enough rounds to cover the topic well, but avoid redundant searches.

## Output expectations

When reporting back, prefer a concise synthesis with:

- what you searched
- the strongest themes you found
- notable sentiment or disagreement
- recurring language or framing
- your interpretation of what matters most
- any limitations, such as weak signal or mixed results
- citations to specific posts or accounts when relevant

If the user wants examples, include a few representative posts or accounts, but keep the focus on analysis rather than raw listing.

## Response shaping

- Prefer 3-6 compressed sections or buckets instead of long enumerations.
- Group overlapping posts under one conclusion instead of repeating the same point post by post.
- Default to quality tiers when useful: `一手消息，最推荐`、`二手消息但有见解，可看`、`纯搬运/低洞见，低推荐`.
- Keep low-signal content short; spend most of the space on the highest-signal posts and conclusions.

## Avoid

- starting with long over-specified queries
- giving up after one failed search
- dumping a long list of posts with no synthesis
- treating a few loud posts as broad consensus
- confusing engagement bait with meaningful signal
- repeating the same takeaway in multiple sections
- expanding weak or hype-heavy posts just to make the answer feel complete

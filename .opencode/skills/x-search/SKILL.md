---
name: x-search
description: Search X posts by query, hashtag, cashtag, or account-related term. Use for trend discovery, sentiment checks, and topic monitoring.
---

# X Search

Use the local X search script when the user wants to find what people are saying on X about a specific topic, brand, product, or person.

## Prerequisite

If browser access is not already ready, load `web-access` from current repo

## Command

Run:

```bash
printf '%s' '{"query":"<query>","limit":20}' | npx tsx .opencode/skills/x-search/scripts/search.ts
```

- Replace `<query>` with a short search term.
- The script returns JSON with `success`, `message`, and optional `data`.
- If the proxy is unavailable, get `web-access` ready first, then retry.

## Search workflow

Apply the core search-query discipline — start broad and add modifiers one at a time, rewrite weak/empty/off-target queries instead of stopping (try aliases, abbreviations, alternate wording, common misspellings; do multiple rounds), and stop once the answer is clear — then layer these X-specific rules:

1. Prefer X-native query forms when useful
   - Shift between topic words, company names, hashtags, cashtags, and user handles.
   - Use the shortest X-native form that is likely to surface the right conversation.

2. Prioritize signal, not just matches
   - Prefer posts with meaningful engagement when choosing what to cite or trust most.
   - Treat likes, reposts, replies, and quote-post discussion as rough signal, not proof.
   - If the strongest-looking matches have very low engagement, say so explicitly and lower confidence.
   - Do not draw broad conclusions from a handful of low-engagement posts unless the user asked for niche or early signal.

3. Filter out garbage and duplicates
   - Watch for near-duplicate posts, copy-paste summaries, and engagement-farming threads.
   - If many posts are 80% identical, treat them as one repeated claim, not independent confirmation.
   - Prefer original posts, firsthand examples, or replies with concrete reasoning over reposted framing.
   - Call out when the result set is mostly derivative or low-insight.

## Output expectations

When reporting back, prefer a concise synthesis with:

- what you searched
- whether the result set had strong engagement or weak signal
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
- Default to quality tiers when useful: `firsthand, highest value`, `secondhand but insightful, worth reading`, `repackaged or low-insight, low priority`.
- Keep low-signal content short; spend most of the space on the highest-signal posts and conclusions.
- When engagement is weak or the corpus is repetitive, say that early instead of overstating certainty.

## Avoid

- starting with long over-specified queries
- giving up after one failed search
- dumping a long list of posts with no synthesis
- treating a few loud posts as broad consensus
- treating a few low-engagement posts as strong evidence
- confusing engagement bait with meaningful signal
- counting many near-identical posts as multiple independent signals
- repeating the same takeaway in multiple sections
- expanding weak or hype-heavy posts just to make the answer feel complete

---
name: x-home-feed
description: Read and summarize your X home feed for trends, themes, sentiment, and signal detection.
---

# X Home Feed

Use this when the user wants to inspect or summarize what is showing up in their X home feed.

## Prerequisite

If browser access is not already ready, load `web-access` first

## Command

Run:

```bash
printf '%s' '{"limit":30}' | npx tsx .opencode/skills/x-home-feed/scripts/read-home.ts
```

- The script returns JSON with `success`, `message`, and optional `data`.
- If the proxy is unavailable, get `web-access` ready first, then retry.

## How to summarize the home feed

- Quote the most representative posts when they add value
- Look for clusters of similar posts, themes, or conversations that indicate a strong signal
- Each item should reflect a distinct theme, topic, or signal that is genuinely present in the feed, not just a random assortment of posts
- State what looks like real signal vs noise
- what people seem excited about, worried about, or arguing about
- Prefer 4-6 items total, with the most important ones first
- When you mention a representative post or account, include the original post URL.
- Prefer 1st hand information, such as authers posting about their own work, users sharing their direct experiences, or original content from creators, over hypes, rumors, or second-hand news. 
- Cover enough breadth to reflect the actual feed. It is fine to include several distinct themes if they are genuinely present.

## Avoid

- dumping a long list of posts with no synthesis
- over-optimizing for brevity when the feed clearly has multiple important threads
- creating too many section headers or turning the answer into a rigid newsletter template
- confusing engagement bait with meaningful signal

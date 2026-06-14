---
name: x-home-feed
description: Read and summarize user's X (formerly Twitter) home feed
---

## Prerequisite

If browser access is not already ready, load `web-access` first

## When browser is unavailable

If `check-deps.mjs` returns `ok: false` or `proxyReady: false` (e.g. `reason: "proxy_connect_timeout"`):

- **Stop immediately. Do not read logs, debug, or retry.**
- Reply to the user: "I couldn't access the browser to fetch your X feed. The browser proxy failed to start — please try again later."
- Do not attempt any further tool calls.

## Command

Run:

```bash
printf '%s' '{"limit":30}' | npx tsx .opencode/skills/x-home-feed/scripts/read-home.ts
```

- The script returns JSON with `success`, `message`, and optional `data`.
- The scan reads the **Following** tab (not "For you"): it switches to Following before scanning.

## How to summarize the home feed

### Do
- look for useful topics, such as new features, popular discussions, or emerging trends
- look for what people seem excited about, worried about, or arguing about
- quote the most representative posts of the current feed if applicable
- If the feed posts form certain themes or clusters, organize the summary around those themes instead of just listing posts one by one
- When you mention a representative post or account, include the original post URL.
- If nothing interesting is found in the feed, it is ok. Don't force to find or claim something is interesting.

### Avoid
- shallow claims or opinions that are not supported by the post content
- 2nd hand information that is not directly evident from the feed, such as "people are excited about X" without showing any posts that demonstrate that excitement



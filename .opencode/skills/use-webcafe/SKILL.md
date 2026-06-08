---
name: use-webcafe
description: Use when user need to search or read content on Web.Cafe, including group messages. This skill provides a structured way to interact with Web.Cafe's search and messaging features. If the user needs to read a specific article, use `web-access` skill instead and follow the guidelines for extracting text and images.
---

# Use Web.Cafe Browse Tools

## Access Rule

Use this skill only for Web.Cafe-specific shortcut flows like `search` and `messages`.
For reading a known article URL or extracting article images/content, use `web-access` directly and follow these:

1. First extract the main article text.
2. Then extract all image URLs from the article body.
3. If an image is large enough, or the body mentions cues like `见图` or `如下图`, continue and read the image content.
4. If image reading fails, report the concrete failure reason instead of silently skipping.

## Browsing Script

```bash
# Search — returns list of results with title, url, preview, index
printf '%s' '{"action":"search","query":"外链"}' | npx tsx .opencode/skills/use-webcafe/scripts/browse.ts

# Open result N (0-indexed) — always returns success, use the returned URL with read action
printf '%s' '{"action":"open","query":"外链","index":1}' | npx tsx .opencode/skills/use-webcafe/scripts/browse.ts

# Search messages in default group 7; if no exact matches, return loaded chat context for summary
printf '%s' '{"action":"messages","query":"haochen"}' | npx tsx .opencode/skills/use-webcafe/scripts/browse.ts

# Search messages in a specific group with up to 5 history loads
printf '%s' '{"action":"messages","query":"外链","group":"哥飞的朋友们 7 群","maxLoads":5}' | npx tsx .opencode/skills/use-webcafe/scripts/browse.ts
```

**Search is the primary navigation**: Always search first. Web.Cafe search covers all content. Search uses Simplified Chinese unless the word is in English in Chinese context (e.g. "SEO", "Adsense").

## Browser: always dedicated

`browse.ts` always runs on the **dedicated browser**, never the user's main browser. Before any tab work it runs `scripts/ensure-dedicated.mjs`, which launches the dedicated browser if needed and re-points the shared CDP proxy (`localhost:3456`) at it — even if `web-access` last switched the proxy to the primary browser. No manual setup is needed each run.

- The dedicated browser is auto-detected from `~/.web-access/<id>-dedicated-profile` (prefers `brave` when several exist).
- To force a specific browser, set `WEBCAFE_BROWSER_ID` to one of `chrome | chrome-canary | chromium | brave | edge | arc`.
- If no dedicated profile exists yet, the script fails with guidance; set one up via the `web-access` skill first (it logs into Web.Cafe in that isolated profile).
- Because the proxy is a global singleton, running this skill re-points it to dedicated. If you next need `web-access` on the primary browser, switch it back with `--browser primary`.

## How to search group messages

1. Use `messages` with a query string
2. The script opens `https://new.web.cafe/messages`
3. It selects `哥飞的朋友们 7 群` by default unless you pass `group`
4. It enters the query into `搜索消息/昵称`
5. It scrolls and loads more history up to `maxLoads` times (default 5)
6. If no exact matches are found, it returns loaded chat messages so you can summarize what was discussed


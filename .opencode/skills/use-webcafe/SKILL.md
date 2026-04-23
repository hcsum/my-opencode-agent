---
name: use-webcafe
description: Use the browse script to search, open, and read articles on Web.Cafe (https://new.web.cafe). Provides search, open, and read actions via a CLI script that handles CDP tab lifecycle automatically.
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

## How to search group messages

1. Use `messages` with a query string
2. The script opens `https://new.web.cafe/messages`
3. It selects `哥飞的朋友们 7 群` by default unless you pass `group`
4. It enters the query into `搜索消息/昵称`
5. It scrolls and loads more history up to `maxLoads` times (default 5)
6. If no exact matches are found, it returns loaded chat messages so you can summarize what was discussed

## Script Lifecycle

- The browse script automatically opens a background tab, performs the action, and closes the tab in its finally block
- No manual tab cleanup is needed
- This skill only supports `search`, `open`, and `messages`
- Use `web-access` when you need to read article正文、图片或处理页面异常

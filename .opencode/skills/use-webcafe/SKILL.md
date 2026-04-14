---
name: use-webcafe
description: Use the browse script to search, open, and read articles on Web.Cafe (https://new.web.cafe). Provides search, open, and read actions via a CLI script that handles CDP tab lifecycle automatically.
---

# Use Web.Cafe Browse Tools

## Strict Access Rule

**Only use the browse script.** Do NOT use WebFetch, CDP tools, or any other access method. If the script fails, stop immediately.

## Prerequisites

```bash
bash .opencode/skills/web-access/scripts/check-deps.sh
```

## Browsing Script

```bash
# Search — returns list of results with title, url, preview, index
printf '%s' '{"action":"search","query":"外链"}' | npx tsx .opencode/skills/use-webcafe/scripts/browse.ts

# Open result N (0-indexed) — always returns success, use the returned URL with read action
printf '%s' '{"action":"open","query":"外链","index":1}' | npx tsx .opencode/skills/use-webcafe/scripts/browse.ts

# Read article by URL
printf '%s' '{"action":"read","url":"https://new.web.cafe/topic/xxx"}' | npx tsx .opencode/skills/use-webcafe/scripts/browse.ts

# Search messages in default group 7; if no exact matches, return loaded chat context for summary
printf '%s' '{"action":"messages","query":"haochen"}' | npx tsx .opencode/skills/use-webcafe/scripts/browse.ts

# Search messages in a specific group with up to 5 history loads
printf '%s' '{"action":"messages","query":"外链","group":"哥飞的朋友们 7 群","maxLoads":5}' | npx tsx .opencode/skills/use-webcafe/scripts/browse.ts
```

**Search is the primary navigation**: Always search first. Web.Cafe search covers all content. Search uses Simplified Chinese (e.g. "外链", "挖掘需求", "SEO").

## How to read an article

1. `search` — find the article by keyword, note its index
2. `open` with the index — returns the article URL
3. `read` with the URL

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
- If the script fails, stop immediately. Do not fall back to other access methods.

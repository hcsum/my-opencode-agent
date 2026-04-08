---
name: learn-web-cafe
description: Visit https://web.cafe to learn indie developer growth methodology from experienced practitioners sharing real-world insights on promotion, niche discovery, market research, and mindset.
---

# Learn from Web.Cafe

Use the `web-access` skill to explore and learn from the community.

## Required Browsing Mode

All Web.Cafe browsing should go through `web-access`.

- Load `web-access` first.
- Use the local browser CDP proxy through `curl` calls to `http://127.0.0.1:3456`.
- Operate in your own background tab.
- Track every `targetId` you create.
- Close every tab you created after the work is complete, including tabs opened speculatively and never used.
- Prefer reusing an existing working tab instead of opening a new one unless parallel reading is actually useful.

## Web.Cafe Playbook

Web.Cafe is a UI-first site. Some entries have no useful `href` in the DOM. The safe rule is: discover pages from the rendered UI, not from guessed URLs.

### Hard Rules

- Never invent URLs from title, author, slug, or guessed patterns like `/post/...` or `/topic/...`.
- Never treat a guessed-URL `404` as evidence that the content does not exist.
- Never say "cannot navigate" until you have checked both `/targets` and `/info` after the click.
- Never use `webfetch` as the main fallback for logged-in or client-rendered Web.Cafe content.
- If `/eval` is broken, say `/eval` is broken. Do not say Web.Cafe is broken.

### Success Criteria

A click is successful if either of these happens:

1. `/info` for the current tab changes to the target page.
2. `/targets` shows a new Web.Cafe detail tab opened by the source tab.

If the source tab URL does not change, that does not mean the click failed.

### Exact Workflow

1. Open or reuse one working tab on `https://new.web.cafe/`.
2. Record the current target list with `/targets`.
3. Inspect the page.
4. If the page has real article links, use those exact discovered links.
5. If the page only has clickable rendered titles, click the title node itself, not the article body, not the whole card, and not adjacent action buttons.
6. After every click, always do both checks:
   - `/targets`
   - `/info?target=<source-tab>`
7. If a new tab opened, switch work to that new target.
8. Close tabs you no longer need.

### Preferred Click Order

When a listing item is rendered like title + excerpt + bookmark button, use this order:

1. title node
2. title wrapper on the left side
3. native `element.click()` on the title node

Do not click:

- the excerpt/body text
- the full card body
- bookmark, star, collect, or menu buttons

### Exact `/eval` Pattern

Use short, simple JS. Do not use long exploratory scripts when a small selector pass will do.

`/eval` body must be the raw JavaScript expression or IIFE. Do not wrap it in an extra string literal.

- Correct: `document.body.innerText.slice(0, 2000)`
- Wrong: `"document.body.innerText.slice(0, 2000)"`

If `/eval` returns the exact source text you sent, first check whether you accidentally wrapped the body in quotes.

### Element Tagging for Clicking

When a title node cannot be clicked directly (e.g., its `onclick` is empty or the link is JS-rendered), use the `#nc-target` tagging pattern:

```javascript
(() => {
  const el = Array.from(document.querySelectorAll('p, h2, h3, a, span')).find(
    (node) => (node.textContent || '').trim() === 'Exact title text here',
  );
  if (!el) return JSON.stringify({ found: false });
  el.id = 'nc-target';
  el.scrollIntoView({ block: 'center' });
  return JSON.stringify({
    found: true,
    tag: el.tagName,
    text: (el.textContent || '').trim(),
  });
})();
```

Then use `/clickAt` on `#nc-target` to click the tagged element.

### Minimal Rescue Path

If stuck, follow this exact sequence:

1. `GET /targets`
2. `GET /navigate?target=<tab>&url=https://new.web.cafe/`
3. `POST /eval` to tag one exact title node as `#nc-target`
4. `POST /clickAt` on `#nc-target`
5. `GET /targets`
6. `GET /info?target=<original-tab>`
7. If a new detail tab exists, continue there
8. If not, retry once with `element.click()` on the title node

### What Not To Misdiagnose

- `/eval` echoing input: tool problem
- source tab unchanged but new tab exists: successful navigation
- `WebFetch` missing article body: expected for this site, not proof of access failure
- `click` returning 0 elements: element not visible, try `/eval` tagging pattern instead

### Exact Verification Pattern

Always use this sequence after clicking:

1. `GET /targets`
2. `GET /info?target=<source-tab>`

Interpretation:

- New Web.Cafe detail tab present: success
- Source tab URL changed to detail page: success
- Neither changed: retry with a more precise target

### If `/eval` Is Broken

If `/eval` returns the literal JS you sent, or just echoes the request body:

1. Mark `/eval` as unreliable in this runtime.
2. Continue using `/click`, `/clickAt`, `/targets`, `/info`, `/navigate`, `/back`.
3. Verify navigation only through tab creation and URL changes.
4. Do not pivot to guessed URLs.
5. Do not pivot to `webfetch` for post bodies.

## What to Extract

First respect `## User Preference` at the top of `notes/webcafe.md`.

- Use it as the scope filter for this session: it decides what to research, what to keep, and what to cut.
- Treat items marked as not important or not important for now as out of scope unless they are necessary context for a preferred topic.
- If a page is mostly out of scope, skip it. If it mixes high- and low-priority material, keep only the useful parts.

For each case study or discussion, capture the underlying methodology, not the surface details:

- Promotion: how did they drive traffic?
- Niche discovery: how did they find or come up with their niche?
- Market research: what tools and methods did they use to validate demand?
- Methodology and mindset: what principles or frameworks guide their decisions?

## Learning Goal

Understand how experienced indie founders approach building and growing websites. Extract transferable insights about promotion channels, niche selection, market validation, and solo-founder mindset.

## Working Style

1. **Before starting**: Read `notes/webcafe.md` thoroughly, including `## User Preference` at the top. Use that section to decide what is in scope this session, what to deprioritize, and which gaps are actually worth exploring.
2. **Explore and read**: Use `web-access` to discover and read relevant content. Start broad from the home page, `/experiences`, or `/tutorials`, then narrow down to specific pages by clicking through the rendered UI. Follow the `User Preference` scope filter while choosing pages and extracting findings. If a page has little text content but video, skip it.
3. **Write findings**: Write durable findings into `notes/webcafe.md` as you go.
4. **Cleanup**: Before finishing, close every `targetId` created during the session. Do not leave behind idle search tabs, 404 tabs, or speculative tabs that are no longer needed.
5. **Complete**: Before declaring the session complete, invoke `refine-web-cafe-notes`.

## About web.cafe

- `https://new.web.cafe`
- `https://new.web.cafe/experiences`
- `https://new.web.cafe/tutorials`
- The site search uses Simplified Chinese, so search in Chinese unless the term is widely known in English

## Completion Checklist

Before declaring the session complete:

- [ ] Invoked `refine-web-cafe-notes` to fully refine and distill the notes
- [ ] Closed all browser tabs created during the session

## Avoid

- treating one post as proof of a winning strategy
- copying founder claims without extracting the underlying approach or reasoning
- returning article titles as findings
- surface-level summaries
- looking for specific keywords instead of how niches are found and validated
- relying on a single page when broader evidence is available
- leaving behind browser tabs created during the session

# Manual Debugging

Only use this reference when the bundled helper script needs debugging, or when Google Trends / CDP behavior changed and you need to inspect the low-level flow.

## Purpose

- Verify page-side `fetch` still works inside a `trends.google.com` page context.
- Inspect the current `/eval` wrapper shape from `web-access`.
- Reproduce widget calls manually when the helper script needs investigation.
- Debug cases where the website UI and the raw API data disagree.

## Reference snippet

```js
const evalHeaders = { 'Content-Type': 'text/plain' }

function parseEvalResponse(text) {
  return JSON.parse(text).value
}

function parseTrendsResponse(text) {
  if (typeof text !== 'string') {
    throw new Error(`Expected string response, got ${typeof text}`)
  }

  if (text.startsWith('<html')) {
    throw new Error('Google Trends returned HTML instead of JSON, likely rate limiting or blocking')
  }

  const jsonText = text.startsWith(")]}'")
    ? text.slice(text.indexOf('\n') + 1)
    : text

  return JSON.parse(jsonText)
}

async function evalInPage(baseUrl, target, expr) {
  const raw = await fetch(`${baseUrl}/eval?target=${target}`, {
    method: 'POST',
    headers: evalHeaders,
    body: expr,
  }).then((r) => r.text())

  return parseEvalResponse(raw)
}

function getTargetId(created) {
  return created.id || created.targetId || created.target?.id || null
}

async function fetchWidget(baseUrl, target, widget, endpoint) {
  const url = `https://trends.google.com/trends/api/${endpoint}?hl=en-US&tz=-480&req=${encodeURIComponent(JSON.stringify(widget.request))}&token=${encodeURIComponent(widget.token)}`

  const result = await evalInPage(
    baseUrl,
    target,
    `fetch(${JSON.stringify(url)}, { credentials: 'include' }).then(async (r) => ({ status: r.status, text: await r.text() }))`
  )

  if (result.status >= 400) {
    throw new Error(`Google Trends widget request failed with status ${result.status}`)
  }

  return parseTrendsResponse(result.text)
}

function getTopRegions(geoResponse, limit = 10) {
  return (geoResponse?.default?.geoMapData || [])
    .map((item) => ({
      region: item.geoName,
      value: item.value?.[0] ?? 0,
    }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)
}
```

## Notes

- Prefer a heredoc-style `node <<'NODE' ... NODE` script over `node -e` during manual debugging.
- Read both `id` and `targetId` from CDP `/new` responses.
- Treat `GEO_MAP` as optional during debugging because it is more likely to hit `429`.
- Distinguish API debugging from page debugging:
- Page-side `fetch` to `explore` and `widgetdata/*` can work in a background `trends.google.com` tab.
- DOM inspection of rendered widgets, pagination, chart presence, and lazy-rendered sections is not reliable in a hidden or unfocused tab.
- If you need to debug what the website actually shows, use an active foreground tab and verify the rendered UI there instead of trusting a background tab DOM snapshot.

#!/usr/bin/env node

const DEFAULTS = {
  baseUrl: 'http://localhost:3456',
  hl: 'en-US',
  tz: '-480',
  time: 'today 12-m',
  geo: '',
  property: '',
  category: 0,
  includeGeo: true,
}

function parseArgs(argv) {
  const options = { ...DEFAULTS }
  const keywords = []

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]

    if (!arg.startsWith('--')) {
      keywords.push(arg)
      continue
    }

    const [flag, inlineValue] = arg.split('=', 2)
    const nextValue = inlineValue ?? argv[i + 1]

    switch (flag) {
      case '--keyword':
      case '--keywords': {
        if (inlineValue == null) i += 1
        for (const part of String(nextValue).split(',')) {
          const trimmed = part.trim()
          if (trimmed) keywords.push(trimmed)
        }
        break
      }
      case '--geo':
        options.geo = nextValue
        if (inlineValue == null) i += 1
        break
      case '--time':
        options.time = nextValue
        if (inlineValue == null) i += 1
        break
      case '--property':
        options.property = nextValue
        if (inlineValue == null) i += 1
        break
      case '--category':
        options.category = Number(nextValue)
        if (inlineValue == null) i += 1
        break
      case '--hl':
        options.hl = nextValue
        if (inlineValue == null) i += 1
        break
      case '--tz':
        options.tz = nextValue
        if (inlineValue == null) i += 1
        break
      case '--base-url':
        options.baseUrl = nextValue
        if (inlineValue == null) i += 1
        break
      case '--no-geo':
        options.includeGeo = false
        break
      case '--help':
        printHelp(0)
        break
      default:
        throw new Error(`Unknown argument: ${flag}`)
    }
  }

  if (keywords.length === 0) {
    throw new Error('At least one keyword is required. Example: node fetch-trends.mjs --keyword "ai girlfriend"')
  }

  if (keywords.length > 5) {
    throw new Error('Google Trends compare mode supports at most 5 keywords per request.')
  }

  return { keywords, options }
}

function printHelp(code) {
  console.log(`Usage: node fetch-trends.mjs [options] <keyword...>

Options:
  --keyword, --keywords  Keyword or comma-separated keywords
  --geo                  Region code, default worldwide
  --time                 Trends time range, default "today 12-m"
  --property             Search property, default web search
  --category             Category id, default 0
  --hl                   UI language, default en-US
  --tz                   Timezone offset minutes, default -480
  --base-url             CDP proxy base URL, default http://localhost:3456
  --no-geo               Skip GEO_MAP request
  --help                 Show this help
`)
  process.exit(code)
}

function parseEvalResponse(text) {
  return JSON.parse(text).value
}

function parseTrendsResponse(text) {
  if (typeof text !== 'string') {
    throw new Error(`Expected string response, got ${typeof text}`)
  }

  if (text.startsWith('<html')) {
    throw new Error('Google Trends returned HTML instead of JSON, likely rate limited or blocked')
  }

  const jsonText = text.startsWith(")]}'")
    ? text.slice(text.indexOf('\n') + 1)
    : text

  return JSON.parse(jsonText)
}

function getTargetId(created) {
  return created?.id || created?.targetId || created?.target?.id || created?.target?.targetId || null
}

async function requestText(url, options) {
  const response = await fetch(url, options)
  return response.text()
}

async function api(baseUrl, path, options) {
  return requestText(`${baseUrl}${path}`, options)
}

async function evalInPage(baseUrl, target, expr) {
  const raw = await api(baseUrl, `/eval?target=${encodeURIComponent(target)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: expr,
  })

  return parseEvalResponse(raw)
}

async function openTrendsTab(baseUrl) {
  const createdRaw = await api(baseUrl, `/new?url=${encodeURIComponent('https://trends.google.com/trends/')}`)
  const created = JSON.parse(createdRaw)
  const target = getTargetId(created)

  if (!target) {
    throw new Error(`Could not resolve target id from /new response: ${createdRaw}`)
  }

  return target
}

async function closeTab(baseUrl, target) {
  if (!target) return
  try {
    await api(baseUrl, `/close?target=${encodeURIComponent(target)}`)
  } catch {
    // Best effort cleanup only.
  }
}

async function fetchInPage(baseUrl, target, url) {
  const result = await evalInPage(
    baseUrl,
    target,
    `fetch(${JSON.stringify(url)}, { credentials: 'include' }).then(async (r) => ({ status: r.status, text: await r.text() }))`
  )

  if (typeof result?.status !== 'number') {
    throw new Error(`Unexpected page fetch result: ${JSON.stringify(result)}`)
  }

  return result
}

async function fetchWidget(baseUrl, target, widget, endpoint, hl, tz) {
  const url = `https://trends.google.com/trends/api/${endpoint}?hl=${encodeURIComponent(hl)}&tz=${encodeURIComponent(tz)}&req=${encodeURIComponent(JSON.stringify(widget.request))}&token=${encodeURIComponent(widget.token)}`
  const result = await fetchInPage(baseUrl, target, url)

  if (result.status >= 400) {
    throw new Error(`Google Trends ${endpoint} request failed with status ${result.status}`)
  }

  return parseTrendsResponse(result.text)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchWidgetWithRetry(baseUrl, target, widget, endpoint, hl, tz, maxAttempts = 3) {
  let lastError = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fetchWidget(baseUrl, target, widget, endpoint, hl, tz)
    } catch (error) {
      lastError = error
      const message = String(error.message || error)
      const retryable = message.includes('status 429') || message.includes('returned HTML')

      if (!retryable || attempt === maxAttempts) {
        throw error
      }

      await sleep(attempt * 1500)
    }
  }

  throw lastError
}

function average(values) {
  if (values.length === 0) return null
  const sum = values.reduce((total, value) => total + value, 0)
  return Math.round(sum / values.length)
}

function normalizeTimeline(timelineData, keywords) {
  const series = Object.fromEntries(keywords.map((keyword) => [keyword, []]))

  for (const point of timelineData || []) {
    for (let index = 0; index < keywords.length; index += 1) {
      series[keywords[index]].push({
        time: point.formattedTime,
        value: Number(point.value?.[index] ?? 0),
      })
    }
  }

  const averageInterest = {}
  const peakWeeks = {}

  for (const keyword of keywords) {
    const values = series[keyword].map((item) => item.value)
    averageInterest[keyword] = average(values)
    peakWeeks[keyword] = [...series[keyword]]
      .sort((a, b) => b.value - a.value)
      .slice(0, 5)
  }

  return { series, averageInterest, peakWeeks }
}

function normalizeRankedLists(relatedResponses = [], keywords = []) {
  return relatedResponses.map(({ keyword, rankedList = [] }, keywordIndex) => ({
    keyword: keyword ?? keywords[keywordIndex] ?? null,
    topCount: (rankedList[0]?.rankedKeyword || []).length,
    risingCount: (rankedList[1]?.rankedKeyword || []).length,
    lists: rankedList.map((list, index) => ({
      index,
      title: list.rankedListTitle || null,
      keywords: (list.rankedKeyword || []).map((item) => ({
        query: item.query,
        value: item.value ?? null,
        formattedValue: item.formattedValue ?? null,
        link: item.link ?? null,
        hasData: item.hasData ?? null,
      })),
    })),
  }))
}

function normalizeGeoMap(geoMapData = []) {
  return geoMapData
    .map((item) => ({
      region: item.geoName,
      value: Number(item.value?.[0] ?? 0),
    }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value)
}

async function main() {
  const { keywords, options } = parseArgs(process.argv.slice(2))
  const exploreRequest = {
    comparisonItem: keywords.map((keyword) => ({
      keyword,
      geo: options.geo,
      time: options.time,
    })),
    category: options.category,
    property: options.property,
  }

  let target = null

  try {
    target = await openTrendsTab(options.baseUrl)

    const exploreUrl = `https://trends.google.com/trends/api/explore?hl=${encodeURIComponent(options.hl)}&tz=${encodeURIComponent(options.tz)}&req=${encodeURIComponent(JSON.stringify(exploreRequest))}`
    const exploreResult = await fetchInPage(options.baseUrl, target, exploreUrl)

    if (exploreResult.status >= 400) {
      throw new Error(`Google Trends explore failed with status ${exploreResult.status}`)
    }

    const explore = parseTrendsResponse(exploreResult.text)
    const widgets = explore.widgets || []
    const timeseriesWidget = widgets.find((widget) => widget.id === 'TIMESERIES')
    const relatedWidgets = widgets.filter((widget) => widget.id === 'RELATED_QUERIES' || widget.id.startsWith('RELATED_QUERIES_'))
    const geoWidget = widgets.find((widget) => widget.id === 'GEO_MAP')

    let timeseries = null
    let relatedResponses = []
    let timeseriesError = null
    let relatedError = null

    if (timeseriesWidget) {
      try {
        timeseries = await fetchWidgetWithRetry(options.baseUrl, target, timeseriesWidget, 'widgetdata/multiline', options.hl, options.tz)
      } catch (error) {
        timeseriesError = String(error.message || error)
      }
    }

    if (relatedWidgets.length > 0) {
      const relatedErrors = []

      for (const [index, widget] of relatedWidgets.entries()) {
        try {
          const related = await fetchWidgetWithRetry(options.baseUrl, target, widget, 'widgetdata/relatedsearches', options.hl, options.tz)
          relatedResponses.push({
            keyword: keywords[index] ?? null,
            rankedList: related?.default?.rankedList || [],
          })
          await sleep(500)
        } catch (error) {
          relatedErrors.push(`${keywords[index] ?? widget.id}: ${String(error.message || error)}`)
        }
      }

      if (relatedErrors.length > 0) {
        relatedError = relatedErrors.join('; ')
      }
    }

    let geo = null
    let geoError = null

    if (options.includeGeo && geoWidget) {
      try {
        geo = await fetchWidget(options.baseUrl, target, geoWidget, 'widgetdata/comparedgeo', options.hl, options.tz)
      } catch (error) {
        geoError = String(error.message || error)
      }
    }

    if (!timeseries && relatedResponses.length === 0) {
      throw new Error(`Google Trends did not return usable data. timeseriesError=${timeseriesError || 'none'} relatedError=${relatedError || 'none'}`)
    }

    const timeline = normalizeTimeline(timeseries?.default?.timelineData, keywords)
    const relatedLists = normalizeRankedLists(relatedResponses, keywords)
    const topRegions = normalizeGeoMap(geo?.default?.geoMapData).slice(0, 10)

    console.log(JSON.stringify({
      keywords,
      settings: {
        region: options.geo || 'Worldwide',
        timeRange: options.time,
        property: options.property || 'Web Search',
        category: options.category,
        hl: options.hl,
        tz: options.tz,
      },
      averageInterest: timeline.averageInterest,
      peakWeeks: timeline.peakWeeks,
      timeline: timeline.series,
      relatedQueries: relatedLists,
      timeseriesError,
      relatedError,
      topRegions,
      geoError,
    }, null, 2))
  } finally {
    await closeTab(options.baseUrl, target)
  }
}

main().catch((error) => {
  console.error(error.message || error)
  process.exit(1)
})

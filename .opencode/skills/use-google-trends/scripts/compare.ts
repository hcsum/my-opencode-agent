#!/usr/bin/env npx tsx

import {
  closeBackgroundTab,
  evalInTab,
  scrollTab,
  callProxy,
  runScript,
  type ScriptResult,
} from "../../x-search/lib/browser.js";

interface CompareInput {
  keywords?: string[];
  geo?: string;
  date?: string;
  explore_url?: string;
}

interface TrendQueryRow {
  query: string;
  change: string;
}

interface TrendKeywordResult {
  keyword: string;
  averageInterest: number | null;
  topQueries: TrendQueryRow[];
  risingQueries: TrendQueryRow[];
}

const AVG_HEADING_PATTERNS = ["Average interest", "Average"];
const QUERY_HEADING_PATTERNS = ["Commonly searched queries", "Related queries"];
const QUERY_CHANGE_PATTERN = /^(?:Breakout|[+-]?\d[\d,]*%)$/i;
const DEFAULT_GEO = "US";
const DEFAULT_DATE = "today 12-m";
const DEFAULT_HL = "en-US";

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function parseNumber(value: string): number | null {
  const match = value.match(/\b(100|[1-9]?\d)\b/);
  if (!match) return null;
  return Number(match[1]);
}

function buildExploreUrl(
  keywords: string[],
  geo: string,
  date: string,
): string {
  const base = "https://trends.google.com/trends/explore";
  const q = keywords.map((k) => encodeURIComponent(k)).join(",");
  // Force English UI so the page text parsing is stable across locales.
  return `${base}?q=${q}&geo=${encodeURIComponent(geo)}&date=${encodeURIComponent(date)}&hl=${encodeURIComponent(DEFAULT_HL)}`;
}

function normalizeKeywords(input: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of input) {
    const keyword = normalizeText(raw).slice(0, 100);
    if (!keyword) continue;
    const key = keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(keyword);
    if (result.length >= 5) break;
  }
  return result;
}

function extractKeywordsFromExploreUrl(exploreUrl: string): string[] {
  try {
    const parsed = new URL(exploreUrl);
    const q = parsed.searchParams.get("q");
    if (!q) return [];
    return q
      .split(",")
      .map((k) => decodeURIComponent(k))
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function waitForTextInPage(
  targetId: string,
  predicate: (text: string) => boolean,
  timeoutMs = 30000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const text = await evalInTab<string>(
      targetId,
      "document.body.innerText",
    ).catch(() => "");
    if (predicate(text)) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }

  return false;
}

async function openTrendsTab(url: string): Promise<string> {
  const result = await callProxy<{ targetId?: string }>({
    method: "GET",
    endpoint: "/new",
    query: { url, background: false },
  });

  if (!result.targetId) {
    throw new Error("Proxy did not return a targetId");
  }

  return result.targetId;
}

async function dismissConsent(targetId: string): Promise<void> {
  const clicked = await evalInTab<{ clicked?: boolean }>(
    targetId,
    `(() => {
      const labels = [/^OK, got it$/i, /^Got it$/i, /^I agree$/i, /^Accept all$/i, /^Accept$/i];
      const elements = Array.from(document.querySelectorAll('button,[role="button"]'));
      const match = elements.find((el) => {
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        return labels.some((pattern) => pattern.test(text));
      });
      if (!match) return { clicked: false };
      match.scrollIntoView({ block: 'center' });
      match.click();
      return { clicked: true };
    })()`,
  ).catch(() => ({ clicked: false }));
  if (clicked.clicked) {
    await new Promise((r) => setTimeout(r, 1200));
  }
}

async function getPageLines(targetId: string): Promise<string[]> {
  const text = await evalInTab<string>(
    targetId,
    "document.body.innerText",
  ).catch(() => "");
  return text.split("\n").map(normalizeText).filter(Boolean);
}

function parseAverageInterest(
  lines: string[],
  keywords: string[],
): Record<string, number | null> {
  const normalizedLines = lines.map(normalizeText);
  const result: Record<string, number | null> = {};

  const headingIdx = normalizedLines.findIndex(
    (l) =>
      l.toLowerCase() === "average interest" || l.toLowerCase() === "average",
  );
  if (headingIdx >= 0) {
    const tabbedAverageLine = normalizedLines.find(
      (line) => /^Average\s+\d/.test(line) || /^Average\t\d/.test(line),
    );
    if (tabbedAverageLine) {
      const values = tabbedAverageLine
        .split(/\s+|\t+/)
        .slice(1)
        .map((part) => parseNumber(part))
        .filter((value): value is number => value != null);
      if (values.length >= keywords.length) {
        keywords.forEach((keyword, index) => {
          result[keyword] = values[index] ?? null;
        });
        return result;
      }
    }
  }

  for (const keyword of keywords) {
    result[keyword] = null;
    const keywordPattern = new RegExp(
      `^${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
      "i",
    );

    for (let i = 0; i < normalizedLines.length; i++) {
      const line = normalizedLines[i];
      if (!keywordPattern.test(line)) continue;
      for (let j = i + 1; j < Math.min(i + 5, normalizedLines.length); j++) {
        const num = parseNumber(normalizedLines[j]);
        if (num !== null) {
          result[keyword] = num;
          break;
        }
      }
      if (result[keyword] !== null) break;
    }
  }

  if (keywords.some((k) => result[k] === null) && headingIdx >= 0) {
    const trailing = normalizedLines
      .slice(headingIdx + 1)
      .map(parseNumber)
      .filter((v): v is number => v !== null);
    if (trailing.length >= keywords.length) {
      const vals = trailing.slice(-keywords.length);
      keywords.forEach((k, i) => {
        if (result[k] === null) result[k] = vals[i] ?? null;
      });
    }
  }

  return result;
}

function shouldIgnoreLine(line: string, keyword: string): boolean {
  const n = normalizeText(line);
  if (!n) return true;
  if (/^\d+$/.test(n)) return true;
  if (/^(north|south|east|west)$/i.test(n)) return true;
  if (
    ["commonly searched queries", "related queries"].includes(n.toLowerCase())
  )
    return true;
  if (/^(top|rising|queries|searches for|query|more query actions)$/i.test(n))
    return true;
  if (/^people who searched for .* also searched for these queries$/i.test(n))
    return true;
  if (n.toLowerCase() === keyword.toLowerCase()) return true;
  return false;
}

function parseQueryRows(lines: string[], keyword: string): TrendQueryRow[] {
  const rows: TrendQueryRow[] = [];
  for (let i = 0; i < lines.length; i++) {
    const current = lines[i];
    if (shouldIgnoreLine(current, keyword)) continue;

    const inline = current.match(/^(.*?)(Breakout|[+-]?\d[\d,]*%)$/i);
    if (inline) {
      const q = normalizeText(inline[1]);
      const c = normalizeText(inline[2]);
      if (q) rows.push({ query: q, change: c });
      continue;
    }

    const next = lines[i + 1] || "";
    const nextNext = lines[i + 2] || "";
    if (
      /^(north|south|east|west)$/i.test(next) &&
      QUERY_CHANGE_PATTERN.test(nextNext)
    ) {
      rows.push({ query: current, change: nextNext });
      i += 2;
      continue;
    }
    if (QUERY_CHANGE_PATTERN.test(next)) {
      rows.push({ query: current, change: next });
      i += 1;
    }
  }
  return rows;
}

function collectSection(
  lines: string[],
  keyword: string,
  keywords: string[],
): string[] {
  const normalizedKeyword = keyword.toLowerCase();
  const sectionStarts = lines
    .map((line, index) => ({ line: line.toLowerCase(), index }))
    .filter(({ line }) => line === normalizedKeyword)
    .map(({ index }) => index);

  const startIndex = sectionStarts.find((index) =>
    lines.slice(index, index + 8).some((line) => /related queries/i.test(line)),
  );
  if (startIndex == null) return [];

  const otherKeywords = new Set(
    keywords
      .filter((item) => item.toLowerCase() !== normalizedKeyword)
      .map((item) => item.toLowerCase()),
  );
  let endIndex = lines.length;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (otherKeywords.has(lines[index].toLowerCase())) {
      endIndex = index;
      break;
    }
  }

  return lines.slice(startIndex, endIndex);
}

async function extractTopQueriesForKeyword(
  targetId: string,
  keyword: string,
  keywords: string[],
): Promise<{ topQueries: TrendQueryRow[]; risingQueries: TrendQueryRow[] }> {
  const lines = await getPageLines(targetId);
  const relevant = collectSection(lines, keyword, keywords);
  if (relevant.length === 0) {
    return { topQueries: [], risingQueries: [] };
  }

  const risingIndex = relevant.findIndex(
    (line) => line.toLowerCase() === "rising",
  );
  const topIndex = relevant.findIndex((line) => line.toLowerCase() === "top");

  const risingLines =
    risingIndex >= 0 ? relevant.slice(risingIndex + 1) : relevant;
  const topLines =
    topIndex >= 0 && topIndex < risingIndex
      ? relevant.slice(topIndex + 1, risingIndex)
      : [];

  return {
    topQueries: parseQueryRows(topLines, keyword).slice(0, 10),
    risingQueries: parseQueryRows(risingLines, keyword).slice(0, 10),
  };
}

async function compareTrends(input: CompareInput): Promise<ScriptResult> {
  const keywords = normalizeKeywords(
    input.keywords && input.keywords.length > 0
      ? input.keywords
      : input.explore_url
        ? extractKeywordsFromExploreUrl(input.explore_url)
        : [],
  );

  if (keywords.length < 1) {
    return {
      success: false,
      message:
        "At least one keyword is required. Provide keywords directly or a Google Trends explore URL with a q= parameter.",
    };
  }

  const geo = input.geo?.trim() || DEFAULT_GEO;
  const date = input.date?.trim() || DEFAULT_DATE;
  const url = input.explore_url?.trim() || buildExploreUrl(keywords, geo, date);

  let targetId: string | null = null;
  try {
    const tabId = await openTrendsTab(url);
    targetId = tabId;
    await dismissConsent(tabId);

    const ready = await waitForTextInPage(
      tabId,
      (text) =>
        AVG_HEADING_PATTERNS.some((p) => text.includes(p)) &&
        QUERY_HEADING_PATTERNS.some((p) => text.includes(p)),
      30000,
    );
    if (!ready) {
      throw new Error(
        "Timed out waiting for Google Trends content (Average interest / Related queries).",
      );
    }

    for (let i = 0; i < 4; i += 1) {
      await scrollTab(tabId, { y: 1800, direction: "down" });
      await new Promise((r) => setTimeout(r, 1200));
    }

    const lines = await getPageLines(tabId);
    const avgMap = parseAverageInterest(lines, keywords);
    const keywordResults: TrendKeywordResult[] = [];

    for (const keyword of keywords) {
      const topQueries = await extractTopQueriesForKeyword(
        tabId,
        keyword,
        keywords,
      );
      keywordResults.push({
        keyword,
        averageInterest: avgMap[keyword] ?? null,
        topQueries: topQueries.topQueries,
        risingQueries: topQueries.risingQueries,
      });
    }

    return {
      success: true,
      message: "Google Trends comparison completed",
      data: { url, geo, date, keywords: keywordResults },
    };
  } catch (err) {
    return {
      success: false,
      message: `Script execution failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    if (targetId) await closeBackgroundTab(targetId).catch(() => {});
  }
}

runScript<CompareInput>(compareTrends);

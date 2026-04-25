import fs from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";

type WatchTarget = {
  site: string;
  sitemapUrl: string;
};

type SlugRecord = {
  site: string;
  slug: string;
  firstSeenAt: string;
};

type CliOptions = {
  watchlistPath: string;
  outputDir: string;
  targets: WatchTarget[];
};

type SitemapSnapshot = {
  locs: string[];
  isSitemapIndex: boolean;
  source: "direct" | "cdp";
};

type PageUrlResult = {
  urls: string[];
  source: "direct" | "cdp";
};

const DEFAULT_WATCHLIST_PATH = "notes/website-list.csv";
const DEFAULT_OUTPUT_DIR = "notes/sitemap-slugs";
const CDP_PROXY_BASE_URL = "http://localhost:3456";

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const watchlistTargets = await readWatchTargets(options.watchlistPath);
  const targets = dedupeTargets([...watchlistTargets, ...options.targets]);

  if (targets.length === 0) {
    throw new Error(
      "No sitemap targets found. Add rows to notes/website-list.csv or pass --target site=https://example.com/sitemap.xml",
    );
  }

  const newRecords: SlugRecord[] = [];
  const summary: Array<{ site: string; count: number; source: string }> = [];

  for (const target of targets) {
    const existingRecords = await readSiteSlugRecords(target.site, options.outputDir);
    const existingKeys = new Set(existingRecords.map((record) => makeKey(record.site, record.slug)));
    const pageResult = await collectPageUrls(target.sitemapUrl);
    const slugs = Array.from(
      new Set(
        pageResult.urls
          .map(toSlug)
          .filter((slug): slug is string => Boolean(slug)),
      ),
    ).sort();
    const discoveredAt = new Date().toISOString();
    const siteNewRecords: SlugRecord[] = [];

    let newCount = 0;
    for (const slug of slugs) {
      const key = makeKey(target.site, slug);
      if (existingKeys.has(key)) {
        continue;
      }

      existingKeys.add(key);
      const record = {
        site: target.site,
        slug,
        firstSeenAt: discoveredAt,
      };
      newRecords.push(record);
      siteNewRecords.push(record);
      newCount += 1;
    }

    const mergedRecords = [...siteNewRecords, ...existingRecords].sort(compareRecords);
    await writeSiteSlugRecords(target.site, options.outputDir, mergedRecords);
    summary.push({ site: target.site, count: newCount, source: pageResult.source });
  }

  for (const item of summary) {
    console.log(`${item.site}: ${item.count} new slugs (${item.source})`);
  }

  if (newRecords.length > 0) {
    console.log("\nNewest slugs:");
    for (const record of newRecords.slice(0, 20)) {
      console.log(`- ${record.site},${record.slug},${record.firstSeenAt}`);
    }
  } else {
    console.log("\nNo new slugs found.");
  }
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    watchlistPath: DEFAULT_WATCHLIST_PATH,
    outputDir: DEFAULT_OUTPUT_DIR,
    targets: [],
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--watchlist") {
      options.watchlistPath = requireNextValue(args, ++index, arg);
      continue;
    }

    if (arg === "--output") {
      options.outputDir = requireNextValue(args, ++index, arg);
      continue;
    }

    if (arg === "--output-dir") {
      options.outputDir = requireNextValue(args, ++index, arg);
      continue;
    }

    if (arg === "--target") {
      options.targets.push(parseTargetArg(requireNextValue(args, ++index, arg)));
      continue;
    }

    if (arg === "--help") {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function requireNextValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
}

function parseTargetArg(value: string): WatchTarget {
  const separatorIndex = value.indexOf("=");
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
    throw new Error(`Invalid --target value: ${value}. Expected site=https://example.com/sitemap.xml`);
  }

  return {
    site: value.slice(0, separatorIndex).trim(),
    sitemapUrl: value.slice(separatorIndex + 1).trim(),
  };
}

function printHelp(): void {
  console.log(`Usage: npm run monitor:sitemaps -- [options]

Options:
  --watchlist <path>   Watchlist CSV path. Default: ${DEFAULT_WATCHLIST_PATH}
  --output <path>      Output directory path. Default: ${DEFAULT_OUTPUT_DIR}
  --output-dir <path>  Output directory path. Default: ${DEFAULT_OUTPUT_DIR}
  --target <site=url>  Extra sitemap target. Repeatable.
  --help               Show this help message
`);
}

async function readWatchTargets(filePath: string): Promise<WatchTarget[]> {
  const resolvedPath = path.resolve(filePath);
  let raw: string;

  try {
    raw = await fs.readFile(resolvedPath, "utf8");
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const rows = parseCsv(raw);
  if (rows.length === 0) {
    return [];
  }

  const [header, ...body] = rows;
  const siteIndex = header.indexOf("site");
  const sitemapIndex = header.indexOf("sitemap_url");

  if (siteIndex === -1 || sitemapIndex === -1) {
    throw new Error(`${filePath} must have header: site,sitemap_url`);
  }

  return body
    .map((row) => ({
      site: row[siteIndex]?.trim() || "",
      sitemapUrl: row[sitemapIndex]?.trim() || "",
    }))
    .filter((target) => target.site && target.sitemapUrl);
}

function dedupeTargets(targets: WatchTarget[]): WatchTarget[] {
  const seen = new Set<string>();
  const deduped: WatchTarget[] = [];

  for (const target of targets) {
    const key = makeKey(target.site, target.sitemapUrl);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(target);
  }

  return deduped;
}

async function collectPageUrls(rootSitemapUrl: string): Promise<PageUrlResult> {
  const visited = new Set<string>();
  const pageUrls: string[] = [];
  let source: "direct" | "cdp" = "direct";
  source = await visitSitemap(rootSitemapUrl, visited, pageUrls, source);
  return { urls: pageUrls, source };
}

async function visitSitemap(
  sitemapUrl: string,
  visited: Set<string>,
  pageUrls: string[],
  currentSource: "direct" | "cdp",
): Promise<"direct" | "cdp"> {
  if (visited.has(sitemapUrl)) {
    return currentSource;
  }

  visited.add(sitemapUrl);
  const sitemap = await fetchSitemap(sitemapUrl);
  const nextSource = currentSource === "cdp" ? currentSource : sitemap.source;

  if (sitemap.isSitemapIndex) {
    for (const nestedUrl of sitemap.locs) {
      currentSource = await visitSitemap(nestedUrl, visited, pageUrls, nextSource);
    }
    return currentSource;
  }

  pageUrls.push(...sitemap.locs);
  return nextSource;
}

async function fetchSitemap(url: string): Promise<SitemapSnapshot> {
  try {
    return await fetchSitemapDirect(url);
  } catch {
    return await fetchSitemapViaBrowser(url);
  }
}

async function fetchSitemapDirect(url: string): Promise<SitemapSnapshot> {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      accept: "application/xml,text/xml,*/*",
    },
  });

  if (!response.ok) {
    throw new Error(`Direct fetch failed for ${url}: ${response.status}`);
  }

  const raw = Buffer.from(await response.arrayBuffer());
  const xml = isGzip(raw) ? gunzipSync(raw).toString("utf8") : raw.toString("utf8");
  if (/access denied|attention required|you have been blocked/i.test(xml)) {
    throw new Error(`Direct fetch blocked for ${url}`);
  }

  return {
    locs: extractLocsFromXml(xml),
    isSitemapIndex: /<\s*sitemapindex\b/i.test(xml),
    source: "direct",
  };
}

async function fetchSitemapViaBrowser(url: string): Promise<SitemapSnapshot> {
  await ensureBrowserProxyReady();

  const targetId = await openBrowserPage(url);

  try {
    const result = await evaluateInBrowser<{
      bodyText?: string;
      contentType?: string;
      currentUrl?: string;
      isSitemapIndex?: boolean;
      locs?: string[];
      title?: string;
    }>(
      targetId,
      `(() => ({
        bodyText: document.body?.innerText || document.documentElement?.innerHTML || "",
        contentType: document.contentType || "",
        currentUrl: location.href,
        isSitemapIndex: Boolean(document.querySelector("sitemapindex")),
        locs: Array.from(document.querySelectorAll("loc")).map((el) => el.textContent?.trim()).filter(Boolean),
        title: document.title || "",
      }))()`,
    );

    const bodyText = result.bodyText?.trim() || "";
    if (!bodyText) {
      throw new Error(`Empty browser response for ${url}`);
    }

    if (/access denied|attention required|you have been blocked/i.test(bodyText)) {
      throw new Error(`Browser access blocked for ${url}`);
    }

    return {
      locs: result.locs || [],
      isSitemapIndex: Boolean(result.isSitemapIndex),
      source: "cdp",
    };
  } finally {
    await closeBrowserPage(targetId);
  }
}

function extractLocsFromXml(xml: string): string[] {
  return Array.from(xml.matchAll(/<loc>([\s\S]*?)<\/loc>/gi))
    .map((match) => decodeXml(match[1]?.trim() || ""))
    .filter(Boolean);
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function isGzip(buffer: Buffer): boolean {
  return buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
}

async function ensureBrowserProxyReady(): Promise<void> {
  const response = await fetch(`${CDP_PROXY_BASE_URL}/health`);
  if (!response.ok) {
    throw new Error("web-access proxy is not ready");
  }
}

async function openBrowserPage(url: string): Promise<string> {
  const response = await fetch(`${CDP_PROXY_BASE_URL}/new?url=${encodeURIComponent(url)}`);
  if (!response.ok) {
    throw new Error(`Failed to open browser page for ${url}`);
  }

  const data = (await response.json()) as { targetId?: string };
  if (!data.targetId) {
    throw new Error(`Browser proxy did not return targetId for ${url}`);
  }

  return data.targetId;
}

async function closeBrowserPage(targetId: string): Promise<void> {
  await fetch(`${CDP_PROXY_BASE_URL}/close?target=${encodeURIComponent(targetId)}`).catch(() => undefined);
}

async function evaluateInBrowser<T>(targetId: string, expression: string): Promise<T> {
  const response = await fetch(`${CDP_PROXY_BASE_URL}/eval?target=${encodeURIComponent(targetId)}`, {
    method: "POST",
    headers: {
      "content-type": "text/plain",
    },
    body: expression,
  });

  if (!response.ok) {
    throw new Error(`Failed to evaluate browser page ${targetId}`);
  }

  const payload = (await response.json()) as { value?: T; error?: string };
  if (payload.error) {
    throw new Error(payload.error);
  }

  if (payload.value === undefined) {
    throw new Error(`Browser evaluation returned no value for ${targetId}`);
  }

  return payload.value;
}

function toSlug(rawUrl: string): string | undefined {
  let parsed: URL;

  try {
    parsed = new URL(rawUrl);
  } catch {
    return undefined;
  }

  const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  if (pathname === "/") {
    return undefined;
  }

  return pathname;
}

async function readSiteSlugRecords(site: string, outputDir: string): Promise<SlugRecord[]> {
  const resolvedPath = path.resolve(outputDir, `${site}.csv`);
  let raw: string;

  try {
    raw = await fs.readFile(resolvedPath, "utf8");
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  return parseSlugRecordRows(raw);
}

async function writeSiteSlugRecords(site: string, outputDir: string, records: SlugRecord[]): Promise<void> {
  const resolvedPath = path.resolve(outputDir, `${site}.csv`);
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true });

  const lines = [
    formatCsvRow(["site", "slug", "first_seen_at"]),
    ...records.map((record) => formatCsvRow([record.site, record.slug, record.firstSeenAt])),
  ];

  await fs.writeFile(resolvedPath, `${lines.join("\n")}\n`, "utf8");
}

function parseSlugRecordRows(raw: string): SlugRecord[] {
  const rows = parseCsv(raw);
  if (rows.length === 0) {
    return [];
  }

  const [header, ...body] = rows;
  const siteIndex = header.indexOf("site");
  const slugIndex = header.indexOf("slug");
  const firstSeenIndex = header.indexOf("first_seen_at");

  if (siteIndex === -1 || slugIndex === -1 || firstSeenIndex === -1) {
    throw new Error(`CSV must have header: site,slug,first_seen_at`);
  }

  return body
    .map((row) => ({
      site: row[siteIndex]?.trim() || "",
      slug: row[slugIndex]?.trim() || "",
      firstSeenAt: row[firstSeenIndex]?.trim() || "",
    }))
    .filter((record) => record.site && record.slug && record.firstSeenAt);
}

function parseCsv(raw: string): string[][] {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return lines.map(parseCsvLine);
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      const nextChar = line[index + 1];
      if (inQuotes && nextChar === '"') {
        current += '"';
        index += 1;
        continue;
      }

      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells;
}

function formatCsvRow(values: string[]): string {
  return values.map(formatCsvCell).join(",");
}

function formatCsvCell(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return value;
}

function compareRecords(left: SlugRecord, right: SlugRecord): number {
  const timeCompare = right.firstSeenAt.localeCompare(left.firstSeenAt);
  if (timeCompare !== 0) {
    return timeCompare;
  }

  const siteCompare = left.site.localeCompare(right.site);
  if (siteCompare !== 0) {
    return siteCompare;
  }

  return left.slug.localeCompare(right.slug);
}

function makeKey(site: string, slug: string): string {
  return `${site}\t${slug}`;
}

main().catch((error) => {
  console.error("[sitemap-monitor] failed", error instanceof Error ? error.message : error);
  process.exit(1);
});

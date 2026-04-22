import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

type CliOptions = {
  site: string;
  db: string;
  minVolume: number;
  maxKd: number;
  outputDir: string;
  timeoutMs: number;
  semrushUrl?: string;
  skipCheck: boolean;
};

type BrowserEvalResponse<T> = {
  value?: T;
  error?: string;
};

type DownloadSnapshot = Map<string, { size: number; mtimeMs: number }>;

const CDP_PROXY_BASE_URL = "http://localhost:3456";
const DEFAULT_DB = "us";
const DEFAULT_MIN_VOLUME = 1000;
const DEFAULT_MAX_KD = 40;
const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_OUTPUT_DIR = "notes/keywords";
const OUTPUT_DECIMALS = 2;
const DEFAULT_COLUMNS_TO_REMOVE = [
  "Previous position",
  "Traffic Cost",
  "Competition",
  "Number of Results",
  "Trends",
  "Timestamp",
  "SERP Features by Keyword",
  "Keyword Intents",
  "Position Type",
];
const DEFAULT_TOP_ROWS = 300;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB_ACCESS_CHECK_SCRIPT = path.join(
  REPO_ROOT,
  ".opencode/skills/web-access/scripts/check-deps.sh",
);

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const domain = normalizeDomain(options.site);

  if (!options.skipCheck) {
    runWebAccessCheck();
  }
  await ensureBrowserProxyReady();

  const targetUrl = options.semrushUrl ?? buildSemrushUrl(domain, options);
  const downloadsDir = path.join(os.homedir(), "Downloads");
  const downloadSnapshot = await snapshotDownloads(downloadsDir);
  const targetId = await openBrowserPage(targetUrl);

  try {
    await waitForExportButton(targetId, options.timeoutMs);
    await clickByTexts(targetId, ["导出", "Export"], options.timeoutMs);

    if (!(await waitForDownloadedCsvIfAny(downloadsDir, downloadSnapshot, 4_000))) {
      await clickByTexts(targetId, ["CSV", "Csv", "csv"], options.timeoutMs);
    }

    const downloadedFile = await waitForDownloadedCsv(
      downloadsDir,
      downloadSnapshot,
      options.timeoutMs,
    );
    const finalPath = await moveDownloadedCsv(downloadedFile, options.outputDir, {
      domain,
      db: options.db,
      minVolume: options.minVolume,
      maxKd: options.maxKd,
    });
    await postProcessExportedCsv(finalPath);

    console.log(finalPath);
  } finally {
    await closeBrowserPage(targetId);
  }
}

function parseArgs(args: string[]): CliOptions {
  const options: Partial<CliOptions> = {
    db: DEFAULT_DB,
    minVolume: DEFAULT_MIN_VOLUME,
    maxKd: DEFAULT_MAX_KD,
    outputDir: DEFAULT_OUTPUT_DIR,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    skipCheck: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--db") {
      options.db = requireNextValue(args, ++index, arg);
      continue;
    }

    if (arg === "--min-volume") {
      options.minVolume = parseInteger(requireNextValue(args, ++index, arg), arg);
      continue;
    }

    if (arg === "--max-kd") {
      options.maxKd = parseInteger(requireNextValue(args, ++index, arg), arg);
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

    if (arg === "--timeout-ms") {
      options.timeoutMs = parseInteger(requireNextValue(args, ++index, arg), arg);
      continue;
    }

    if (arg === "--semrush-url") {
      options.semrushUrl = requireNextValue(args, ++index, arg);
      continue;
    }

    if (arg === "--skip-check") {
      options.skipCheck = true;
      continue;
    }

    if (arg === "--help") {
      printHelp();
      process.exit(0);
    }

    if (!options.site) {
      options.site = arg;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.site) {
    throw new Error("Missing site. Example: npm run semrush:export -- character.ai");
  }

  return options as CliOptions;
}

function requireNextValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
}

function parseInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric value for ${flag}: ${value}`);
  }

  return parsed;
}

function printHelp(): void {
  console.log(`Usage: npm run semrush:export -- <site> [options]

Options:
  --db <code>            Semrush database. Default: ${DEFAULT_DB}
  --min-volume <number>  Minimum volume filter. Default: ${DEFAULT_MIN_VOLUME}
  --max-kd <number>      Maximum KD filter. Default: ${DEFAULT_MAX_KD}
  --output <path>        Output directory. Default: ${DEFAULT_OUTPUT_DIR}
  --output-dir <path>    Output directory. Default: ${DEFAULT_OUTPUT_DIR}
  --timeout-ms <number>  Download timeout. Default: ${DEFAULT_TIMEOUT_MS}
  --semrush-url <url>    Use a full Semrush URL directly
  --skip-check           Skip repo web-access dependency check
  --help                 Show this help message

Examples:
  npm run semrush:export -- character.ai
  npm run semrush:export -- https://character.ai --db us --min-volume 1000 --max-kd 40
`);
}

function normalizeDomain(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Site cannot be empty");
  }

  try {
    const url = trimmed.includes("://") ? new URL(trimmed) : new URL(`https://${trimmed}`);
    return url.hostname.replace(/^www\./i, "").replace(/\.$/, "");
  } catch {
    return trimmed.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
  }
}

function buildSemrushUrl(domain: string, options: CliOptions): string {
  const url = new URL("https://sem.3ue.co/analytics/organic/positions/");
  url.searchParams.set("sortField", "volume");
  url.searchParams.set(
    "filter",
    JSON.stringify({
      search: "",
      volume: `${options.minVolume}-`,
      positions: "",
      positionsType: "all",
      serpFeatures: null,
      intent: [],
      kd: `-${options.maxKd}`,
      advanced: {},
    }),
  );
  url.searchParams.set("db", options.db);
  url.searchParams.set("q", domain);
  url.searchParams.set("searchType", "domain");
  return url.toString();
}

function runWebAccessCheck(): void {
  const result = spawnSync("bash", [WEB_ACCESS_CHECK_SCRIPT, "--browser", "dedicated"], {
    stdio: "inherit",
    cwd: REPO_ROOT,
  });

  if (result.status !== 0) {
    throw new Error("web-access 依赖检查失败，请先修好 CDP 代理后重试");
  }
}

async function ensureBrowserProxyReady(): Promise<void> {
  const response = await fetch(`${CDP_PROXY_BASE_URL}/health`).catch(() => undefined);
  if (!response?.ok) {
    throw new Error("web-access proxy 不可用，请先运行 check-deps.sh");
  }
}

async function openBrowserPage(url: string): Promise<string> {
  const response = await fetch(`${CDP_PROXY_BASE_URL}/new?url=${encodeURIComponent(url)}`);
  if (!response.ok) {
    throw new Error(`无法打开页面: ${url}`);
  }

  const payload = (await response.json()) as { targetId?: string };
  if (!payload.targetId) {
    throw new Error("CDP 代理没有返回 targetId");
  }

  return payload.targetId;
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
    throw new Error(`浏览器执行失败: ${targetId}`);
  }

  const payload = (await response.json()) as BrowserEvalResponse<T>;
  if (payload.error) {
    throw new Error(payload.error);
  }

  if (payload.value === undefined) {
    throw new Error(`浏览器没有返回结果: ${targetId}`);
  }

  return payload.value;
}

async function waitForExportButton(targetId: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const state = await evaluateInBrowser<{
      hasExportButton: boolean;
      isLoginPage: boolean;
      title: string;
      url: string;
      text: string;
    }>(
      targetId,
      `(() => {
        const text = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
        const clickable = Array.from(document.querySelectorAll('button,a,[role="button"],[tabindex]'));
        const hasExportButton = clickable.some((node) => /^(导出|Export)$/.test((node.textContent || "").replace(/\s+/g, " ").trim()) || /导出|Export/.test((node.textContent || "").replace(/\s+/g, " ").trim()));
        const isLoginPage = /login|sign in|log in|登录|登入/i.test(text) || /login|signin/i.test(location.href);
        return {
          hasExportButton,
          isLoginPage,
          title: document.title || "",
          url: location.href,
          text: text.slice(0, 500),
        };
      })()`,
    );

    if (state.isLoginPage) {
      throw new Error(`Semrush 当前看起来在登录页，请先在浏览器登录后重试。当前页面: ${state.url}`);
    }

    if (state.hasExportButton) {
      return;
    }

    await sleep(1_000);
  }

  throw new Error("等待导出按钮超时，页面可能还没加载完成，或当前账号无导出权限");
}

async function clickByTexts(targetId: string, labels: string[], timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  let lastSeenTexts: string[] = [];

  while (Date.now() - startedAt < timeoutMs) {
    const result = await evaluateInBrowser<{ clicked: boolean; seenTexts: string[] }>(
      targetId,
      `((labels) => {
        const normalize = (value) => (value || "").replace(/\s+/g, " ").trim();
        const isVisible = (element) => {
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
        };
        const score = (text) => {
          let best = -1;
          for (const label of labels) {
            if (text === label) {
              return 1000 - text.length;
            }
            if (text.startsWith(label)) {
              best = Math.max(best, 800 - text.length);
            } else if (text.includes(label)) {
              best = Math.max(best, 500 - text.length);
            }
          }
          return best;
        };
        const nodes = Array.from(document.querySelectorAll('button,a,[role="button"],[tabindex],span,div,li'));
        const seenTexts = [];
        const candidates = [];

        for (const node of nodes) {
          const text = normalize(node.textContent);
          if (!text) {
            continue;
          }
          if (seenTexts.length < 30 && !seenTexts.includes(text)) {
            seenTexts.push(text);
          }
          if (text.length > 80) {
            continue;
          }

          const target = node.closest('button,a,[role="button"],[tabindex]') || node;
          if (!(target instanceof HTMLElement) || !isVisible(target)) {
            continue;
          }

          const textScore = score(text);
          if (textScore < 0) {
            continue;
          }

          candidates.push({
            target,
            text,
            textScore,
            area: target.getBoundingClientRect().width * target.getBoundingClientRect().height,
            tag: target.tagName,
          });
        }

        candidates.sort((left, right) => {
          if (right.textScore !== left.textScore) {
            return right.textScore - left.textScore;
          }
          if (left.text.length !== right.text.length) {
            return left.text.length - right.text.length;
          }
          return left.area - right.area;
        });

        const chosen = candidates[0];
        if (chosen) {
          chosen.target.scrollIntoView({ block: "center", inline: "center" });
          chosen.target.click();
          return { clicked: true, seenTexts };
        }

        return { clicked: false, seenTexts };
      })(${JSON.stringify(labels)})`,
    );

    lastSeenTexts = result.seenTexts;
    if (result.clicked) {
      await sleep(1_500);
      return;
    }

    await sleep(1_000);
  }

  throw new Error(`点击失败，找不到元素: ${labels.join(" /")}。当前可见文案示例: ${lastSeenTexts.slice(0, 12).join(" | ")}`);
}

async function snapshotDownloads(downloadsDir: string): Promise<DownloadSnapshot> {
  const snapshot: DownloadSnapshot = new Map();
  const entries = await safeReadDir(downloadsDir);

  for (const entry of entries) {
    if (!entry.name.endsWith(".csv")) {
      continue;
    }

    const fullPath = path.join(downloadsDir, entry.name);
    const stats = await fs.stat(fullPath).catch(() => undefined);
    if (!stats?.isFile()) {
      continue;
    }

    snapshot.set(entry.name, { size: stats.size, mtimeMs: stats.mtimeMs });
  }

  return snapshot;
}

async function waitForDownloadedCsvIfAny(
  downloadsDir: string,
  beforeSnapshot: DownloadSnapshot,
  timeoutMs: number,
): Promise<string | undefined> {
  try {
    return await waitForDownloadedCsv(downloadsDir, beforeSnapshot, timeoutMs);
  } catch {
    return undefined;
  }
}

async function waitForDownloadedCsv(
  downloadsDir: string,
  beforeSnapshot: DownloadSnapshot,
  timeoutMs: number,
): Promise<string> {
  const startedAt = Date.now();
  let previousCandidate: { filePath: string; size: number; seenCount: number } | undefined;

  while (Date.now() - startedAt < timeoutMs) {
    const entries = await safeReadDir(downloadsDir);
    const candidates: Array<{ filePath: string; size: number; mtimeMs: number }> = [];

    for (const entry of entries) {
      if (!entry.name.endsWith(".csv")) {
        continue;
      }

      const fullPath = path.join(downloadsDir, entry.name);
      const stats = await fs.stat(fullPath).catch(() => undefined);
      if (!stats?.isFile()) {
        continue;
      }

      const previous = beforeSnapshot.get(entry.name);
      const isNewFile = previous === undefined;
      const isUpdatedFile = previous !== undefined && (previous.size !== stats.size || previous.mtimeMs !== stats.mtimeMs);

      if (isNewFile || isUpdatedFile) {
        candidates.push({ filePath: fullPath, size: stats.size, mtimeMs: stats.mtimeMs });
      }
    }

    candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
    const candidate = candidates[0];
    if (candidate) {
      if (previousCandidate?.filePath === candidate.filePath && previousCandidate.size === candidate.size) {
        previousCandidate.seenCount += 1;
        if (previousCandidate.seenCount >= 2) {
          return candidate.filePath;
        }
      } else {
        previousCandidate = {
          filePath: candidate.filePath,
          size: candidate.size,
          seenCount: 1,
        };
      }
    }

    await sleep(1_000);
  }

  throw new Error("等待 CSV 下载超时，请检查浏览器是否真的开始下载");
}

async function safeReadDir(dirPath: string): Promise<Array<{ name: string }>> {
  try {
    return await fs.readdir(dirPath, { withFileTypes: true }).then((entries) =>
      entries.filter((entry) => entry.isFile()).map((entry) => ({ name: entry.name })),
    );
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function moveDownloadedCsv(
  sourcePath: string,
  outputDir: string,
  context: { domain: string; db: string; minVolume: number; maxKd: number },
): Promise<string> {
  const resolvedOutputDir = path.resolve(outputDir);
  await fs.mkdir(resolvedOutputDir, { recursive: true });

  const timestamp = formatTimestamp(new Date());
  const safeDomain = context.domain.replace(/[^a-z0-9.-]+/gi, "-");
  const fileName = `${safeDomain}-keywords-${context.db}-volume-${context.minVolume}-plus-kd-0-${context.maxKd}-${timestamp}.csv`;
  const destinationPath = await getAvailablePath(path.join(resolvedOutputDir, fileName));
  await fs.rename(sourcePath, destinationPath);
  return destinationPath;
}

async function getAvailablePath(filePath: string): Promise<string> {
  const extension = path.extname(filePath);
  const baseName = filePath.slice(0, -extension.length);

  for (let index = 0; index < 100; index += 1) {
    const candidate = index === 0 ? filePath : `${baseName}-${index + 1}${extension}`;
    try {
      await fs.access(candidate);
    } catch {
      return candidate;
    }
  }

  throw new Error(`无法找到可用文件名: ${filePath}`);
}

async function postProcessExportedCsv(inputPath: string): Promise<void> {
  const resolvedPath = path.resolve(inputPath);
  const raw = await fs.readFile(resolvedPath, "utf8");
  const rows = parseCsv(raw);

  if (rows.length === 0) {
    throw new Error(`CSV is empty: ${resolvedPath}`);
  }

  const [header, ...body] = rows;
  removeColumnsFromRows(header, body, DEFAULT_COLUMNS_TO_REMOVE);

  const volumeIndex = header.indexOf("Search Volume");
  const cpcIndex = header.indexOf("CPC");
  const kdIndex = header.indexOf("Keyword Difficulty");
  const keywordIndex = header.indexOf("Keyword");

  if (volumeIndex === -1 || cpcIndex === -1 || kdIndex === -1 || keywordIndex === -1) {
    throw new Error(
      'CSV must include columns: "Keyword", "Search Volume", "CPC", and "Keyword Difficulty"',
    );
  }

  let kdroiIndex = header.indexOf("kdroi");
  if (kdroiIndex === -1) {
    header.push("kdroi");
    kdroiIndex = header.length - 1;
  }

  for (const row of body) {
    while (row.length < header.length) {
      row.push("");
    }

    const searchVolume = parseNumber(row[volumeIndex]);
    const cpc = parseNumber(row[cpcIndex]);
    const keywordDifficulty = parseNumber(row[kdIndex]);

    row[kdroiIndex] = formatKdroi(searchVolume, cpc, keywordDifficulty);
  }

  sortRowsByVolume(body, volumeIndex, kdroiIndex);
  dedupeRowsByKeyword(body, keywordIndex);

  if (body.length > DEFAULT_TOP_ROWS) {
    body.splice(DEFAULT_TOP_ROWS);
  }

  const output = [header, ...body].map(formatCsvRow).join("\n");
  await fs.writeFile(resolvedPath, `${output}\n`, "utf8");
}

function removeColumnsFromRows(header: string[], body: string[][], columnsToRemove: string[]): void {
  const removeIndexes = columnsToRemove
    .map((column) => header.indexOf(column))
    .filter((index) => index >= 0)
    .sort((left, right) => right - left);

  for (const index of removeIndexes) {
    header.splice(index, 1);
    for (const row of body) {
      if (index < row.length) {
        row.splice(index, 1);
      }
    }
  }
}

function formatKdroi(searchVolume: number | null, cpc: number | null, kd: number | null): string {
  if (searchVolume == null || cpc == null || kd == null || kd <= 0) {
    return "";
  }

  return ((searchVolume * cpc) / kd).toFixed(OUTPUT_DECIMALS);
}

function sortRowsByVolume(body: string[][], volumeIndex: number, kdroiIndex: number): void {
  body.sort((left, right) => {
    const byVolume = compareNumbersDesc(left[volumeIndex], right[volumeIndex]);
    if (byVolume !== 0) {
      return byVolume;
    }

    return compareKdroi(right[kdroiIndex], left[kdroiIndex]);
  });
}

function dedupeRowsByKeyword(body: string[][], keywordIndex: number): void {
  const seen = new Set<string>();

  for (let index = body.length - 1; index >= 0; index -= 1) {
    const keyword = body[index]?.[keywordIndex]?.trim().toLowerCase();
    if (!keyword) {
      continue;
    }

    if (seen.has(keyword)) {
      body.splice(index, 1);
      continue;
    }

    seen.add(keyword);
  }
}

function compareKdroi(left: string | undefined, right: string | undefined): number {
  const leftValue = parseNumber(left);
  const rightValue = parseNumber(right);

  if (leftValue == null && rightValue == null) {
    return 0;
  }
  if (leftValue == null) {
    return -1;
  }
  if (rightValue == null) {
    return 1;
  }

  return leftValue - rightValue;
}

function compareNumbersDesc(left: string | undefined, right: string | undefined): number {
  const leftValue = parseNumber(left);
  const rightValue = parseNumber(right);

  if (leftValue == null && rightValue == null) {
    return 0;
  }
  if (leftValue == null) {
    return 1;
  }
  if (rightValue == null) {
    return -1;
  }

  return rightValue - leftValue;
}

function parseNumber(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/,/g, "").trim();
  if (normalized.length === 0) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCsv(raw: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let inQuotes = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    const nextChar = raw[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentCell += '"';
        index += 1;
        continue;
      }

      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      currentRow.push(currentCell);
      currentCell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }

      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = "";
      continue;
    }

    currentCell += char;
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  while (rows.length > 0 && rows[rows.length - 1].every((cell) => cell.length === 0)) {
    rows.pop();
  }

  return rows;
}

function formatCsvRow(values: string[]): string {
  return values.map(formatCsvCell).join(",");
}

function formatCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return value;
}

function formatTimestamp(date: Date): string {
  const parts = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0"),
  ];

  return `${parts[0]}${parts[1]}${parts[2]}-${parts[3]}${parts[4]}${parts[5]}`;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error("[semrush-export] failed", error instanceof Error ? error.message : error);
  process.exit(1);
});

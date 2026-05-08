import fs from "node:fs";
import path from "node:path";

const WORKSPACE_ROOT = process.cwd();
const WIKI_ROOT = path.join(WORKSPACE_ROOT, "notes", "knowledge", "wiki");
const INDEX_PATH = path.join(WIKI_ROOT, "index.md");
const LOG_PATH = path.join(WIKI_ROOT, "log.md");
const SOURCES_ROOT = path.join(WIKI_ROOT, "sources");

interface WikiSnapshot {
  files: Map<string, string>;
}

export interface IngestValidationResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
  summary: string;
  touchedFiles: string[];
}

export function captureWikiSnapshot(): WikiSnapshot {
  return {
    files: readWikiFiles(WIKI_ROOT),
  };
}

export function validateIngestResult(input: {
  targetPath: string;
  before: WikiSnapshot;
  after: WikiSnapshot;
}): IngestValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const touchedFiles = diffTouchedFiles(input.before.files, input.after.files);

  if (touchedFiles.length === 0) {
    errors.push("Ingest did not create or update any wiki files.");
  }

  const changedWikiPages = touchedFiles.filter(
    (file) => file !== "index.md" && file !== "log.md" && !file.endsWith("/.gitkeep"),
  );
  if (changedWikiPages.length === 0) {
    errors.push("Ingest did not produce any wiki page changes beyond index/log scaffolding.");
  }

  if (!fileChanged(input.before.files, input.after.files, "index.md")) {
    errors.push("Ingest did not update notes/knowledge/wiki/index.md.");
  }

  if (!fileChanged(input.before.files, input.after.files, "log.md")) {
    errors.push("Ingest did not append or update notes/knowledge/wiki/log.md.");
  }

  const targetStat = safeStat(input.targetPath);
  const sourcePages = collectChangedSourcePages(input.before.files, input.after.files);

  if (targetStat?.isFile()) {
    validateFileIngest({
      targetPath: input.targetPath,
      sourcePages,
      after: input.after.files,
      errors,
      warnings,
    });
  } else if (targetStat?.isDirectory()) {
    if (sourcePages.length === 0) {
      errors.push("Directory ingest did not create or update any source pages.");
    }
  }

  const summary = buildSummary({ errors, warnings, touchedFiles });

  return {
    passed: errors.length === 0,
    errors,
    warnings,
    summary,
    touchedFiles,
  };
}

export function validateCurrentIngestTarget(target: string): IngestValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const snapshot = captureWikiSnapshot();
  const targetStat = isProbablyUrl(target) ? undefined : safeStat(target);
  const sourcePages = collectAllSourcePages(snapshot.files);
  const matchingSourcePages = findMatchingSourcePages({
    target,
    sourcePages,
    files: snapshot.files,
  });

  if (!snapshot.files.has("index.md")) {
    errors.push("notes/knowledge/wiki/index.md is missing.");
  }

  if (!snapshot.files.has("log.md")) {
    errors.push("notes/knowledge/wiki/log.md is missing.");
  }

  if (targetStat?.isDirectory()) {
    if (sourcePages.length === 0) {
      errors.push("Directory ingest has no source pages under notes/knowledge/wiki/sources/.");
    }
  } else if (matchingSourcePages.length === 0) {
    errors.push(`No source page in notes/knowledge/wiki/sources/ records the target (${target}).`);
  }

  if (!indexMentionsTarget(snapshot.files.get("index.md") || "", matchingSourcePages)) {
    warnings.push("index.md does not clearly reference the matched source page.");
  }

  if (!logMentionsTarget(snapshot.files.get("log.md") || "", target, matchingSourcePages)) {
    warnings.push("log.md does not clearly record this ingest target.");
  }

  if (!targetStat?.isDirectory()) {
    validateMatchingSourcePages({
      target,
      matchingSourcePages,
      files: snapshot.files,
      errors,
      warnings,
    });
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings,
    summary: buildSummary({ errors, warnings, touchedFiles: matchingSourcePages }),
    touchedFiles: matchingSourcePages,
  };
}

function validateFileIngest(input: {
  targetPath: string;
  sourcePages: string[];
  after: Map<string, string>;
  errors: string[];
  warnings: string[];
}): void {
  if (input.sourcePages.length === 0) {
    input.errors.push("File ingest did not create or update any source page under notes/knowledge/wiki/sources/.");
    return;
  }

  const relativeTarget = path.relative(WORKSPACE_ROOT, input.targetPath) || input.targetPath;
  const matchingSourcePages = findMatchingSourcePages({
    target: relativeTarget,
    sourcePages: input.sourcePages,
    files: input.after,
  });

  if (matchingSourcePages.length === 0) {
    input.errors.push(
      `No changed source page records the ingested source path (${relativeTarget}).`,
    );
    return;
  }

  validateMatchingSourcePages({
    target: input.targetPath,
    matchingSourcePages,
    files: input.after,
    errors: input.errors,
    warnings: input.warnings,
  });
}

function buildSummary(input: {
  errors: string[];
  warnings: string[];
  touchedFiles: string[];
}): string {
  const headline = input.errors.length
    ? `validation failed with ${input.errors.length} error(s)`
    : input.warnings.length
      ? `validation passed with ${input.warnings.length} warning(s)`
      : "validation passed";

  const parts = [headline, `touched files: ${input.touchedFiles.length}`];
  if (input.warnings.length) {
    parts.push(`warnings: ${input.warnings.join(" | ")}`);
  }
  if (input.errors.length) {
    parts.push(`errors: ${input.errors.join(" | ")}`);
  }
  return parts.join("; ");
}

function readWikiFiles(root: string): Map<string, string> {
  const files = new Map<string, string>();
  walkDirectory(root, files);
  return files;
}

function walkDirectory(current: string, files: Map<string, string>): void {
  const entries = fs.readdirSync(current, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      walkDirectory(fullPath, files);
      continue;
    }
    const relativePath = path.relative(WIKI_ROOT, fullPath).replace(/\\/g, "/");
    files.set(relativePath, fs.readFileSync(fullPath, "utf8"));
  }
}

function diffTouchedFiles(before: Map<string, string>, after: Map<string, string>): string[] {
  const all = new Set([...before.keys(), ...after.keys()]);
  return Array.from(all)
    .filter((file) => before.get(file) !== after.get(file))
    .sort();
}

function fileChanged(before: Map<string, string>, after: Map<string, string>, file: string): boolean {
  return before.get(file) !== after.get(file);
}

function collectChangedSourcePages(before: Map<string, string>, after: Map<string, string>): string[] {
  const prefix = path.relative(WIKI_ROOT, SOURCES_ROOT).replace(/\\/g, "/") + "/";
  return diffTouchedFiles(before, after).filter(
    (file) => file.startsWith(prefix) && !file.endsWith(".gitkeep"),
  );
}

function collectAllSourcePages(files: Map<string, string>): string[] {
  const prefix = path.relative(WIKI_ROOT, SOURCES_ROOT).replace(/\\/g, "/") + "/";
  return Array.from(files.keys())
    .filter((file) => file.startsWith(prefix) && !file.endsWith(".gitkeep"))
    .sort();
}

function safeStat(filePath: string): fs.Stats | undefined {
  try {
    return fs.statSync(filePath);
  } catch {
    return undefined;
  }
}

function safeReadFile(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function countNonEmptyLines(content: string): number {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean).length;
}

function countMarkdownBullets(content: string): number {
  return content
    .split(/\r?\n/)
    .filter((line) => /^[-*]\s+/.test(line.trim())).length;
}

function containsFormula(content: string): boolean {
  return /KDRoi\s*=|KGR\s*=|外链数\s*≈|\([^)]+\)\s*\/\s*[A-Za-z\u4e00-\u9fa5]+|```[\s\S]*?=/.test(content);
}

function hasSourceLocator(content: string): boolean {
  return /source path:/i.test(content) || /original url:/i.test(content) || /source url:/i.test(content);
}

function hasSummarySection(content: string): boolean {
  return /##\s+source summary\b/i.test(content) || /##\s+summary\b/i.test(content);
}

function hasStructuredKnowledgeSection(content: string): boolean {
  return (
    /##\s+key structures preserved from source\b/i.test(content) ||
    /##\s+reusable (takeaways|decision rules|rules)\b/i.test(content) ||
    /##\s+source-specific evidence\b/i.test(content) ||
    /##\s+key points\b/i.test(content) ||
    /##\s+durable takeaways\b/i.test(content)
  );
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function findMatchingSourcePages(input: {
  target: string;
  sourcePages: string[];
  files: Map<string, string>;
}): string[] {
  const matchers = buildTargetMatchers(input.target);
  return input.sourcePages.filter((file) => {
    const content = input.files.get(file) || "";
    return matchers.some((token) => token.length > 0 && content.includes(token));
  });
}

function buildTargetMatchers(target: string): string[] {
  const tokens = new Set<string>();
  const normalizedTarget = normalizePath(target);
  tokens.add(target);
  tokens.add(normalizedTarget);

  if (!isProbablyUrl(target)) {
    const relativeTarget = normalizePath(path.relative(WORKSPACE_ROOT, target) || target);
    tokens.add(relativeTarget);
    tokens.add(path.basename(target));
  } else {
    try {
      const url = new URL(target);
      tokens.add(url.pathname);
      const lastSegment = url.pathname.split("/").filter(Boolean).pop();
      if (lastSegment) tokens.add(lastSegment);
    } catch {
      // ignore malformed URL and fall back to raw string matching
    }
  }

  return Array.from(tokens).filter(Boolean);
}

function validateMatchingSourcePages(input: {
  target: string;
  matchingSourcePages: string[];
  files: Map<string, string>;
  errors: string[];
  warnings: string[];
}): void {
  const sourceContent = isProbablyUrl(input.target) ? "" : safeReadFile(input.target);
  const sourceLineCount = countNonEmptyLines(sourceContent);

  for (const page of input.matchingSourcePages) {
    const content = input.files.get(page) || "";

    if (content.length < 400) {
      input.warnings.push(`${page} is very short and may be too shallow for a durable source page.`);
    }

    if (!hasSourceLocator(content)) {
      input.errors.push(`${page} is missing a source locator such as Source path or Original URL.`);
    }

    if (!hasSummarySection(content)) {
      input.warnings.push(`${page} is missing a clear summary section.`);
    }

    if (!hasStructuredKnowledgeSection(content)) {
      input.warnings.push(`${page} is missing a clear structure, evidence, or takeaways section.`);
    }

    if (sourceLineCount >= 40 && countMarkdownBullets(content) < 4) {
      input.warnings.push(`${page} may be under-structured relative to the source length.`);
    }

    if (sourceContent && containsFormula(sourceContent) && !containsFormula(content)) {
      input.warnings.push(`${page} does not preserve any formula-like content from the source.`);
    }
  }
}

function indexMentionsTarget(indexContent: string, matchingSourcePages: string[]): boolean {
  return matchingSourcePages.some((file) => indexContent.includes(`[[${file}]]`));
}

function logMentionsTarget(logContent: string, target: string, matchingSourcePages: string[]): boolean {
  const matchers = [...buildTargetMatchers(target), ...matchingSourcePages.map((file) => path.basename(file))];
  return matchers.some((token) => token.length > 0 && logContent.includes(token));
}

function isProbablyUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

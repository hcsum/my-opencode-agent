import fs from "node:fs";
import path from "node:path";

const WORKSPACE_ROOT = process.cwd();
const WIKI_ROOT = path.join(WORKSPACE_ROOT, "knowledge", "wiki");
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
    errors.push("Ingest did not update knowledge/wiki/index.md.");
  }

  if (!fileChanged(input.before.files, input.after.files, "log.md")) {
    errors.push("Ingest did not append or update knowledge/wiki/log.md.");
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

function validateFileIngest(input: {
  targetPath: string;
  sourcePages: string[];
  after: Map<string, string>;
  errors: string[];
  warnings: string[];
}): void {
  if (input.sourcePages.length === 0) {
    input.errors.push("File ingest did not create or update any source page under knowledge/wiki/sources/.");
    return;
  }

  const relativeTarget = path.relative(WORKSPACE_ROOT, input.targetPath) || input.targetPath;
  const matchingSourcePages = input.sourcePages.filter((file) => {
    const content = input.after.get(file) || "";
    return content.includes(input.targetPath) || content.includes(relativeTarget);
  });

  if (matchingSourcePages.length === 0) {
    input.errors.push(
      `No changed source page records the ingested source path (${relativeTarget}).`,
    );
    return;
  }

  const sourceContent = safeReadFile(input.targetPath);
  const sourceLineCount = countNonEmptyLines(sourceContent);

  for (const page of matchingSourcePages) {
    const content = input.after.get(page) || "";

    if (content.length < 400) {
      input.warnings.push(`${page} is very short and may be too shallow for a durable source page.`);
    }

    if (!/source path:/i.test(content)) {
      input.errors.push(`${page} is missing a Source path record.`);
    }

    if (!/key points/i.test(content) && !/durable takeaways/i.test(content)) {
      input.errors.push(`${page} is missing the expected summary sections for a source page.`);
    }

    if (sourceLineCount >= 40 && countMarkdownBullets(content) < 4) {
      input.warnings.push(`${page} may be under-structured relative to the source length.`);
    }

    if (containsFormula(sourceContent) && !containsFormula(content)) {
      input.warnings.push(`${page} does not preserve any formula-like content from the source.`);
    }
  }
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

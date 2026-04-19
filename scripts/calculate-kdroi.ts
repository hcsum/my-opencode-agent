import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUTPUT_DECIMALS = 2;
export const DEFAULT_COLUMNS_TO_REMOVE = [
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

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  if (!inputPath) {
    throw new Error("Usage: npx tsx scripts/calculate-kdroi.ts <keywords.csv>");
  }

  await updateKdroi(inputPath, DEFAULT_PROCESSING_OPTIONS);
}

export async function updateKdroi(
  inputPath: string,
  options: { removeColumns?: string[]; topRows?: number } = {},
): Promise<void> {
  const { removeColumns = [], topRows } = options;

  const resolvedPath = path.resolve(inputPath);
  const raw = await fs.readFile(resolvedPath, "utf8");
  const rows = parseCsv(raw);

  if (rows.length === 0) {
    throw new Error(`CSV is empty: ${resolvedPath}`);
  }

  const [header, ...body] = rows;
  if (removeColumns.length > 0) {
    removeColumnsFromRows(header, body, removeColumns);
  }

  const volumeIndex = header.indexOf("Search Volume");
  const cpcIndex = header.indexOf("CPC");
  const kdIndex = header.indexOf("Keyword Difficulty");

  if (volumeIndex === -1 || cpcIndex === -1 || kdIndex === -1) {
    throw new Error(
      'CSV must include columns: "Search Volume", "CPC", and "Keyword Difficulty"',
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

  body.sort((left, right) => compareKdroi(right[kdroiIndex], left[kdroiIndex]));

  if (typeof topRows === "number" && topRows > 0 && body.length > topRows) {
    body.splice(topRows);
  }

  const output = [header, ...body].map(formatCsvRow).join("\n");
  await fs.writeFile(resolvedPath, `${output}\n`, "utf8");

  console.log(`Updated kdroi for ${body.length} rows in ${resolvedPath}`);
}

export const DEFAULT_PROCESSING_OPTIONS = {
  removeColumns: DEFAULT_COLUMNS_TO_REMOVE,
  topRows: DEFAULT_TOP_ROWS,
} as const;

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

  const value = (searchVolume * cpc) / kd;
  return value.toFixed(OUTPUT_DECIMALS);
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error("[calculate-kdroi] failed", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

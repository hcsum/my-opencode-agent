import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DOWNLOADS = path.join(os.homedir(), "Downloads");
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../..");

type Kind = "backlinks" | "refdomains" | "keywords" | "unknown";

const BACKLINK_KEEP = [
  "Page ascore",
  "Source url",
  "Target url",
  "Nofollow",
  "First seen",
  "Last seen",
] as const;

function classify(name: string): Kind {
  const n = name.toLowerCase();
  if (n.includes("backlinks_refdomains")) return "refdomains";
  if (n.includes("-backlinks")) return "backlinks";
  if (n.includes("organic.positions") || n.includes("-keywords")) return "keywords";
  return "unknown";
}

function destDir(kind: Kind): string {
  if (kind === "keywords") return path.join(REPO, "notes/seo/site-keywords");
  return path.join(REPO, "notes/seo/site-backlinks");
}

function newest(globPattern?: string): string {
  if (!fs.existsSync(DOWNLOADS)) fail(`Downloads folder not found: ${DOWNLOADS}`);
  const files = fs
    .readdirSync(DOWNLOADS)
    .filter((f: string) => f.toLowerCase().endsWith(".csv"))
    .filter((f: string) => (globPattern ? f.includes(globPattern) : true))
    .map((f: string) => ({ f, m: fs.statSync(path.join(DOWNLOADS, f)).mtimeMs }))
    .sort((a: { m: number }, b: { m: number }) => b.m - a.m);
  if (!files.length)
    fail(`No CSV found in ${DOWNLOADS}${globPattern ? ` matching "${globPattern}"` : ""}`);
  return files[0].f;
}

function fail(msg: string): never {
  console.error(msg);
  (globalThis as any).process.exit(1);
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") {
        row.push(cell);
        cell = "";
      } else if (c === "\n") {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else if (c === "\r") {
        // skip
      } else cell += c;
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function formatCsv(rows: string[][]): string {
  const esc = (v: string) =>
    /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  return rows.map((r: string[]) => r.map(esc).join(",")).join("\n") + "\n";
}

function processBacklinks(filePath: string): { kept: number; dropped: number } {
  const raw = fs.readFileSync(filePath, "utf8");
  const rows = parseCsv(raw).filter((r: string[]) => r.some((c: string) => c !== ""));
  if (rows.length === 0) fail(`Empty CSV: ${filePath}`);
  const header = rows[0];
  const keepIdx = BACKLINK_KEEP.map((col) => {
    const i = header.indexOf(col);
    if (i === -1) fail(`Column missing from ${filePath}: ${col}`);
    return i;
  });
  const ascoreIdx = BACKLINK_KEEP.indexOf("Page ascore");
  const lastSeenIdx = BACKLINK_KEEP.indexOf("Last seen");
  const body = rows.slice(1).map((r: string[]) => keepIdx.map((i) => r[i] ?? ""));
  body.sort((a: string[], b: string[]) => {
    const da = (parseInt(a[ascoreIdx]) || 0) - (parseInt(b[ascoreIdx]) || 0);
    if (da !== 0) return -da;
    return (b[lastSeenIdx] || "").localeCompare(a[lastSeenIdx] || "");
  });
  const out: string[][] = [Array.from(BACKLINK_KEEP), ...body];
  fs.writeFileSync(filePath, formatCsv(out));
  return { kept: body.length, dropped: rows.length - 1 - body.length };
}

function main() {
  const argv = (globalThis as any).process.argv.slice(2) as string[];
  const filter = argv.find((a: string) => !a.startsWith("--"));
  const file = newest(filter);
  const src = path.join(DOWNLOADS, file);
  const kind = classify(file);
  const dir = destDir(kind);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, file.replace(/\s+/g, "-"));
  fs.renameSync(src, dest);
  const result: Record<string, unknown> = { moved: dest, kind, from: src };
  if (kind === "backlinks") {
    const stats = processBacklinks(dest);
    result.processed = stats;
  }
  console.log(JSON.stringify(result, null, 2));
}

main();

#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PATTERNS_DIR = path.join(ROOT, "references", "site-patterns");
const query = (process.argv[2] || "").trim();

if (!query || !fs.existsSync(PATTERNS_DIR)) {
  process.exit(0);
}

for (const entry of fs.readdirSync(PATTERNS_DIR, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith(".md")) continue;

  const domain = entry.name.replace(/\.md$/, "");
  const raw = fs.readFileSync(path.join(PATTERNS_DIR, entry.name), "utf8");
  const aliasesLine = raw.split(/\r?\n/).find((line) => line.startsWith("aliases:")) || "";
  const aliases = aliasesLine
    .replace(/^aliases:\s*/, "")
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = [domain, ...aliases].map(escaped).join("|");
  if (!pattern || !new RegExp(pattern, "i").test(query)) continue;

  const fences = [...raw.matchAll(/^---\s*$/gm)];
  const body = fences.length >= 2
    ? raw.slice(fences[1].index + fences[1][0].length).replace(/^\r?\n/, "")
    : raw;

  process.stdout.write(`--- 站点经验: ${domain} ---\n`);
  process.stdout.write(body.trimEnd() + "\n\n");
}

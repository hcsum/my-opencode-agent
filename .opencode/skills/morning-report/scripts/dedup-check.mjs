#!/usr/bin/env node
// Hard dedup gate for the morning report.
//
// Why this exists: the generic scheduler executor only injects prior outputs as
// a prose <prior_runs> block and trusts the model to exclude them. In practice
// the model re-published the same articles (the same The Verge column ran three
// days straight). This script makes the rule mechanical and morning-report-
// specific without touching the generic executor: it reads the ground-truth
// bodies of the task's recent runs from the report-history DB, extracts every
// URL, and flags any URL the draft reuses.
//
// Usage:  node dedup-check.mjs <draft-file> [--db <path>] [--keep <n>]
// Exit 0 + "OK" when clean; exit 1 and lists offending URLs when not.

import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const draftFile = process.argv[2];
if (!draftFile || draftFile.startsWith("--")) {
  console.error("usage: node dedup-check.mjs <draft-file> [--db <path>] [--keep <n>]");
  process.exit(2);
}
if (!existsSync(draftFile)) {
  console.error(`draft file not found: ${draftFile}`);
  process.exit(2);
}

// Resolve the DB the same way src/db.ts does (.data/gmail.db under the repo
// root / container workspace), with an override for unusual layouts.
const dbCandidates = [
  arg("--db", null),
  process.env.MORNING_REPORT_DB,
  path.join(process.cwd(), ".data", "gmail.db"),
  "/workspace/.data/gmail.db",
  "/opt/opencode-agent/.data/gmail.db",
].filter(Boolean);
const dbPath = dbCandidates.find((p) => existsSync(p));
if (!dbPath) {
  console.error(`could not locate gmail.db (looked in: ${dbCandidates.join(", ")})`);
  process.exit(2);
}

const keep = Number(arg("--keep", "2")) || 2;

// Normalize a URL so trivial differences (trailing slash/punctuation, fragment,
// case in scheme+host) don't let a literal repeat slip through.
function normalize(raw) {
  let u = raw.trim().replace(/[).,;,>\]'"`]+$/, "");
  try {
    const parsed = new URL(u);
    parsed.hash = "";
    let s = parsed.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s.toLowerCase();
  } catch {
    return u.replace(/\/+$/, "").toLowerCase();
  }
}

const URL_RE = /https?:\/\/[^\s)<>\]"'`]+/g;
function urlsOf(text) {
  const out = new Map(); // normalized -> first raw seen
  for (const m of text.matchAll(URL_RE)) {
    const n = normalize(m[0]);
    if (!out.has(n)) out.set(n, m[0]);
  }
  return out;
}

const Database = require("better-sqlite3");
const db = new Database(dbPath, { readonly: true });

const task = db
  .prepare(
    "SELECT id FROM scheduled_tasks WHERE summary LIKE '%Morning report%' ORDER BY created_at DESC LIMIT 1",
  )
  .get();

if (!task) {
  console.log("OK: no Morning report task / history found — nothing to dedup against.");
  process.exit(0);
}

const priors = db
  .prepare(
    "SELECT fire_time, body FROM scheduled_report_history WHERE task_id = ? ORDER BY id DESC LIMIT ?",
  )
  .all(task.id, keep);

if (priors.length === 0) {
  console.log("OK: no prior runs recorded yet — nothing to dedup against.");
  process.exit(0);
}

// normalized URL -> fire_time it appeared in (most recent wins for the label)
const banned = new Map();
for (const p of priors) {
  for (const n of urlsOf(p.body).keys()) {
    if (!banned.has(n)) banned.set(n, p.fire_time);
  }
}

const draft = readFileSync(draftFile, "utf8");
const draftUrls = urlsOf(draft);

const hits = [];
for (const [n, raw] of draftUrls) {
  if (banned.has(n)) hits.push({ raw, when: banned.get(n) });
}

if (hits.length === 0) {
  console.log(
    `OK: none of the draft's ${draftUrls.size} URL(s) reuse the last ${priors.length} run(s).`,
  );
  process.exit(0);
}

console.error(`DEDUP FAIL: ${hits.length} URL(s) already published in a recent run:\n`);
for (const h of hits) console.error(`  - ${h.raw}\n      (already used in run ${h.when})`);
console.error(
  "\nThese exact articles are banned. Remove each, or replace with a NEW URL and a one-line\n" +
    '"较昨日新增" delta, then re-run this check until it prints OK.',
);
process.exit(1);

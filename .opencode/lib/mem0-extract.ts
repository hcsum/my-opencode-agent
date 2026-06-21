import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { COLLECTION, getMemory, QDRANT_URL, USER_ID } from "./mem0-client";
import { judge, type ExistingMemory } from "./mem0-judge";

/**
 * Runtime-agnostic core of the idle-extraction write path, shared by both
 * memory adapters:
 *   - OpenCode plugin:  .opencode/plugin/mem0-memory.ts  (session.idle)
 *   - Claude Code hook: .opencode/lib/mem0-claude-hook.ts (Stop hook)
 *
 * Each adapter only NORMALIZES its runtime's messages into `NormMsg[]` (opencode
 * reads session.messages; claude parses the transcript JSONL) and calls
 * `runExtraction`. Everything that defines the BEHAVIOR — the per-session
 * watermark, fresh-message slicing, the min-size gate, explicit-keyword tagging
 * — lives here so the two runtimes cannot drift apart.
 *
 * Plan A: we OWN extraction. Rather than `mem.add(infer:true)` (mem0's
 * high-recall extractor picks facts, then we delete junk after the fact), we
 * `mem.search` the existing store for dedup context, run our own gated judge
 * (mem0-judge.ts), and apply its explicit ADD/UPDATE decisions with
 * `infer:false`. mem0 is reduced to vector store + retrieval; junk never lands.
 */

export const WATERMARK_REL = ".data/memory-extract-watermark.json";
export const MAX_NEW_MESSAGES = 40;
export const MAX_TRANSCRIPT_CHARS = 24_000;
export const MIN_TRANSCRIPT_CHARS = 40;
// How many existing memories to pull as dedup/UPDATE context for the judge.
export const DEDUP_SEARCH_LIMIT = 12;
export const EXACT_DEDUP_PAGE_SIZE = 256;
export const EXACT_DEDUP_SCAN_MAX = 2_000;

const CN_KEYWORD_RE = /(记住|记一下|记下|存一下|帮我记)/i;
const EN_KEYWORD_RE = /(^|[\n.!?]\s*)(please\s+)?(remember\b|save this\b|note this down\b|don'?t forget\b)/i;
const CODE_BLOCK_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`]+`/g;
const BAD_MEMORY_PATTERNS: RegExp[] = [
  /^(user|assistant)\s+(asked|instructed|requested|told|advised|recommended|planned|checked|created|fixed|debugged|researched|committed|pushed)\b/i,
  /^(the\s+)?(deliverable|report|summary|artifact|research|task|runbook|cleanup|migration)\b.*\b(was|were|is|are)\b/i,
  /\b(on|as of)\s+20\d{2}-\d{2}-\d{2}\b/i,
  /\b(qdrant|collection|vector store|api|token|oauth|credential|invalid_grant|snapshot|watermark|debounce|session\.idle)\b/i,
  /\bcontains?\s+\d+\s+(points|entries|memories|records)\b/i,
];

function shouldRejectStoredMemory(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return true;
  if (normalized.length > 220) return true;
  const sentences = normalized.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length > 2) return true;
  return BAD_MEMORY_PATTERNS.some((re) => re.test(normalized));
}

export function normalizeFactText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[。！？.!?]+$/gu, "")
    .toLowerCase();
}

export function factKeyForText(text: string): string {
  return createHash("sha256").update(normalizeFactText(text)).digest("hex");
}

interface ExactMemoryMatch {
  id: string;
  memory: string;
}

function payloadText(payload: Record<string, unknown> | null | undefined): string {
  if (!payload) return "";
  if (typeof payload.data === "string") return payload.data;
  if (typeof payload.memory === "string") return payload.memory;
  return "";
}

async function qdrantScroll(body: Record<string, unknown>) {
  const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION}/points/scroll`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`qdrant ${res.status}`);
  return (await res.json()) as {
    result?: {
      points?: Array<{ id?: string | number; payload?: Record<string, unknown> | null }>;
      next_page_offset?: unknown;
    };
  };
}

async function findExactMemoryMatch(text: string): Promise<ExactMemoryMatch | null> {
  const normalized = normalizeFactText(text);
  if (!normalized) return null;

  const factKey = factKeyForText(text);
  try {
    const exact = await qdrantScroll({
      limit: 1,
      with_payload: true,
      with_vector: false,
      filter: {
        must: [
          { key: "user_id", match: { value: USER_ID } },
          { key: "factKey", match: { value: factKey } },
        ],
      },
    });
    const hit = exact.result?.points?.[0];
    const memory = payloadText(hit?.payload);
    if (hit?.id && memory) return { id: String(hit.id), memory };
  } catch {
    // Fall through to the normalized-text scan below.
  }

  let offset: unknown = undefined;
  let scanned = 0;
  while (scanned < EXACT_DEDUP_SCAN_MAX) {
    const page = await qdrantScroll({
      limit: EXACT_DEDUP_PAGE_SIZE,
      with_payload: true,
      with_vector: false,
      ...(offset !== undefined ? { offset } : {}),
      filter: { must: [{ key: "user_id", match: { value: USER_ID } }] },
    });
    const points = page.result?.points ?? [];
    for (const point of points) {
      const memory = payloadText(point.payload);
      if (!memory) continue;
      if (normalizeFactText(memory) === normalized && point.id) {
        return { id: String(point.id), memory };
      }
    }
    scanned += points.length;
    offset = page.result?.next_page_offset;
    if (!offset || points.length === 0) break;
  }

  return null;
}

/** True if `text` carries an explicit "记住 / remember" instruction (code spans
 * stripped first so a keyword inside a fenced block doesn't trigger). */
export function detectKeyword(text: string): boolean {
  const stripped = text.replace(CODE_BLOCK_RE, "").replace(INLINE_CODE_RE, "");
  return CN_KEYWORD_RE.test(stripped) || EN_KEYWORD_RE.test(stripped);
}

/** A conversation turn normalized across runtimes. `id` is the runtime's stable
 * per-message id (opencode message id / claude transcript uuid) — used as the
 * watermark cursor. */
export type NormMsg = { id: string; role: string; text: string };

export function readWatermarks(root: string): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, WATERMARK_REL), "utf8"));
  } catch {
    return {};
  }
}

export function writeWatermark(root: string, sessionID: string, lastMessageID: string) {
  const watermarkPath = path.join(root, WATERMARK_REL);
  const all = readWatermarks(root);
  all[sessionID] = lastMessageID;
  fs.mkdirSync(path.dirname(watermarkPath), { recursive: true });
  fs.writeFileSync(watermarkPath, JSON.stringify(all, null, 2));
}

export interface ExtractOptions {
  root: string;
  sessionID: string;
  /** All turns of the session, oldest→newest, already normalized. */
  messages: NormMsg[];
  /** Provenance tag stored in metadata.runtime ("opencode" | "claude"). */
  runtime: string;
  /**
   * Decides whether THIS batch is tagged source:"explicit". Called at most once,
   * and only when we're actually committing an add — so an early return (no
   * fresh messages) does not consume a pending explicit flag. If omitted, the
   * fresh user messages are scanned for a "记住/remember" keyword instead.
   */
  consumeExplicit?: () => boolean;
}

export type ExtractResult =
  | { status: "added"; latestID: string }
  | { status: "skipped"; reason: "empty" | "no-fresh" | "too-short" | "no-memory" | "nothing" };

/**
 * Commit the new messages since the watermark to mem0. Returns "added" only when
 * a real write (ADD/UPDATE) happened (so the caller can run snapshot/compaction
 * cadence); "skipped" otherwise. The watermark is advanced on every outcome
 * EXCEPT "no-memory" (store down → retry next turn) and "empty". "nothing" means
 * we ran the judge and it found no durable fact — the common, healthy outcome.
 */
export async function runExtraction(opts: ExtractOptions): Promise<ExtractResult> {
  const { root, sessionID, messages, runtime } = opts;
  if (messages.length === 0) return { status: "skipped", reason: "empty" };

  const last = readWatermarks(root)[sessionID];
  let startIdx = 0;
  if (last) {
    const found = messages.findIndex((m) => m.id === last);
    startIdx = found >= 0 ? found + 1 : Math.max(0, messages.length - MAX_NEW_MESSAGES);
  }
  const fresh = messages.slice(startIdx).slice(-MAX_NEW_MESSAGES);
  const latestID = messages[messages.length - 1].id;

  if (fresh.length === 0) {
    writeWatermark(root, sessionID, latestID);
    return { status: "skipped", reason: "no-fresh" };
  }

  const explicit = opts.consumeExplicit
    ? opts.consumeExplicit()
    : fresh.some((m) => m.role === "user" && detectKeyword(m.text));
  const transcript = fresh
    .filter((m) => m.text.trim())
    .map((m) => `### ${m.role}\n${m.text}`)
    .join("\n\n")
    .slice(-MAX_TRANSCRIPT_CHARS);

  // Explicit remember/记住 should still be judged even when the excerpt is very
  // short; the user already singled this fact out for memory.
  if (!explicit && transcript.trim().length < MIN_TRANSCRIPT_CHARS) {
    writeWatermark(root, sessionID, latestID);
    return { status: "skipped", reason: "too-short" };
  }

  const mem = getMemory();
  // Disabled (no key / down): leave watermark unmoved so we retry next turn.
  if (!mem) return { status: "skipped", reason: "no-memory" };

  const source = explicit ? "explicit" : "auto-idle";

  // Pull existing memories semantically near this excerpt as advisory context for
  // the judge. Final dedup is fact-level and deterministic at write time.
  let existing: ExistingMemory[] = [];
  try {
    const sr = await mem.search(transcript.slice(-2000), {
      filters: { user_id: USER_ID },
      topK: DEDUP_SEARCH_LIMIT,
    });
    existing = (sr.results ?? [])
      .map((m) => ({ id: String(m.id), memory: String(m.memory ?? "") }))
      .filter((m) => m.id && m.memory);
  } catch {
    existing = [];
  }

  const decisions = await judge(transcript, existing, explicit);

  // sessionId is provenance metadata, NOT runId — long-term user memory is one
  // pool keyed by user_id so facts dedup across sessions AND runtimes; a
  // per-session runId would silo dedup and let the same fact re-accumulate.
  const batchFactKeys = new Set<string>();
  let wrote = 0;
  for (const d of decisions) {
    // Deterministic backstop: even a gated judge can slip; drop obvious junk.
    if (shouldRejectStoredMemory(d.text)) continue;
    const normalizedText = normalizeFactText(d.text);
    if (!normalizedText) continue;
    const factKey = factKeyForText(d.text);
    if (batchFactKeys.has(factKey)) continue;
    try {
      if (d.action === "ADD") {
        const exact = await findExactMemoryMatch(d.text);
        if (exact) {
          if (exact.memory !== d.text) {
            await mem.update(exact.id, { text: d.text });
            wrote++;
          }
          batchFactKeys.add(factKey);
          continue;
        }
        // infer:false → store the fact verbatim; we already did the extraction.
        await mem.add([{ role: "user", content: d.text }], {
          userId: USER_ID,
          metadata: { source, sessionId: sessionID, runtime, factKey },
          infer: false,
        });
      } else {
        await mem.update(d.id, { text: d.text });
      }
      batchFactKeys.add(factKey);
      wrote++;
    } catch {
      // Best-effort; one failed write should not block the session watermark.
    }
  }

  writeWatermark(root, sessionID, latestID);
  return wrote > 0 ? { status: "added", latestID } : { status: "skipped", reason: "nothing" };
}

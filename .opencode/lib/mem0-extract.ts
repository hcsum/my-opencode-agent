import fs from "node:fs";
import path from "node:path";

import { getMemory, USER_ID } from "./mem0-client";

/**
 * Runtime-agnostic core of the idle-extraction write path, shared by both
 * memory adapters:
 *   - OpenCode plugin:  .opencode/plugin/mem0-memory.ts  (session.idle)
 *   - Claude Code hook: .opencode/lib/mem0-claude-hook.ts (Stop hook)
 *
 * Each adapter only NORMALIZES its runtime's messages into `NormMsg[]` (opencode
 * reads session.messages; claude parses the transcript JSONL) and calls
 * `runExtraction`. Everything that defines the BEHAVIOR — the per-session
 * watermark, fresh-message slicing, the min-size gate, explicit-keyword tagging,
 * and the `mem.add(infer:true)` against the shared store — lives here so the two
 * runtimes cannot drift apart.
 */

export const WATERMARK_REL = ".data/memory-extract-watermark.json";
export const MAX_NEW_MESSAGES = 40;
export const MAX_TRANSCRIPT_CHARS = 24_000;
export const MIN_TRANSCRIPT_CHARS = 40;

export const KEYWORD_RE =
  /(记住|记一下|记下|存一下|帮我记|remember (this|that)|save this|note this down|don'?t forget)/i;
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

/** True if `text` carries an explicit "记住 / remember" instruction (code spans
 * stripped first so a keyword inside a fenced block doesn't trigger). */
export function detectKeyword(text: string): boolean {
  const stripped = text.replace(CODE_BLOCK_RE, "").replace(INLINE_CODE_RE, "");
  return KEYWORD_RE.test(stripped);
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
  | { status: "skipped"; reason: "empty" | "no-fresh" | "too-short" | "no-memory" };

/**
 * Commit the new messages since the watermark to mem0. Returns "added" only when
 * a real `mem.add` happened (so the caller can run snapshot/compaction cadence);
 * "skipped" otherwise. The watermark is advanced on every outcome EXCEPT
 * "no-memory" (so a disabled/down store is retried on the next turn) and "empty".
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

  const transcript = fresh
    .filter((m) => m.text.trim())
    .map((m) => `### ${m.role}\n${m.text}`)
    .join("\n\n")
    .slice(-MAX_TRANSCRIPT_CHARS);

  if (transcript.trim().length < MIN_TRANSCRIPT_CHARS) {
    writeWatermark(root, sessionID, latestID);
    return { status: "skipped", reason: "too-short" };
  }

  const mem = getMemory();
  // Disabled (no key / down): leave watermark unmoved so we retry next turn.
  if (!mem) return { status: "skipped", reason: "no-memory" };

  const explicit = opts.consumeExplicit
    ? opts.consumeExplicit()
    : fresh.some((m) => m.role === "user" && detectKeyword(m.text));
  const source = explicit ? "explicit" : "auto-idle";

  const addResult = await mem.add(transcript, {
    userId: USER_ID,
    // sessionId is provenance metadata, NOT runId — long-term user memory is one
    // pool keyed by user_id so facts dedup across sessions AND runtimes; a
    // per-session runId would silo dedup and let the same fact re-accumulate.
    metadata: { source, sessionId: sessionID, runtime },
    infer: true,
  });
  const results = Array.isArray((addResult as { results?: unknown[] }).results)
    ? ((addResult as { results: Array<{ id?: string; memory?: string; event?: string }> }).results)
    : [];
  for (const item of results) {
    if (!item?.id || !item.memory) continue;
    if (!shouldRejectStoredMemory(item.memory)) continue;
    try {
      await mem.delete(item.id);
    } catch {
      // Best-effort cleanup; a failed delete should not block the session watermark.
    }
  }
  writeWatermark(root, sessionID, latestID);
  return { status: "added", latestID };
}

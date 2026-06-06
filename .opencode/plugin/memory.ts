import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import type { Plugin } from "@opencode-ai/plugin";

/**
 * Memory capture + maintenance plugin for the OpenCode interactive client.
 *
 * Write triggers (see docs/memory-feature-design.md §3.4):
 *   - Mechanism 4 (instant): `chat.message` regex-detects a memory keyword in the
 *     user's message and injects a synthetic instruction forcing the model to save
 *     the fact now via its normal write/edit tools, following .opencode/memory/PROTOCOL.md.
 *   - Mechanism 3 (true auto): `event` watches `session.idle`; debounced so it fires
 *     once the user has actually paused. It reads new messages since the last watermark,
 *     asks a cheap model to extract durable memories (deduped against the existing index),
 *     and writes them to notes/memory/*.md.
 *
 * Maintenance (see §10.4 / §11 — periodic compaction):
 *   - Layer A (lint, no LLM): MEMORY.md is REGENERATED from the files' frontmatter on every
 *     maintenance pass. Files are the source of truth; the index is a pure derivative, so
 *     index<->body drift cannot accumulate.
 *   - Layer B (compaction, LLM): churn-triggered. Once enough entries have been added/updated
 *     since the last pass, a cheap model reads the WHOLE store and reconciles it — merge
 *     near-duplicates, delete stale/superseded entries, rewrite, and FLAG (never silently
 *     resolve) genuine contradictions. Applied automatically, but a git checkpoint commit in
 *     the notes repo is taken first so any bad pass is `git revert`-able. No git => no compaction.
 *
 * Recall is handled outside this plugin: .opencode/memory/PROTOCOL.md (rules, in main repo) and
 * notes/memory/MEMORY.md (the index, content in notes) are loaded every session via `instructions`
 * in .opencode/opencode.json.
 */

const MEMORY_SUBDIR = "notes/memory";
const INDEX_FILE = "MEMORY.md";
const CONFLICTS_FILE = "_CONFLICTS.md";
const WATERMARK_REL = ".data/memory-extract-watermark.json";
const COMPACT_STATE_REL = ".data/memory-compact-state.json";

// Cheap model for the background extraction/compaction passes. The whole point of
// these passes (design §3.4) is a cheap LLM call, NOT the expensive session model
// (openai/gpt-5.4). Default to its cheap sibling; override via env per task.
const DEFAULT_MAINT_MODEL = "openai/gpt-5-mini";

const DEBOUNCE_MS = Number(process.env.MEMORY_EXTRACT_DEBOUNCE_MS) || 60_000;
const EXTRACT_ENABLED = process.env.MEMORY_EXTRACT_ENABLED !== "0";
const EXTRACT_MODEL = process.env.MEMORY_EXTRACT_MODEL || DEFAULT_MAINT_MODEL; // "providerID/modelID"
const MAX_NEW_MESSAGES = 40;
const MAX_TRANSCRIPT_CHARS = 24_000;
const MAX_EXTRACT_CONTEXT_CHARS = 12_000;

const COMPACT_ENABLED = process.env.MEMORY_COMPACT_ENABLED !== "0";
const COMPACT_CHURN_THRESHOLD = Number(process.env.MEMORY_COMPACT_CHURN) || 8;
const COMPACT_MIN_ENTRIES = Number(process.env.MEMORY_COMPACT_MIN_ENTRIES) || 2;
const COMPACT_INTERVAL_MS = Number(process.env.MEMORY_COMPACT_INTERVAL_MS) || 12 * 60 * 60 * 1000;
const COMPACT_POLL_MS = Math.max(
  60_000,
  Math.min(COMPACT_INTERVAL_MS, Number(process.env.MEMORY_COMPACT_POLL_MS) || 10 * 60 * 1000),
);
const COMPACT_MODEL = process.env.MEMORY_COMPACT_MODEL || EXTRACT_MODEL; // optional; defaults to EXTRACT_MODEL
const MAX_COMPACT_CHARS = 60_000;

const KEYWORD_RE =
  /(记住|记一下|记下|存一下|帮我记|remember (this|that)|save this|note this down|don'?t forget)/i;
const CODE_BLOCK_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`]+`/g;

const TYPES = ["user", "feedback", "project", "reference"] as const;

const KEYWORD_NUDGE = `[MEMORY TRIGGER]
The user asked you to remember something. Before finishing this turn you MUST persist it following .opencode/memory/PROTOCOL.md:
1. Pick a type (user | feedback | project | reference) and a kebab-case name.
2. Write/update notes/memory/<type>-<name>.md with the frontmatter + body the protocol specifies (check for an existing file first and update it instead of duplicating).
3. The MEMORY.md index is auto-regenerated from file frontmatter — just make sure the file's \`description\` is a good one-line recall hook.
Do not skip this. Keep the memory concise and reusable.`;

type MemoryType = (typeof TYPES)[number];

interface CompactState {
  churn: number;
  lastAttemptedAt?: string;
  lastCompactedAt?: string;
  lastReason?: string;
  lastOutcome?: string;
  lastConflictCount?: number;
}

interface MemoryOp {
  action: "add" | "update";
  type: MemoryType;
  name: string; // kebab-case slug
  title?: string;
  description: string; // one-line hook for the index
  body: string;
}

type CompactOp =
  | {
      action: "merge";
      type: MemoryType;
      name: string;
      title?: string;
      description: string;
      body: string;
      sources: string[]; // filenames to fold in and delete
    }
  | { action: "delete"; file: string; reason?: string }
  | {
      action: "rewrite";
      type: MemoryType;
      name: string;
      title?: string;
      description: string;
      body: string;
    }
  | { action: "flag"; files: string[]; note: string };

const EXTRACT_SYSTEM = `You are a memory-extraction subroutine for a personal assistant.
You read an excerpt of a conversation between the user and Pikachū, plus the current memory index, and decide what is worth remembering long-term.

Record ONLY durable, reusable facts about the USER or about HOW TO WORK with them. Four categories:
- user: who the user is — role, identity, stable preferences, accounts, tools they use.
- feedback: a correction or confirmed way of working the user gave (include why it matters).
- project: an ongoing goal, task, or constraint not derivable from the repo itself.
- reference: a pointer to an external resource (URL, dashboard, ticket, file).

HARD BAR — do NOT record:
- transient task details, one-off requests, or anything specific to just this conversation
- general world knowledge or facts about the codebase that the repo already encodes
- anything already covered by an existing memory (dedupe; if it refines an existing one, use action "update" with that entry's name)
- speculation; only record what the user actually stated or confirmed

UPDATE rule: when action is "update", your "body" REPLACES the existing file in full. The existing memories are shown to you below — carry over their still-valid content and fold in the new detail. NEVER drop information that is still true.

Output ONLY a JSON array (no prose, no markdown fence). Each element:
{"action":"add"|"update","type":"user"|"feedback"|"project"|"reference","name":"kebab-case-slug","title":"Short Title","description":"one-line hook for the index","body":"the fact; for feedback/project add a line starting with 'Why:' explaining the reason"}
If nothing meets the bar, output exactly: []`;

const COMPACT_SYSTEM = `You are a memory-compaction subroutine for a personal assistant's long-term memory store.
You receive the FULL set of memory files (each: filename + frontmatter + body) and produce a reconciliation plan as a JSON array of operations.

Be CONSERVATIVE. This store is the assistant's durable knowledge about the user; wrongly deleting or merging loses real information. A git checkpoint exists, but still prefer keeping over losing.

Operations (output ONLY a JSON array, no prose, no markdown fence):
- merge near-duplicates that state the SAME fact across different files:
  {"action":"merge","type":"user|feedback|project|reference","name":"kebab-slug","title":"Short Title","description":"one-line recall hook","body":"the merged fact","sources":["file-a.md","file-b.md"]}
  (writes the merged memory, then deletes every file in "sources")
- delete a memory that is clearly stale or fully superseded by another:
  {"action":"delete","file":"feedback-old-thing.md","reason":"superseded by feedback-new-thing.md"}
- rewrite to tighten or correct ONE memory in place (keep the same name):
  {"action":"rewrite","type":"...","name":"existing-slug","title":"Short Title","description":"...","body":"..."}
- flag a genuine CONTRADICTION you cannot resolve (you cannot tell which fact is current). Keep BOTH, do not pick:
  {"action":"flag","files":["a.md","b.md"],"note":"contradict on X — user must resolve"}

HARD RULES:
- Only merge when the facts are unmistakably the SAME. Different facts about the same topic stay separate.
- Only delete when clearly stale or fully superseded. If unsure, keep it.
- For a contradiction where you cannot determine the current truth, use "flag" — NEVER "delete" one side on a guess.
- Operate only on the listed files. Never reference user.md or the index.
- Preserve [[links]] and any "Why:" / "How to apply:" lines when merging or rewriting.
If the store is already clean, output exactly: []`;

export const MemoryPlugin: Plugin = async (ctx) => {
  const root = ctx.directory;
  const memoryDir = path.join(root, MEMORY_SUBDIR);
  const notesRepoRoot = path.dirname(memoryDir); // <root>/notes
  const indexPath = path.join(memoryDir, INDEX_FILE);
  const conflictsPath = path.join(memoryDir, CONFLICTS_FILE);
  const watermarkPath = path.join(root, WATERMARK_REL);
  const compactStatePath = path.join(root, COMPACT_STATE_REL);

  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const running = new Set<string>();
  let compactRunning = false;
  let maintenanceTimer: ReturnType<typeof setInterval> | undefined;
  // Sessions this plugin created for extraction/compaction — their idle events must be
  // ignored, otherwise maintenance would recursively trigger itself.
  const internalSessions = new Set<string>();

  const log = (msg: string, extra?: Record<string, unknown>) => {
    try {
      console.error(`[memory] ${msg}${extra ? " " + JSON.stringify(extra) : ""}`);
    } catch {
      /* ignore */
    }
  };

  // ---- state files -------------------------------------------------------

  function readWatermarks(): Record<string, string> {
    try {
      return JSON.parse(fs.readFileSync(watermarkPath, "utf8"));
    } catch {
      return {};
    }
  }

  function writeWatermark(sessionID: string, lastMessageID: string) {
    const all = readWatermarks();
    all[sessionID] = lastMessageID;
    fs.mkdirSync(path.dirname(watermarkPath), { recursive: true });
    fs.writeFileSync(watermarkPath, JSON.stringify(all, null, 2));
  }

  function readCompactState(): CompactState {
    try {
      const parsed = JSON.parse(fs.readFileSync(compactStatePath, "utf8"));
      return {
        churn: Number(parsed?.churn) || 0,
        lastAttemptedAt: typeof parsed?.lastAttemptedAt === "string" ? parsed.lastAttemptedAt : undefined,
        lastCompactedAt: typeof parsed?.lastCompactedAt === "string" ? parsed.lastCompactedAt : undefined,
        lastReason: typeof parsed?.lastReason === "string" ? parsed.lastReason : undefined,
        lastOutcome: typeof parsed?.lastOutcome === "string" ? parsed.lastOutcome : undefined,
        lastConflictCount: Number.isFinite(parsed?.lastConflictCount) ? Number(parsed.lastConflictCount) : undefined,
      };
    } catch {
      return { churn: 0 };
    }
  }

  function writeCompactState(state: CompactState) {
    fs.mkdirSync(path.dirname(compactStatePath), { recursive: true });
    fs.writeFileSync(
      compactStatePath,
      JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2),
    );
  }

  function bumpChurn(delta: number) {
    const state = readCompactState();
    writeCompactState({
      ...state,
      churn: Math.max(0, state.churn + delta),
    });
  }

  function settleCompactState(start: CompactState, patch: Omit<CompactState, "churn">) {
    const latest = readCompactState();
    writeCompactState({
      ...latest,
      ...patch,
      churn: Math.max(0, latest.churn - start.churn),
    });
  }

  function compactAgeMs(iso?: string): number | null {
    if (!iso) return null;
    const ts = Date.parse(iso);
    if (!Number.isFinite(ts)) return null;
    return Date.now() - ts;
  }

  function periodicCompactionDue(state: CompactState): boolean {
    const age = compactAgeMs(state.lastAttemptedAt || state.lastCompactedAt);
    return age === null || age >= COMPACT_INTERVAL_MS;
  }

  // ---- parsing / rendering ----------------------------------------------

  function detectKeyword(text: string): boolean {
    const stripped = text.replace(CODE_BLOCK_RE, "").replace(INLINE_CODE_RE, "");
    return KEYWORD_RE.test(stripped);
  }

  function fileNameFor(op: { type: string; name: string }): string {
    const safeType = op.type.replace(/[^a-z]/g, "");
    const safeName =
      op.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || "note";
    return `${safeType}-${safeName}.md`;
  }

  function renderMemoryFile(op: { name: string; title?: string; description: string; type: string; body: string }): string {
    const titleLine = op.title ? `title: ${op.title.replace(/\n/g, " ")}\n` : "";
    return `---
name: ${op.name}
${titleLine}description: ${op.description.replace(/\n/g, " ")}
metadata:
  type: ${op.type}
---

${op.body.trim()}
`;
  }

  function parseFrontmatter(
    content: string,
  ): { name?: string; title?: string; description?: string; type?: string } | null {
    const m = content.match(/^---\n([\s\S]*?)\n---/);
    if (!m) return null;
    const fm: Record<string, string> = {};
    for (const line of m[1].split("\n")) {
      const mm = line.match(/^\s*(name|title|description|type):\s*(.*\S)?\s*$/);
      if (mm && mm[2] !== undefined) fm[mm[1]] = mm[2].trim();
    }
    return fm;
  }

  function titleFromName(file: string): string {
    return file
      .replace(/\.md$/, "")
      .replace(/^(user|feedback|project|reference)-/, "")
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function parseModel(spec?: string): { providerID: string; modelID: string } | undefined {
    if (!spec) return undefined;
    const i = spec.indexOf("/");
    if (i < 0) return undefined;
    return { providerID: spec.slice(0, i), modelID: spec.slice(i + 1) };
  }

  function parseJsonArray(text: string): any[] {
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start < 0 || end <= start) return [];
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function messageText(
    parts: Array<{ type?: string; text?: string; synthetic?: boolean; ignored?: boolean }>,
  ): string {
    return parts
      .filter((p) => p.type === "text" && !p.synthetic && !p.ignored && p.text)
      .map((p) => p.text!.trim())
      .filter(Boolean)
      .join("\n");
  }

  // ---- index as a pure derivative of the files (Layer A) -----------------

  function listMemoryFiles(): string[] {
    try {
      return fs
        .readdirSync(memoryDir)
        .filter((f) => f.endsWith(".md") && f !== INDEX_FILE && !f.startsWith("_"));
    } catch {
      return [];
    }
  }

  /** Existing memories as full filename+frontmatter+body blocks, capped at maxChars so the
   * extractor can dedupe AND produce non-lossy "update" bodies (it sees what it's rewriting).
   * Falls back to the one-line index if even the budget can't fit a single body. */
  function readKnownMemories(maxChars: number): { text: string; full: boolean } {
    const files = listMemoryFiles().sort();
    if (files.length === 0) return { text: "(none yet)", full: true };
    const blocks: string[] = [];
    let total = 0;
    let full = true;
    for (const f of files) {
      let content = "";
      try {
        content = fs.readFileSync(path.join(memoryDir, f), "utf8").trim();
      } catch {
        continue;
      }
      const block = `FILE: ${f}\n${content}`;
      if (total + block.length > maxChars && blocks.length > 0) {
        full = false;
        break;
      }
      blocks.push(block);
      total += block.length;
    }
    if (blocks.length === 0) {
      try {
        return { text: fs.readFileSync(indexPath, "utf8"), full: false };
      } catch {
        return { text: "(none yet)", full: false };
      }
    }
    return { text: blocks.join("\n\n---\n\n"), full };
  }

  /** Regenerate MEMORY.md from the files' frontmatter. Files are the source of truth. */
  function rebuildIndex() {
    const files = listMemoryFiles().sort();
    const lines = [
      "# Memory Index",
      "",
      "<!-- Auto-generated from notes/memory/*.md frontmatter on each memory maintenance pass. Edit the .md files (the `description` field is the recall hook), not this index. -->",
      "",
    ];
    for (const f of files) {
      let fm: ReturnType<typeof parseFrontmatter> = null;
      try {
        fm = parseFrontmatter(fs.readFileSync(path.join(memoryDir, f), "utf8"));
      } catch {
        /* unreadable */
      }
      const title = (fm && fm.title) || titleFromName(f);
      const hook = fm && fm.description ? fm.description.replace(/\n/g, " ") : "(no description)";
      lines.push(`- [${title}](${f}) — ${hook}`);
    }
    if (fs.existsSync(conflictsPath)) {
      lines.push("");
      lines.push(`> ⚠ Unresolved memory conflicts recorded in \`${CONFLICTS_FILE}\` — reconcile when convenient.`);
    }
    fs.mkdirSync(memoryDir, { recursive: true });
    fs.writeFileSync(indexPath, lines.join("\n").replace(/\n*$/, "\n"));
  }

  // ---- extractor writes (Mechanism 3) ------------------------------------

  function applyOps(ops: MemoryOp[]): number {
    let n = 0;
    for (const op of ops) {
      if (!op || !op.name || !op.body || !op.type) continue;
      if (!TYPES.includes(op.type)) continue;
      try {
        fs.mkdirSync(memoryDir, { recursive: true });
        fs.writeFileSync(path.join(memoryDir, fileNameFor(op)), renderMemoryFile(op));
        n++;
      } catch (err) {
        log("write failed", { err: String(err) });
      }
    }
    return n;
  }

  // ---- headless model call (shared by extractor + compactor) -------------

  async function runHeadless(modelSpec: string | undefined, system: string, text: string): Promise<string> {
    const model = parseModel(modelSpec);
    const created = await ctx.client.session.create({
      body: { title: "memory-maint" },
      query: { directory: root },
    });
    const exId = created.data?.id;
    if (!exId) {
      log("headless: failed to create session");
      return "";
    }
    internalSessions.add(exId);
    try {
      const prompt = await ctx.client.session.prompt({
        path: { id: exId },
        query: { directory: root },
        body: {
          ...(model ? { model } : {}),
          system,
          parts: [{ type: "text", text }],
        },
      });
      return messageText((prompt.data?.parts ?? []) as any[]);
    } finally {
      try {
        await ctx.client.session.delete({ path: { id: exId }, query: { directory: root } });
      } catch {
        /* best effort */
      }
      internalSessions.delete(exId);
    }
  }

  async function extract(sessionID: string) {
    if (running.has(sessionID)) return;
    running.add(sessionID);
    try {
      const res = await ctx.client.session.messages({
        path: { id: sessionID },
        query: { directory: root },
      });
      const all = (res.data ?? []) as Array<{ info: { id: string; role: string }; parts: any[] }>;
      if (all.length === 0) return;

      const watermarks = readWatermarks();
      const last = watermarks[sessionID];
      let startIdx = 0;
      if (last) {
        const found = all.findIndex((m) => m.info.id === last);
        startIdx = found >= 0 ? found + 1 : Math.max(0, all.length - MAX_NEW_MESSAGES);
      }
      const fresh = all.slice(startIdx).slice(-MAX_NEW_MESSAGES);
      const latestID = all[all.length - 1].info.id;
      if (fresh.length === 0) {
        writeWatermark(sessionID, latestID);
        return;
      }

      const transcript = fresh
        .map((m) => {
          const t = messageText(m.parts);
          return t ? `### ${m.info.role}\n${t}` : "";
        })
        .filter(Boolean)
        .join("\n\n")
        .slice(-MAX_TRANSCRIPT_CHARS);

      if (transcript.trim().length < 40) {
        writeWatermark(sessionID, latestID);
        return;
      }

      const known = readKnownMemories(MAX_EXTRACT_CONTEXT_CHARS);

      const out = await runHeadless(
        EXTRACT_MODEL,
        EXTRACT_SYSTEM,
        `EXISTING MEMORIES${known.full ? "" : " (truncated — some omitted)"}:\n${known.text}\n\nCONVERSATION EXCERPT:\n${transcript}\n\nReturn the JSON array now.`,
      );
      const ops = parseJsonArray(out) as MemoryOp[];
      const wrote = applyOps(ops);
      if (wrote > 0) {
        rebuildIndex();
        bumpChurn(wrote);
      }
      log("extract done", { sessionID, newMessages: fresh.length, ops: ops.length, wrote });

      writeWatermark(sessionID, latestID);
      await maybeCompact();
    } catch (err) {
      log("extract error", { sessionID, err: String(err) });
    } finally {
      running.delete(sessionID);
    }
  }

  // ---- compaction (Layer B) ----------------------------------------------

  /** Take a revertable snapshot of the memory dir in the notes repo. Returns HEAD sha, or null
   * if there is no git safety net (in which case the caller MUST NOT apply destructive ops). */
  function gitCheckpoint(label: string): string | null {
    try {
      execFileSync("git", ["-C", notesRepoRoot, "rev-parse", "--is-inside-work-tree"], { stdio: "pipe" });
    } catch {
      return null; // notes is not a git repo here — no safety net
    }
    try {
      execFileSync("git", ["-C", notesRepoRoot, "add", "--", "memory"], { stdio: "pipe" });
      const dirty = execFileSync("git", ["-C", notesRepoRoot, "status", "--porcelain", "--", "memory"], {
        stdio: "pipe",
      })
        .toString()
        .trim();
      if (dirty) {
        execFileSync(
          "git",
          [
            "-C",
            notesRepoRoot,
            "-c",
            "user.email=memory@opencode-agent.local",
            "-c",
            "user.name=opencode-memory",
            "commit",
            "-m",
            `memory: ${label}`,
          ],
          { stdio: "pipe" },
        );
      }
      return execFileSync("git", ["-C", notesRepoRoot, "rev-parse", "HEAD"], { stdio: "pipe" })
        .toString()
        .trim();
    } catch (err) {
      log("git checkpoint failed", { err: String(err) });
      return null;
    }
  }

  function isSafeMemFile(f: unknown): f is string {
    return (
      typeof f === "string" &&
      /^[a-z0-9][a-z0-9-]*\.md$/.test(f) &&
      f !== INDEX_FILE &&
      f !== CONFLICTS_FILE &&
      !f.startsWith("_")
    );
  }

  function writeConflicts(flags: Array<{ files: string[]; note: string }>): number {
    const sanitized = flags.filter((fl) => fl.files.length > 0 && fl.note.trim().length > 0);
    if (sanitized.length === 0) {
      clearConflicts();
      return 0;
    }
    const lines = [
      "# Memory Conflicts",
      "",
      "<!-- Auto-generated by compaction. Each line is a contradiction the assistant could not resolve on its own; please reconcile the listed files. -->",
      "",
    ];
    for (const fl of sanitized) {
      lines.push(`- ${fl.files.join(", ")} — ${fl.note.replace(/\n/g, " ")}`);
    }
    fs.writeFileSync(conflictsPath, lines.join("\n") + "\n");
    return sanitized.length;
  }

  function clearConflicts() {
    try {
      if (fs.existsSync(conflictsPath)) fs.unlinkSync(conflictsPath);
    } catch {
      /* ignore */
    }
  }

  function applyCompact(ops: CompactOp[]) {
    const stats = { merged: 0, deleted: 0, rewritten: 0, flagged: 0 };
    const flags: Array<{ files: string[]; note: string }> = [];
    for (const op of ops) {
      try {
        if (op.action === "merge" && op.name && op.body && TYPES.includes(op.type)) {
          const file = fileNameFor(op);
          fs.writeFileSync(path.join(memoryDir, file), renderMemoryFile(op));
          for (const s of op.sources || []) {
            if (s !== file && isSafeMemFile(s)) {
              const p = path.join(memoryDir, s);
              if (fs.existsSync(p)) fs.unlinkSync(p);
            }
          }
          stats.merged++;
        } else if (op.action === "delete" && isSafeMemFile(op.file)) {
          const p = path.join(memoryDir, op.file);
          if (fs.existsSync(p)) {
            fs.unlinkSync(p);
            stats.deleted++;
          }
        } else if (op.action === "rewrite" && op.name && op.body && TYPES.includes(op.type)) {
          fs.writeFileSync(path.join(memoryDir, fileNameFor(op)), renderMemoryFile(op));
          stats.rewritten++;
        } else if (op.action === "flag" && Array.isArray(op.files) && op.files.length && op.note) {
          const files = op.files.filter(isSafeMemFile);
          if (files.length > 0) {
            flags.push({ files, note: op.note });
            stats.flagged++;
          }
        }
      } catch (err) {
        log("compact apply failed", { action: (op as any).action, err: String(err) });
      }
    }
    const conflictCount = writeConflicts(flags);
    return { ...stats, conflictCount };
  }

  async function compact(reason: "churn" | "periodic") {
    if (!COMPACT_ENABLED || compactRunning) return;
    compactRunning = true;
    const state = readCompactState();
    const attemptedAt = new Date().toISOString();
    try {
      const files = listMemoryFiles().sort();
      if (files.length < COMPACT_MIN_ENTRIES) return;

      const blocks = files
        .map((f) => `FILE: ${f}\n${fs.readFileSync(path.join(memoryDir, f), "utf8").trim()}`)
        .join("\n\n---\n\n");
      if (blocks.length > MAX_COMPACT_CHARS) {
        // Single-pass compaction can't fit the store; clustering is not implemented yet.
        // Reset churn so we don't retry on every write; the periodic timer will revisit it.
        settleCompactState(state, {
          lastAttemptedAt: attemptedAt,
          lastReason: reason,
          lastOutcome: "skipped-too-large",
        });
        log("compact skipped: store too large for single pass", { chars: blocks.length, files: files.length });
        return;
      }

      const sha = gitCheckpoint("pre-compaction checkpoint");
      if (!sha) {
        settleCompactState(state, {
          lastAttemptedAt: attemptedAt,
          lastReason: reason,
          lastOutcome: "aborted-no-git",
        });
        log("compact aborted: no git safety net in notes repo");
        return;
      }

      const out = await runHeadless(
        COMPACT_MODEL,
        COMPACT_SYSTEM,
        `CURRENT MEMORY STORE (${files.length} files):\n\n${blocks}\n\nReturn the JSON array now.`,
      );
      const ops = parseJsonArray(out) as CompactOp[];
      if (ops.length === 0) {
        clearConflicts();
        rebuildIndex();
        settleCompactState(state, {
          lastAttemptedAt: attemptedAt,
          lastCompactedAt: attemptedAt,
          lastReason: reason,
          lastOutcome: "noop",
          lastConflictCount: 0,
        });
        log("compact: store already clean", { checkpoint: sha, files: files.length });
        return;
      }

      const stats = applyCompact(ops);
      rebuildIndex();
      settleCompactState(state, {
        lastAttemptedAt: attemptedAt,
        lastCompactedAt: attemptedAt,
        lastReason: reason,
        lastOutcome: "applied",
        lastConflictCount: stats.conflictCount,
      });
      log("compact done", { checkpoint: sha, reason, files: files.length, ...stats });
    } catch (err) {
      log("compact error", { err: String(err) });
    } finally {
      compactRunning = false;
    }
  }

  async function maybeCompact() {
    if (!COMPACT_ENABLED || compactRunning) return;
    if (listMemoryFiles().length < COMPACT_MIN_ENTRIES) return;
    const state = readCompactState();
    const dueToChurn = state.churn >= COMPACT_CHURN_THRESHOLD;
    const dueToPeriod = periodicCompactionDue(state);
    if (!dueToChurn && !dueToPeriod) return;
    await compact(dueToChurn ? "churn" : "periodic");
  }

  // ---- scheduling --------------------------------------------------------

  function scheduleExtract(sessionID: string) {
    if (!EXTRACT_ENABLED) return;
    if (internalSessions.has(sessionID)) return;
    const existing = timers.get(sessionID);
    if (existing) clearTimeout(existing);
    timers.set(
      sessionID,
      setTimeout(() => {
        timers.delete(sessionID);
        void extract(sessionID);
      }, DEBOUNCE_MS),
    );
  }

  if (COMPACT_ENABLED) {
    maintenanceTimer = setInterval(() => {
      void maybeCompact();
    }, COMPACT_POLL_MS);
    maintenanceTimer.unref?.();
    void maybeCompact();
  }

  return {
    "chat.message": async (input, output) => {
      try {
        const text = messageText(output.parts as any[]);
        if (text && detectKeyword(text)) {
          output.parts.push({
            id: `prt_memory-nudge-${Date.now()}`,
            sessionID: input.sessionID,
            messageID: output.message.id,
            type: "text",
            text: KEYWORD_NUDGE,
            synthetic: true,
          } as any);
          log("keyword nudge injected", { sessionID: input.sessionID });
        }
      } catch (err) {
        log("chat.message error", { err: String(err) });
      }
    },

    event: async ({ event }) => {
      if (event.type === "session.idle") {
        const sid = event.properties.sessionID;
        scheduleExtract(sid);
        // Skip maintenance kicked off by our own headless extraction/compaction sessions —
        // their idle is noise (compactRunning would no-op it anyway).
        if (!internalSessions.has(sid)) void maybeCompact();
      } else if (event.type === "session.deleted") {
        const id = (event as any).properties?.info?.id ?? (event as any).properties?.sessionID;
        if (id) {
          const t = timers.get(id);
          if (t) clearTimeout(t);
          timers.delete(id);
          if (!internalSessions.has(id)) {
            void extract(id);
          }
        }
      }
    },
  };
};

export default MemoryPlugin;

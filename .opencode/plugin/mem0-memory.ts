import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { type Plugin, tool } from "@opencode-ai/plugin";

import { getMemory, USER_ID, COLLECTION, QDRANT_URL } from "../lib/mem0-client";
import { detectKeyword, runExtraction, type NormMsg } from "../lib/mem0-extract";

/**
 * mem0-backed long-term memory plugin (replaces memory.ts). See
 * docs/memory-feature-design.md for the full design.
 *
 * Recall is PULL-BASED: the model calls the `search_memories` tool when prior
 * user context would help. Nothing is auto-injected into the context, so the
 * store can grow without inflating every session (the old MEMORY.md-in-
 * `instructions` approach grew O(n)).
 *
 * Writes (Plan A — we OWN extraction; mem0's infer:true is never called):
 *   - Auto (Mechanism 3): `session.idle` debounced — the new messages since the
 *     last watermark are handed to OUR gated judge (mem0-judge.ts), which decides
 *     what (if anything) is durable; its decisions are applied with infer:false.
 *   - Explicit (Mechanism 4): a "记住 / remember" keyword fires the SAME extractor
 *     early (short debounce), tagged source:"explicit".
 *   - `session.deleted` flushes any pending extraction for that session.
 *
 * Audit: a one-way `notes/memory/SNAPSHOT.<agent>.md` is regenerated from
 * `getAll()` on write churn / interval, so the store stays greppable and the
 * notes repo's sync diffs it. The snapshot is disposable — mem0/Qdrant is the
 * store of record.
 *
 * Per-agent filename: the local and VPS agents share the `notes/` git repo but
 * keep SEPARATE Qdrant stores, so a single shared SNAPSHOT.md was overwritten
 * with divergent content by each side → constant merge conflicts on sync. The
 * file is namespaced by AGENT_ID (env `MEM0_AGENT_ID`, else hostname) so each
 * agent owns its own snapshot/conflicts file and they never collide. Same for
 * the compaction CONFLICTS file.
 */

// Stable per-agent slug so the two agents (local mac / VPS) write to distinct
// generated files instead of fighting over one shared path.
const AGENT_ID = (process.env.MEM0_AGENT_ID || os.hostname() || "local")
  .replace(/[^a-zA-Z0-9_-]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .toLowerCase() || "local";

const SNAPSHOT_REL = `notes/memory/SNAPSHOT.${AGENT_ID}.md`;
const CONFLICTS_REL = `notes/memory/CONFLICTS.${AGENT_ID}.md`;

const DEBOUNCE_MS = Number(process.env.MEMORY_EXTRACT_DEBOUNCE_MS) || 60_000;
// A "记住/remember" keyword fires the SAME extractor early (short debounce)
// instead of a second independent add — single writer, no idle/explicit race.
// Short, but long enough for the triggering message to persist before we read it.
const KEYWORD_DEBOUNCE_MS = Number(process.env.MEMORY_KEYWORD_DEBOUNCE_MS) || 5_000;
// Auto-extraction is DISABLED by default (opt-in). The full extraction code
// below is retained; set MEMORY_EXTRACT_ENABLED=1 to re-enable automatic writes.
const EXTRACT_ENABLED = process.env.MEMORY_EXTRACT_ENABLED === "1";
// Pull-based recall (`search_memories`) is also DISABLED by default so the tool
// is not registered and the agent never sees it. The implementation is retained;
// set MEMORY_RECALL_ENABLED=1 to expose the tool again.
const RECALL_ENABLED = process.env.MEMORY_RECALL_ENABLED === "1";

// Snapshot cadence: rewrite after this many adds, or once this long has passed.
const SNAPSHOT_CHURN = Number(process.env.MEMORY_SNAPSHOT_CHURN) || 5;
const SNAPSHOT_INTERVAL_MS =
  Number(process.env.MEMORY_SNAPSHOT_INTERVAL_MS) || 12 * 60 * 60 * 1000;
const SNAPSHOT_MAX = 2000;

// Compaction cadence: run after this many adds, or once this long has passed.
// Guard: at least this many memories must exist before compaction runs.
const COMPACT_ENABLED = process.env.MEMORY_COMPACT_ENABLED !== "0";
const COMPACT_CHURN = Number(process.env.MEMORY_COMPACT_CHURN) || 20;
const COMPACT_MIN_ENTRIES = Number(process.env.MEMORY_COMPACT_MIN_ENTRIES) || 10;
const COMPACT_INTERVAL_MS =
  Number(process.env.MEMORY_COMPACT_INTERVAL_MS) || 24 * 60 * 60 * 1000;
// Gemini model for the compaction LLM call (defaults to same as extraction).
const COMPACT_MODEL = process.env.MEMORY_COMPACT_MODEL || process.env.MEM0_LLM_MODEL || "gemini-2.5-flash";
// Safety limit: skip compaction if the serialized store exceeds this size.
const COMPACT_MAX_CHARS = 80_000;

const COMPACT_SYSTEM = `You are a memory-compaction subroutine for a personal assistant's long-term memory store.
You receive the full memory store as a numbered list (each entry: integer ID + fact text) and produce a reconciliation plan as a JSON array of operations.

Be CONSERVATIVE. This store is the assistant's durable knowledge about the user; wrongly deleting or merging loses real information. Prefer keeping over losing.

Operations (output ONLY a JSON array, no prose, no markdown fence):
- Delete a memory that is clearly stale or fully superseded by another:
  {"action":"delete","id":1,"reason":"superseded by id 3"}
- Rewrite a single entry in place to tighten or correct it (keep same fact, better wording):
  {"action":"rewrite","id":4,"text":"rewritten fact text"}
- Flag a genuine CONTRADICTION you cannot resolve (you cannot tell which is current). Keep BOTH, do not pick:
  {"action":"flag","ids":[0,3],"note":"contradict on X — user must resolve"}

HARD RULES:
- NEVER use merge. This compaction pass is not allowed to create new synthesized facts from multiple entries.
- Only delete when clearly stale or fully superseded. If unsure, keep it.
- For a contradiction where you cannot determine current truth, use "flag" — NEVER "delete" one side on a guess.
- Never preserve or generate operational/episodic memories such as "User asked/instructed/committed/debugged...", assistant plans, deliverable summaries, dated event recaps, or system/debug state. Prefer deleting those over rewriting them.
- Never add background rationale, examples, or "why" context to a fact. Keep wording short and literal.
- Never turn several related facts into one abstract characterization.
- Use only the integer IDs from the input. Never reference IDs not in the list.
If the store is already clean, output exactly: []`;

type LogLevel = "debug" | "info" | "warn" | "error";

export const Mem0MemoryPlugin: Plugin = async (ctx) => {
  const root = ctx.directory;
  const snapshotPath = path.join(root, SNAPSHOT_REL);

  const timers = new Map<
    string,
    { handle: ReturnType<typeof setTimeout>; dueAt: number; reason: "idle" | "explicit" }
  >();
  const running = new Set<string>();
  // Sessions whose next extraction was triggered by an explicit "记住/remember"
  // keyword — so that batch is tagged source:"explicit" rather than "auto-idle".
  const pendingExplicit = new Set<string>();
  let addsSinceSnapshot = 0;
  let lastSnapshotAt = 0;
  let addsSinceCompact = 0;
  let lastCompactAt = 0;
  let compactRunning = false;

  const log = async (level: LogLevel, message: string, extra?: Record<string, unknown>) => {
    try {
      await ctx.client.app.log({
        body: {
          service: "mem0-memory",
          level,
          message,
          ...(extra ? { extra } : {}),
        },
      });
    } catch {
      /* ignore */
    }
  };

  const logError = async (message: string, extra?: Record<string, unknown>) => {
    await log("error", message, extra);
  };

  // ---- state ------------------------------------------------------------

  function messageText(
    parts: Array<{ type?: string; text?: string; synthetic?: boolean; ignored?: boolean }>,
  ): string {
    return parts
      .filter((p) => p.type === "text" && !p.synthetic && !p.ignored && p.text)
      .map((p) => p.text!.trim())
      .filter(Boolean)
      .join("\n");
  }

  function readHookText(value: unknown): string {
    if (!value || typeof value !== "object") return "";
    const maybeParts = (value as { parts?: unknown }).parts;
    return Array.isArray(maybeParts) ? messageText(maybeParts as any[]) : "";
  }

  // ---- maintenance: drop assistant-attributed memories ------------------

  // mem0's extractor sometimes stores the assistant's OWN statements /
  // acknowledgments ("noted", "as stated by the assistant") with
  // attributedTo: "assistant". Those are bookkeeping, not durable user facts.
  // A direct Qdrant filtered-delete prunes them deterministically (no LLM, no
  // embedding) — runs in the maintenance pass to keep add() fast.
  async function pruneAssistantAttributed() {
    try {
      const resp = await fetch(
        `${QDRANT_URL}/collections/${COLLECTION}/points/delete?wait=true`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filter: { must: [{ key: "attributedTo", match: { value: "assistant" } }] },
          }),
        },
      );
      if (!resp.ok) await logError("prune assistant memories failed", { status: resp.status });
    } catch (err) {
      await logError("prune assistant memories failed", { err: String(err) });
    }
  }

  // ---- snapshot (one-way audit) -----------------------------------------

  async function maybeSnapshot(force = false) {
    const dueByChurn = addsSinceSnapshot >= SNAPSHOT_CHURN;
    const dueByTime = Date.now() - lastSnapshotAt >= SNAPSHOT_INTERVAL_MS;
    if (!force && !dueByChurn && !dueByTime) return;
    const mem = getMemory();
    if (!mem) return;
    // Prune assistant-attributed junk BEFORE snapshotting so the audit is clean.
    await pruneAssistantAttributed();
    try {
      const all = await mem.getAll({ filters: { user_id: USER_ID }, topK: SNAPSHOT_MAX });
      const rows = (all.results ?? [])
        .map((m) => {
          const src = (m.metadata as Record<string, unknown> | undefined)?.source ?? "?";
          return `- [${src}] ${m.memory}  \`${m.id}\` ${m.createdAt ?? ""}`.trimEnd();
        })
        .join("\n");
      const md = `# Memory snapshot\n\n<!-- One-way audit of the mem0/Qdrant store (\`${USER_ID}\`). Regenerated automatically; DO NOT edit — mem0 is the store of record. -->\n\n${rows}\n`;
      fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
      fs.writeFileSync(snapshotPath, md);
      addsSinceSnapshot = 0;
      lastSnapshotAt = Date.now();
    } catch (err) {
      await logError("snapshot failed", { err: String(err) });
    }
  }

  // ---- compaction (external pass, orthogonal to add pipeline) ----------

  // Direct Gemini REST call — avoids adding a new SDK dep. Same key used by mem0.
  async function callGemini(system: string, user: string): Promise<string> {
    const key = process.env.GOOGLE_API_KEY;
    if (!key) throw new Error("GOOGLE_API_KEY not set");
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${COMPACT_MODEL}:generateContent?key=${key}`;
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { responseMimeType: "application/json" },
    };
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`Gemini ${resp.status}: ${await resp.text()}`);
    const data = (await resp.json()) as any;
    return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  }

  async function compact() {
    if (!COMPACT_ENABLED || compactRunning) return;
    compactRunning = true;
    const conflictsPath = path.join(root, CONFLICTS_REL);
    try {
      const mem = getMemory();
      if (!mem) return;
      const all = await mem.getAll({ filters: { user_id: USER_ID }, topK: SNAPSHOT_MAX });
      const entries = all.results ?? [];
      if (entries.length < COMPACT_MIN_ENTRIES) return;

      // Map integer → UUID (anti-hallucination: LLM sees integers, not UUIDs).
      const idxToUUID: string[] = [];
      const uuidToIdx: Record<string, number> = {};
      const listing = entries
        .map((m, i) => {
          idxToUUID[i] = m.id!;
          uuidToIdx[m.id!] = i;
          return `${i}: ${m.memory}`;
        })
        .join("\n");

      if (listing.length > COMPACT_MAX_CHARS) {
        await log("warn", "compact skipped: store too large for single pass", { chars: listing.length });
        return;
      }

      const raw = await callGemini(COMPACT_SYSTEM, `MEMORY STORE:\n${listing}\n\nReturn the JSON array now.`);

      let ops: any[];
      try {
        ops = JSON.parse(raw);
        if (!Array.isArray(ops)) ops = [];
      } catch {
        await logError("compact: failed to parse LLM response", { raw: raw.slice(0, 300) });
        return;
      }

      const stats = { mergedIgnored: 0, deleted: 0, rewritten: 0, flagged: 0, errors: 0 };
      const flags: string[] = [];

      for (const op of ops) {
        try {
          if (op.action === "merge" && Array.isArray(op.sources) && op.text) {
            await log("warn", "compact: merge ignored", { sources: op.sources, text: op.text });
            stats.mergedIgnored++;
          } else if (op.action === "delete" && typeof op.id === "number") {
            const uuid = idxToUUID[op.id];
            if (uuid) { await mem.delete(uuid); stats.deleted++; }
          } else if (op.action === "rewrite" && typeof op.id === "number" && op.text) {
            const uuid = idxToUUID[op.id];
            if (uuid) { await (mem as any).update(uuid, op.text); stats.rewritten++; }
          } else if (op.action === "flag" && Array.isArray(op.ids) && op.note) {
            const refs = op.ids.map((i: number) => `[${i}] ${idxToUUID[i] ?? "?"}`).join(", ");
            flags.push(`- ${refs} — ${String(op.note).replace(/\n/g, " ")}`);
            stats.flagged++;
          }
        } catch (err) {
          await logError("compact: op failed", { op, err: String(err) });
          stats.errors++;
        }
      }

      // Write/clear conflicts file.
      fs.mkdirSync(path.dirname(conflictsPath), { recursive: true });
      if (flags.length > 0) {
        fs.writeFileSync(
          conflictsPath,
          `# Memory Conflicts\n\n<!-- Auto-generated by compaction. Each line is a contradiction the assistant could not resolve; please reconcile. -->\n\n${flags.join("\n")}\n`,
        );
      } else {
        try { fs.unlinkSync(conflictsPath); } catch { /* already absent */ }
      }

      lastCompactAt = Date.now();
      addsSinceCompact = 0;
      await log("info", "compact done", stats);
      // Force snapshot after compaction so SNAPSHOT.md reflects the cleaned store.
      await maybeSnapshot(true);
    } catch (err) {
      await logError("compact error", { err: String(err) });
    } finally {
      compactRunning = false;
    }
  }

  async function maybeCompact() {
    if (!COMPACT_ENABLED) return;
    const dueByChurn = addsSinceCompact >= COMPACT_CHURN;
    const dueByTime = Date.now() - lastCompactAt >= COMPACT_INTERVAL_MS;
    if (dueByChurn || dueByTime) void compact();
  }

  // ---- auto extraction on idle (Mechanism 3) ----------------------------

  async function extract(sessionID: string) {
    // Master gate: disabled by default (opt-in). Guarded HERE, not just in
    // scheduleExtract, so every caller — idle/explicit timers, session.deleted,
    // and the beforeExit flush — is covered.
    if (!EXTRACT_ENABLED) return;
    if (running.has(sessionID)) return;
    running.add(sessionID);
    try {
      const res = await ctx.client.session.messages({
        path: { id: sessionID },
        query: { directory: root },
      });
      const all = (res.data ?? []) as Array<{ info: { id: string; role: string }; parts: any[] }>;

      // Normalize opencode's messages; the watermark/slicing/add behavior is the
      // shared core in mem0-extract.ts (mirrored by the Claude Code Stop hook).
      const messages: NormMsg[] = all.map((m) => ({
        id: m.info.id,
        role: m.info.role,
        text: messageText(m.parts),
      }));

      const result = await runExtraction({
        root,
        sessionID,
        messages,
        runtime: "opencode",
        // Cleared only when actually committing the add, so an early return
        // (no fresh messages) preserves the explicit flag for the next run.
        consumeExplicit: () => pendingExplicit.delete(sessionID),
      });

      await log("debug", "extract finished", {
        sessionID,
        status: result.status,
        ...(result.status === "added" ? { latestID: result.latestID } : { reason: result.reason }),
      });

      if (result.status === "added") {
        addsSinceSnapshot++;
        addsSinceCompact++;
        await maybeSnapshot();
        await maybeCompact();
      }
    } catch (err) {
      await logError("extract error", { sessionID, err: String(err) });
    } finally {
      running.delete(sessionID);
    }
  }

  let shutdownFlush: Promise<void> | null = null;
  async function flushPendingSessions(trigger: "dispose" | "beforeExit") {
    if (shutdownFlush) return shutdownFlush;
    const sessionIDs = [...new Set([...timers.keys(), ...pendingExplicit])];
    if (sessionIDs.length === 0) return;

    shutdownFlush = (async () => {
      for (const sessionID of sessionIDs) {
        const timer = timers.get(sessionID);
        if (timer) clearTimeout(timer.handle);
        timers.delete(sessionID);
      }

      await log("info", "shutdown flush starting", { trigger, sessionIDs });
      for (const sessionID of sessionIDs) {
        await extract(sessionID);
      }
      await log("info", "shutdown flush finished", { trigger, sessionIDs });
    })().finally(() => {
      shutdownFlush = null;
    });

    return shutdownFlush;
  }

  const onBeforeExit = () => {
    void flushPendingSessions("beforeExit");
  };
  process.on("beforeExit", onBeforeExit);

  function scheduleExtract(
    sessionID: string,
    delayMs: number = DEBOUNCE_MS,
    reason: "idle" | "explicit" = "idle",
  ) {
    if (!EXTRACT_ENABLED) return;
    const now = Date.now();
    const dueAt = now + delayMs;
    const existing = timers.get(sessionID);
    // Never let a later idle debounce push an earlier explicit run farther out.
    if (existing && existing.dueAt <= dueAt) {
      void log("debug", "extract timer kept", {
        sessionID,
        existingReason: existing.reason,
        existingDueInMs: Math.max(0, existing.dueAt - now),
        skippedReason: reason,
        skippedDelayMs: delayMs,
      });
      return;
    }
    if (existing) clearTimeout(existing.handle);
    void log("debug", "extract timer scheduled", { sessionID, reason, delayMs });
    timers.set(
      sessionID,
      {
        reason,
        dueAt,
        handle: setTimeout(() => {
          timers.delete(sessionID);
          void extract(sessionID);
        }, delayMs),
      },
    );
  }

  return {
    // Tool only registered when recall is opt-in; otherwise the agent never
    // sees `search_memories` at all (the definition below is kept for re-enable).
    tool: RECALL_ENABLED ? {
      search_memories: tool({
        description:
          "Search long-term memory about the user — their preferences, identity, ongoing projects, and how to work with them. Call this at the start of a task when prior user context would help; memory is NOT auto-loaded, so you only see it if you ask. Returns the most relevant remembered facts.",
        args: {
          query: tool.schema.string().describe("what to recall, in natural language"),
          limit: tool.schema
            .number()
            .optional()
            .describe("max facts to return (default 5)"),
        },
        async execute({ query, limit }) {
          const mem = getMemory();
          if (!mem) return "(memory unavailable)";
          try {
            const r = await mem.search(query, {
              filters: { user_id: USER_ID },
              topK: limit ?? 5,
            });
            const hits = (r.results ?? []).map((m) => `- ${m.memory}`);
            return hits.length ? hits.join("\n") : "(no relevant memory)";
          } catch (err) {
            await logError("search failed", { err: String(err) });
            return "(memory search unavailable)";
          }
        },
      }),
    } : {},

    "chat.message": async (input, output) => {
      try {
        const text = readHookText(output);
        await log("debug", "chat.message received", {
          sessionID: (input as { sessionID?: string }).sessionID,
          text,
        });
        if (text && detectKeyword(text)) {
          // Explicit "记住/remember" does NOT do its own add — that's what caused
          // the explicit/idle double-write race. Instead it fires the SAME single
          // extractor early (short debounce) and tags the batch source:"explicit".
          // One writer, one watermark → a message is processed exactly once.
          pendingExplicit.add(input.sessionID);
          await log("info", "explicit memory trigger detected", {
            sessionID: input.sessionID,
            text,
          });
          scheduleExtract(input.sessionID, KEYWORD_DEBOUNCE_MS, "explicit");
        }
      } catch (err) {
        await logError("chat.message error", { err: String(err) });
      }
    },

    event: async ({ event }) => {
      if (event.type === "session.idle") {
        scheduleExtract(event.properties.sessionID, DEBOUNCE_MS, "idle");
      } else if (event.type === "session.deleted") {
        const id = (event as any).properties?.info?.id ?? (event as any).properties?.sessionID;
        if (id) {
          const t = timers.get(id);
          if (t) clearTimeout(t.handle);
          timers.delete(id);
          void extract(id);
        }
      }
    },
  };
};

export default Mem0MemoryPlugin;

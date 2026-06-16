import fs from "node:fs";
import path from "node:path";

import { type Plugin, tool } from "@opencode-ai/plugin";

import { getMemory, USER_ID, COLLECTION, QDRANT_URL } from "./mem0-client";

/**
 * mem0-backed long-term memory plugin (replaces memory.ts). See
 * docs/mem0-integration-plan.md for the full design.
 *
 * Recall is PULL-BASED: the model calls the `search_memories` tool when prior
 * user context would help. Nothing is auto-injected into the context, so the
 * store can grow without inflating every session (the old MEMORY.md-in-
 * `instructions` approach grew O(n)).
 *
 * Writes:
 *   - Auto (Mechanism 3): `session.idle` debounced — the new messages since the
 *     last watermark are handed to mem0's own `infer:true` extractor, which
 *     decides what (if anything) is durable and dedups/updates against the store.
 *   - Explicit (Mechanism 4): a "记住 / remember" keyword in the user's message
 *     routes that message straight to mem0 immediately.
 *   - `session.deleted` flushes any pending extraction for that session.
 *
 * Audit: a one-way `notes/memory/SNAPSHOT.md` is regenerated from `getAll()` on
 * write churn / interval, so the store stays greppable and the notes repo's
 * sync diffs it. The snapshot is disposable — mem0/Qdrant is the store of record.
 */

const WATERMARK_REL = ".data/memory-extract-watermark.json";
const SNAPSHOT_REL = "notes/memory/SNAPSHOT.md";

const DEBOUNCE_MS = Number(process.env.MEMORY_EXTRACT_DEBOUNCE_MS) || 60_000;
// A "记住/remember" keyword fires the SAME extractor early (short debounce)
// instead of a second independent add — single writer, no idle/explicit race.
// Short, but long enough for the triggering message to persist before we read it.
const KEYWORD_DEBOUNCE_MS = Number(process.env.MEMORY_KEYWORD_DEBOUNCE_MS) || 5_000;
const EXTRACT_ENABLED = process.env.MEMORY_EXTRACT_ENABLED !== "0";
const MAX_NEW_MESSAGES = 40;
const MAX_TRANSCRIPT_CHARS = 24_000;
const MIN_TRANSCRIPT_CHARS = 40;

// Snapshot cadence: rewrite after this many adds, or once this long has passed.
const SNAPSHOT_CHURN = Number(process.env.MEMORY_SNAPSHOT_CHURN) || 5;
const SNAPSHOT_INTERVAL_MS =
  Number(process.env.MEMORY_SNAPSHOT_INTERVAL_MS) || 12 * 60 * 60 * 1000;
const SNAPSHOT_MAX = 2000;

type LogLevel = "debug" | "info" | "warn" | "error";

const KEYWORD_RE =
  /(记住|记一下|记下|存一下|帮我记|remember (this|that)|save this|note this down|don'?t forget)/i;
const CODE_BLOCK_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`]+`/g;

export const Mem0MemoryPlugin: Plugin = async (ctx) => {
  const root = ctx.directory;
  const watermarkPath = path.join(root, WATERMARK_REL);
  const snapshotPath = path.join(root, SNAPSHOT_REL);

  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const running = new Set<string>();
  // Sessions whose next extraction was triggered by an explicit "记住/remember"
  // keyword — so that batch is tagged source:"explicit" rather than "auto-idle".
  const pendingExplicit = new Set<string>();
  let addsSinceSnapshot = 0;
  let lastSnapshotAt = 0;

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

  function messageText(
    parts: Array<{ type?: string; text?: string; synthetic?: boolean; ignored?: boolean }>,
  ): string {
    return parts
      .filter((p) => p.type === "text" && !p.synthetic && !p.ignored && p.text)
      .map((p) => p.text!.trim())
      .filter(Boolean)
      .join("\n");
  }

  function detectKeyword(text: string): boolean {
    const stripped = text.replace(CODE_BLOCK_RE, "").replace(INLINE_CODE_RE, "");
    return KEYWORD_RE.test(stripped);
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

  // ---- auto extraction on idle (Mechanism 3) ----------------------------

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

      if (transcript.trim().length < MIN_TRANSCRIPT_CHARS) {
        writeWatermark(sessionID, latestID);
        return;
      }

      const mem = getMemory();
      if (!mem) return; // memory disabled (no key / init failed); leave watermark unmoved to retry later

      // Cleared only once we're actually committing the add, so an early-return
      // (no fresh messages) preserves the explicit flag for the next run.
      const source = pendingExplicit.delete(sessionID) ? "explicit" : "auto-idle";

      await mem.add(transcript, {
        userId: USER_ID,
        // NOTE: session id goes in metadata, NOT runId. mem0 uses run_id as a
        // hard retrieval scope, so a per-session runId silos dedup per session
        // and lets the same fact ("likes donuts") re-accumulate across sessions.
        // Long-term user memory is one pool keyed by user_id; sessionId is
        // provenance-only metadata.
        metadata: { source, sessionId: sessionID },
        infer: true,
      });
      writeWatermark(sessionID, latestID);
      addsSinceSnapshot++;
      await maybeSnapshot();
    } catch (err) {
      await logError("extract error", { sessionID, err: String(err) });
    } finally {
      running.delete(sessionID);
    }
  }

  function scheduleExtract(sessionID: string, delayMs: number = DEBOUNCE_MS) {
    if (!EXTRACT_ENABLED) return;
    const existing = timers.get(sessionID);
    if (existing) clearTimeout(existing); // coalesce — only one pending run per session
    timers.set(
      sessionID,
      setTimeout(() => {
        timers.delete(sessionID);
        void extract(sessionID);
      }, delayMs),
    );
  }

  return {
    tool: {
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
    },

    "chat.message": async (input, output) => {
      try {
        const text = messageText(output.parts as any[]);
        if (text && detectKeyword(text)) {
          // Explicit "记住/remember" does NOT do its own add — that's what caused
          // the explicit/idle double-write race. Instead it fires the SAME single
          // extractor early (short debounce) and tags the batch source:"explicit".
          // One writer, one watermark → a message is processed exactly once.
          pendingExplicit.add(input.sessionID);
          scheduleExtract(input.sessionID, KEYWORD_DEBOUNCE_MS);
        }
      } catch (err) {
        await logError("chat.message error", { err: String(err) });
      }
    },

    event: async ({ event }) => {
      if (event.type === "session.idle") {
        scheduleExtract(event.properties.sessionID);
      } else if (event.type === "session.deleted") {
        const id = (event as any).properties?.info?.id ?? (event as any).properties?.sessionID;
        if (id) {
          const t = timers.get(id);
          if (t) clearTimeout(t);
          timers.delete(id);
          void extract(id);
        }
      }
    },
  };
};

export default Mem0MemoryPlugin;

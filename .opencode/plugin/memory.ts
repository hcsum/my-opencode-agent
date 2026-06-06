import fs from "node:fs";
import path from "node:path";

import type { Plugin } from "@opencode-ai/plugin";

/**
 * Memory capture plugin for the OpenCode interactive client.
 *
 * Two write triggers (see docs/memory-feature-design.md §3.4):
 *   - Mechanism 4 (instant): `chat.message` regex-detects a memory keyword in the
 *     user's message and injects a synthetic instruction forcing the model to save
 *     the fact now via its normal write/edit tools, following .opencode/memory/PROTOCOL.md.
 *   - Mechanism 3 (true auto): `event` watches `session.idle`; debounced so it fires
 *     once the user has actually paused. It then reads the new messages since the last
 *     watermark, asks a cheap model to extract durable memories (deduped against the
 *     existing index), and writes them to notes/memory/*.md + updates MEMORY.md.
 *
 * Recall is handled outside this plugin: .opencode/memory/PROTOCOL.md (rules, in main repo) and
 * notes/memory/MEMORY.md (the index, content in notes) are loaded every session via `instructions`
 * in .opencode/opencode.json.
 */

const MEMORY_SUBDIR = "notes/memory";
const INDEX_FILE = "MEMORY.md";
const WATERMARK_REL = ".data/memory-extract-watermark.json";

const DEBOUNCE_MS = Number(process.env.MEMORY_EXTRACT_DEBOUNCE_MS) || 60_000;
const EXTRACT_ENABLED = process.env.MEMORY_EXTRACT_ENABLED !== "0";
const EXTRACT_MODEL = process.env.MEMORY_EXTRACT_MODEL; // "providerID/modelID", optional
const MAX_NEW_MESSAGES = 40;
const MAX_TRANSCRIPT_CHARS = 24_000;

const KEYWORD_RE =
  /(记住|记一下|记下|存一下|帮我记|remember (this|that)|save this|note this down|don'?t forget)/i;
const CODE_BLOCK_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`]+`/g;

const KEYWORD_NUDGE = `[MEMORY TRIGGER]
The user asked you to remember something. Before finishing this turn you MUST persist it following .opencode/memory/PROTOCOL.md:
1. Pick a type (user | feedback | project | reference) and a kebab-case name.
2. Write/update notes/memory/<type>-<name>.md with the frontmatter + body the protocol specifies (check for an existing file first and update it instead of duplicating).
3. Add or update its one-line entry in notes/memory/MEMORY.md.
Do not skip this. Keep the memory concise and reusable.`;

type MemoryType = "user" | "feedback" | "project" | "reference";

interface MemoryOp {
  action: "add" | "update";
  type: MemoryType;
  name: string; // kebab-case slug
  title: string;
  description: string; // one-line hook for the index
  body: string;
}

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
- anything already covered by an entry in the existing index (dedupe; if it refines an existing one, use action "update" with that entry's name)
- speculation; only record what the user actually stated or confirmed

Output ONLY a JSON array (no prose, no markdown fence). Each element:
{"action":"add"|"update","type":"user"|"feedback"|"project"|"reference","name":"kebab-case-slug","title":"Short Title","description":"one-line hook for the index","body":"the fact; for feedback/project add a line starting with 'Why:' explaining the reason"}
If nothing meets the bar, output exactly: []`;

export const MemoryPlugin: Plugin = async (ctx) => {
  const root = ctx.directory;
  const memoryDir = path.join(root, MEMORY_SUBDIR);
  const indexPath = path.join(memoryDir, INDEX_FILE);
  const watermarkPath = path.join(root, WATERMARK_REL);

  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const running = new Set<string>();
  // Sessions this plugin created for extraction — their idle events must be ignored,
  // otherwise extraction would recursively trigger itself.
  const internalSessions = new Set<string>();

  const log = (msg: string, extra?: Record<string, unknown>) => {
    try {
      console.error(`[memory] ${msg}${extra ? " " + JSON.stringify(extra) : ""}`);
    } catch {
      /* ignore */
    }
  };

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

  function detectKeyword(text: string): boolean {
    const stripped = text.replace(CODE_BLOCK_RE, "").replace(INLINE_CODE_RE, "");
    return KEYWORD_RE.test(stripped);
  }

  function fileNameFor(op: MemoryOp): string {
    const safeType = op.type.replace(/[^a-z]/g, "");
    const safeName = op.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "note";
    return `${safeType}-${safeName}.md`;
  }

  function renderMemoryFile(op: MemoryOp): string {
    return `---
name: ${op.name}
description: ${op.description.replace(/\n/g, " ")}
metadata:
  type: ${op.type}
---

${op.body.trim()}
`;
  }

  /** Upsert a single entry line in MEMORY.md, keyed by filename, preserving the header. */
  function upsertIndex(fileName: string, title: string, hook: string) {
    let lines: string[] = [];
    if (fs.existsSync(indexPath)) {
      lines = fs.readFileSync(indexPath, "utf8").split("\n");
    } else {
      lines = [
        "# Memory Index",
        "",
        "<!-- Auto-maintained. One entry per memory file. Format: - [Title](file.md) — hook -->",
        "",
      ];
    }
    const entry = `- [${title}](${fileName}) — ${hook.replace(/\n/g, " ")}`;
    const ref = `](${fileName})`;
    const idx = lines.findIndex((l) => l.includes(ref));
    if (idx >= 0) lines[idx] = entry;
    else {
      if (lines.length && lines[lines.length - 1].trim() !== "") lines.push("");
      // drop trailing blank, append entry
      while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
      lines.push(entry);
    }
    fs.mkdirSync(memoryDir, { recursive: true });
    fs.writeFileSync(indexPath, lines.join("\n").replace(/\n*$/, "\n"));
  }

  function applyOps(ops: MemoryOp[]): number {
    let n = 0;
    for (const op of ops) {
      if (!op || !op.name || !op.body || !op.type) continue;
      if (!["user", "feedback", "project", "reference"].includes(op.type)) continue;
      const fileName = fileNameFor(op);
      try {
        fs.mkdirSync(memoryDir, { recursive: true });
        fs.writeFileSync(path.join(memoryDir, fileName), renderMemoryFile(op));
        upsertIndex(fileName, op.title || op.name, op.description || "");
        n++;
      } catch (err) {
        log("write failed", { fileName, err: String(err) });
      }
    }
    return n;
  }

  function parseOps(text: string): MemoryOp[] {
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start < 0 || end <= start) return [];
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      return Array.isArray(parsed) ? (parsed as MemoryOp[]) : [];
    } catch {
      return [];
    }
  }

  function messageText(parts: Array<{ type?: string; text?: string; synthetic?: boolean; ignored?: boolean }>): string {
    return parts
      .filter((p) => p.type === "text" && !p.synthetic && !p.ignored && p.text)
      .map((p) => p.text!.trim())
      .filter(Boolean)
      .join("\n");
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

      let index = "(empty)";
      try {
        index = fs.readFileSync(indexPath, "utf8");
      } catch {
        /* no index yet */
      }

      const model = EXTRACT_MODEL
        ? { providerID: EXTRACT_MODEL.split("/")[0], modelID: EXTRACT_MODEL.split("/").slice(1).join("/") }
        : undefined;

      const created = await ctx.client.session.create({
        body: { title: "memory-extract" },
        query: { directory: root },
      });
      const exId = created.data?.id;
      if (!exId) {
        log("extract: failed to create session");
        return;
      }
      internalSessions.add(exId);
      try {
        const prompt = await ctx.client.session.prompt({
          path: { id: exId },
          query: { directory: root },
          body: {
            ...(model ? { model } : {}),
            system: EXTRACT_SYSTEM,
            parts: [
              {
                type: "text",
                text: `EXISTING MEMORY INDEX:\n${index}\n\nCONVERSATION EXCERPT:\n${transcript}\n\nReturn the JSON array now.`,
              },
            ],
          },
        });
        const out = messageText((prompt.data?.parts ?? []) as any[]);
        const ops = parseOps(out);
        const wrote = applyOps(ops);
        log("extract done", { sessionID, newMessages: fresh.length, ops: ops.length, wrote });
      } finally {
        try {
          await ctx.client.session.delete({ path: { id: exId }, query: { directory: root } });
        } catch {
          /* best effort */
        }
        internalSessions.delete(exId);
      }

      writeWatermark(sessionID, latestID);
    } catch (err) {
      log("extract error", { sessionID, err: String(err) });
    } finally {
      running.delete(sessionID);
    }
  }

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
        scheduleExtract(event.properties.sessionID);
      } else if (event.type === "session.deleted") {
        const id = (event as any).properties?.info?.id ?? (event as any).properties?.sessionID;
        if (id) {
          const t = timers.get(id);
          if (t) clearTimeout(t);
          timers.delete(id);
        }
      }
    },
  };
};

export default MemoryPlugin;

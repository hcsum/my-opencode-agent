import "./mem0-env"; // ensure .env is loaded + global fetch is proxied (Gemini egress)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * The "own-extraction" brain for Plan A: we decide what to remember, mem0 is
 * only the store. Instead of `mem.add(infer:true)` (mem0's high-recall LLM picks
 * the facts, then we delete junk after the fact), we make ONE Gemini call here
 * with our low-recall gate + the existing memories, and it returns explicit
 * ADD/UPDATE decisions. Nothing junk ever reaches Qdrant, and "what to remember"
 * is fully decoupled from mem0's internal prompt/version.
 *
 * The call is via Gemini's REST API directly (not mem0's LLM wrapper) so the
 * decision logic owes nothing to mem0. `mem0-env` has already loaded
 * GOOGLE_API_KEY from .env and routed global fetch through the proxy.
 */

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY ?? "";
// Same cheap model mem0 used for extraction; override via MEM0_LLM_MODEL.
const JUDGE_MODEL = process.env.MEM0_LLM_MODEL ?? "gemini-2.5-flash-lite";
const GEMINI_BASE = process.env.GEMINI_API_BASE ?? "https://generativelanguage.googleapis.com/v1beta";

// `text` is the self-contained form actually stored/shown (subject + scope, per
// the gate's SELF-CONTAINED rule). `core` is the atomic bare claim used ONLY as
// the dedup key, so two differently-enriched phrasings of the same fact still
// collide instead of accumulating as near-duplicates.
export type Decision =
  | { action: "ADD"; text: string; core: string }
  | { action: "UPDATE"; id: string; text: string; core: string };

export interface ExistingMemory {
  id: string;
  memory: string;
}

/** Our low-recall gate + taxonomy, shared with the human-readable spec. */
function loadGate(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url)); // .opencode/lib
    return readFileSync(join(here, "..", "memory", "EXTRACTION_GATE.md"), "utf8").trim();
  } catch {
    return "";
  }
}
const GATE = loadGate();

const OUTPUT_CONTRACT = `
## OUTPUT CONTRACT
Return ONLY a JSON object of the form {"memories": [ ... ]} and nothing else.
Each array item is exactly one of:
  {"action": "ADD", "core": "<atomic bare claim>", "text": "<self-contained fact>"}
  {"action": "UPDATE", "id": "<id of an existing memory listed below>", "core": "<atomic bare claim>", "text": "<self-contained fact>"}
Every item has TWO phrasings of the SAME single fact:
- "core": the atomic bare claim, shortest faithful phrasing, NO scope clause —
  used only as a dedup key (e.g. "Browserbase works with Semrush").
- "text": the SELF-CONTAINED form to store — the same fact plus the minimal
  subject + when-it-applies scope so it reads standalone months later (e.g.
  "Browserbase (headless browser used for SEO scraping) works for Semrush
  automation"). Per the SELF-CONTAINED form rule: add ONLY subject + scope, never
  rationale/history/why.
Rules:
- Default to {"memories": []}. For a normal coding/research/ops session, return exactly that.
- One fact per item — never bundle several facts into one text.
- Prefer UPDATE over ADD when a candidate only refines/corrects an existing memory; only ADD when it is genuinely new.
- Never ADD something that is a near-duplicate of an existing memory or that the existing memories already cover.
- Only use an "id" that appears in the existing-memories list; never invent one.`;

// `keywordHint` is true when a loose "记住 / remember"-type keyword was detected
// in the excerpt. It is ONLY a hint — the gate tells the model to decide for
// itself whether this is a genuine save request (and to ignore incidental uses).
function buildUserMessage(transcript: string, existing: ExistingMemory[], keywordHint: boolean): string {
  const existingBlock = existing.length
    ? existing.map((m) => `- (id: ${m.id}) ${m.memory}`).join("\n")
    : "(none)";
  const explicitNote = keywordHint
    ? "\nHINT: a “记住 / remember”-type keyword appeared in this excerpt. Decide per the gate whether the user is genuinely asking you to remember a durable fact; if so capture it (even if short), otherwise treat the excerpt normally.\n"
    : "";
  return [
    "EXISTING MEMORIES (for dedup / UPDATE targeting — do NOT re-extract these; they are already stored):",
    existingBlock,
    explicitNote,
    "CONVERSATION EXCERPT (newest turns, oldest→newest):",
    transcript,
  ].join("\n");
}

async function geminiJSON(system: string, user: string): Promise<string> {
  const url = `${GEMINI_BASE}/models/${JUDGE_MODEL}:generateContent?key=${GOOGLE_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0 },
    }),
  });
  if (!res.ok) {
    throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
}

/**
 * Decide what (if anything) to write from this excerpt. Fail-safe: on a missing
 * key, an LLM/network error, or unparseable output, returns [] (write nothing)
 * rather than throwing — a bad extraction turn must never break the session or
 * corrupt the store.
 */
export async function judge(
  transcript: string,
  existing: ExistingMemory[],
  keywordHint: boolean,
): Promise<Decision[]> {
  if (!GOOGLE_API_KEY) return [];
  const system = `${GATE}\n${OUTPUT_CONTRACT}`;
  const user = buildUserMessage(transcript, existing, keywordHint);

  let raw: string;
  try {
    raw = await geminiJSON(system, user);
  } catch {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  const items =
    parsed && typeof parsed === "object" && Array.isArray((parsed as { memories?: unknown }).memories)
      ? ((parsed as { memories: unknown[] }).memories)
      : [];

  const validIds = new Set(existing.map((m) => m.id));
  const out: Decision[] = [];
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const obj = it as { action?: unknown; id?: unknown; text?: unknown; core?: unknown };
    const text = typeof obj.text === "string" ? obj.text.trim() : "";
    if (!text) continue;
    // `core` is the dedup key; if the model omitted it, fall back to `text` so a
    // missing field degrades to the old text-based dedup rather than an empty key.
    const core = typeof obj.core === "string" && obj.core.trim() ? obj.core.trim() : text;
    if (obj.action === "UPDATE" && typeof obj.id === "string" && validIds.has(obj.id)) {
      out.push({ action: "UPDATE", id: obj.id, text, core });
    } else if (obj.action === "ADD") {
      out.push({ action: "ADD", text, core });
    }
    // An UPDATE with an unknown/hallucinated id is dropped (never blind-write a
    // random memory id); a malformed item is skipped.
  }
  return out;
}

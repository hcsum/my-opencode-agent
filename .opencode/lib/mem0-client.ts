import "./mem0-env"; // MUST be first — sets MEM0_TELEMETRY before mem0 loads
import { Memory } from "mem0ai/oss";

// mem0ai writes operational chatter straight to the global `console`
// (hundreds of console.log/info/debug/warn across oss/index.js: "[INFO] ...",
// "Redis Client Connected", "Memory with ID ... does not exist", telemetry
// warnings, etc). The plugin shares its process with the TUI, whose console
// overlay captures every in-process console.* and paints it over the input box.
// Our own logging uses ctx.client.app.log instead, so none of mem0's noise is
// wanted — but we must NOT mute console globally (opencode + other plugins use
// it). So we filter only the known mem0 chatter and leave console.error and
// everything unrecognised untouched, so genuine errors still surface.
const MEM0_NOISE =
  /^\[(INFO|DEBUG|WARN)\]|^(Redis|Connected to Redis|Connected to Supabase|Successfully|Memory with ID)|telemetry/i;
for (const method of ["log", "info", "debug", "warn"] as const) {
  const original = console[method].bind(console);
  console[method] = (...args: unknown[]) => {
    if (typeof args[0] === "string" && MEM0_NOISE.test(args[0])) return;
    original(...args);
  };
}

/**
 * Lazily-constructed mem0 `Memory` instance shared by the auto-memory plugin
 * (mem0-memory.ts) and the one-off backfill script (scripts/mem0-backfill.ts).
 *
 * Backend (see docs/mem0-integration-plan.md): self-hosted mem0/oss →
 *   - Qdrant (docker) for the vector store, data stays on our machine/VPS.
 *   - Gemini for both embeddings and the cheap extraction LLM (single key).
 *
 * Why lazy + guarded: `new Memory(...)` builds its provider clients eagerly,
 * which THROWS synchronously when an API key is unset. Constructing at import
 * time would crash plugin loading. Instead we build on first use and return
 * null on failure, so a missing key / down Qdrant degrades memory to a no-op
 * rather than taking the agent down. Callers must handle a null result.
 */

export const COLLECTION = process.env.MEM0_COLLECTION ?? "pikachu_memory";
export const USER_ID = process.env.MEM0_USER_ID ?? "sum";

// mem0-env.ts has already loaded `.env` into process.env by the time this runs.
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY ?? "";
export const QDRANT_URL = process.env.QDRANT_URL ?? "http://localhost:6333";
// mem0's Memory constructor requires an llm config even though Plan A never
// invokes mem0's own extractor (we own extraction in mem0-judge.ts). The judge
// reads the same MEM0_LLM_MODEL for its own Gemini call.
const LLM_MODEL = process.env.MEM0_LLM_MODEL ?? "gemini-2.5-flash-lite";
// Embeddings run on Gemini (gemini-embedding-001). Its output dim is
// configurable (768 / 1536 / 3072); we pin it via embeddingDims below.
const EMBED_MODEL = process.env.MEM0_EMBED_MODEL ?? "gemini-embedding-001";
// Set explicitly so mem0 doesn't probe the provider for the dimension on first
// use (that probe is an extra embedding call). 1536 keeps the Qdrant collection
// dimension unchanged from the original OpenAI setup; Gemini supports it.
const EMBED_DIMS = Number(process.env.MEM0_EMBED_DIMS) || 1536;

// Plan A owns extraction (see mem0-judge.ts): mem0's own extractor (infer:true)
// is never invoked, so no `customInstructions` are wired here. The low-recall
// gate in ../memory/EXTRACTION_GATE.md is consumed by the judge, not by mem0.

let cached: Memory | null = null;
let initFailed = false;

/** The shared Memory instance, or null if it can't be constructed (e.g. no
 * GOOGLE_API_KEY). Result is memoized; failure is sticky until process restart. */
export function getMemory(): Memory | null {
  if (cached) return cached;
  if (initFailed) return null;
  if (!GOOGLE_API_KEY) {
    // Both embeddings and the extraction LLM run on Gemini; without a key every
    // add/search would throw. Disable cleanly instead.
    initFailed = true;
    console.error(
      "[mem0] GOOGLE_API_KEY missing — memory disabled. Set it in .env (memory needs it for Gemini embeddings + extraction; opencode's own model auth is separate).",
    );
    return null;
  }
  try {
    cached = new Memory({
      vectorStore: {
        provider: "qdrant",
        config: { url: QDRANT_URL, collectionName: COLLECTION, dimension: EMBED_DIMS },
      },
      embedder: { provider: "gemini", config: { apiKey: GOOGLE_API_KEY, model: EMBED_MODEL, embeddingDims: EMBED_DIMS } },
      llm: { provider: "gemini", config: { apiKey: GOOGLE_API_KEY, model: LLM_MODEL } },
      // We don't use mem0's local SQLite op-history (Qdrant + SNAPSHOT.md are
      // our audit trail); disabling it avoids a stray memory.db in the repo.
      disableHistory: true,
    });
    return cached;
  } catch (err) {
    initFailed = true;
    try {
      console.error(`[mem0] init failed (memory disabled): ${String(err)}`);
    } catch {
      /* ignore */
    }
    return null;
  }
}

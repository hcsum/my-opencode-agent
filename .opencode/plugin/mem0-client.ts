import "./mem0-env"; // MUST be first — sets MEM0_TELEMETRY before mem0 loads
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Memory } from "mem0ai/oss";

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
// Cheap extractor LLM — mem0 runs it on every add; NEVER the expensive session
// model (openai/gpt-5.4). Default to the cheapest current Gemini flash.
const LLM_MODEL = process.env.MEM0_LLM_MODEL ?? "gemini-2.5-flash-lite";
// Embeddings run on Gemini (gemini-embedding-001). Its output dim is
// configurable (768 / 1536 / 3072); we pin it via embeddingDims below.
const EMBED_MODEL = process.env.MEM0_EMBED_MODEL ?? "gemini-embedding-001";
// Set explicitly so mem0 doesn't probe the provider for the dimension on first
// use (that probe is an extra embedding call). 1536 keeps the Qdrant collection
// dimension unchanged from the original OpenAI setup; Gemini supports it.
const EMBED_DIMS = Number(process.env.MEM0_EMBED_DIMS) || 1536;

// Our low-recall extraction gate, injected as mem0's `customInstructions` (which
// lands as a "## Custom Instructions" section in the extraction prompt). mem0's
// base prompt is high-recall by design; this biases it hard toward dropping
// task-episodic noise and the assistant's own advice. Kept in an external file
// so it's reviewable/editable without touching code.
function loadExtractionGate(): string | undefined {
  try {
    const here = dirname(fileURLToPath(import.meta.url)); // .opencode/plugin
    return readFileSync(join(here, "..", "memory", "EXTRACTION_GATE.md"), "utf8").trim() || undefined;
  } catch {
    return undefined; // no gate file → fall back to mem0's default behavior
  }
}
const CUSTOM_INSTRUCTIONS = loadExtractionGate();

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
      // Low-recall gate (../memory/EXTRACTION_GATE.md) layered onto mem0's
      // high-recall base extraction prompt.
      ...(CUSTOM_INSTRUCTIONS ? { customInstructions: CUSTOM_INSTRUCTIONS } : {}),
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

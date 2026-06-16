# mem0 Integration — Pikachū auto-memory layer

> Status: IMPLEMENTED & WORKING. Reflects the as-built state (updated after the
> Gemini switch + quality refinements). One optional piece remains — see
> "Open items: compaction" at the bottom.
>
> Scope: replaces the `.opencode/plugin/memory.ts` auto-memory layer
> (`notes/memory/`) ONLY. Everything else under `notes/` (knowledge/, todos.md,
> user.md, credentials/, my-files/, seo/) is OUT OF SCOPE and untouched.

## Why

The old `notes/memory/` layer (`memory.ts`) had two problems:

1. **Bad writes** — the background extractor stored task-episodic junk.
2. **Context bloat** — recall = the *entire* `MEMORY.md` index (~9.7 KB) loaded into
   EVERY session via `instructions`, growing O(n) with the store.

mem0's `search(query)` fixes #2 (retrieve only relevant memories per request, pull-based).
#1 is addressed by a custom low-recall extraction gate + an assistant-attribution prune
(see below); residual *overlap* is left to a future compaction pass.

## Current architecture (as built)

| Concern | Choice |
|---|---|
| Vector store | **Qdrant** (docker), collection `pikachu_memory` (+ `pikachu_memory_entities`), 1536-dim |
| Embeddings | **Gemini** `gemini-embedding-001` (`embeddingDims: 1536`) |
| Extraction LLM | **Gemini** `gemini-2.5-flash` (via `MEM0_LLM_MODEL`; code default `gemini-2.5-flash-lite`) |
| API key | single **`GOOGLE_API_KEY`** (no OpenAI) |
| History | mem0 SQLite history **disabled**; Qdrant + `SNAPSHOT.md` are the audit trail |

### Write path (single writer)
- ONE writer: `extract(sessionID)` in `mem0-memory.ts`. It reads new messages since the
  per-session watermark and calls `mem.add(transcript, { userId, metadata, infer:true })`.
- **`infer:true`** → mem0's own LLM extraction (high-recall base prompt) **biased by our
  low-recall gate** passed as `customInstructions` (see below).
- **Triggers** (both fire the SAME `extract()`, never a second independent add):
  - `session.idle` → `scheduleExtract` (60s debounce).
  - `session.deleted` → immediate flush.
  - Explicit `记住/remember` keyword in `chat.message` → fires `extract()` early via a short
    5s debounce (`MEMORY_KEYWORD_DEBOUNCE_MS`) and tags the batch `source:"explicit"`.
  - This single-writer design is what eliminated the explicit/idle **double-write race**.

### Read path (pull-based)
- `search_memories` **tool** the model calls on demand. `mem.search(query, { user_id })`,
  top-K (default 5). Nothing is auto-injected; the store can grow without inflating context.
- `notes/memory/MEMORY.md` was removed from `instructions` (fixes context bloat).

### Provenance & scoping (IMPORTANT)
- Everything is scoped to **`userId` only**. The session id is stored as
  **`metadata.sessionId`**, NOT as `runId`.
- Why: mem0 uses `run_id` as a *hard retrieval filter* for dedup-on-add, so a per-session
  `runId` silos dedup per session and lets the same fact re-accumulate across sessions
  (the original "donut ×3" bug). One user pool keyed by `user_id` lets dedup see prior facts.

### mem0 payload reference (each Qdrant point)
`{ ...metadata (source, sessionId), data: <fact text>, textLemmatized, hash, createdAt,
updatedAt, user_id, attributedTo? }`. The fact text is readable in `data`, so the Qdrant
dashboard (localhost:6333/dashboard) and `getAll()` are browsable. mem0 does NOT auto-store
source/message-id provenance — we inject `source`/`sessionId` ourselves.

## Quality controls

### Extraction gate (low-recall) — `customInstructions`
- mem0's built-in extraction prompt (`ADDITIVE_EXTRACTION_PROMPT`, compiled into
  `node_modules/mem0ai/dist/oss/index.mjs`) is **high-recall by design** ("sole operation is
  ADD", "extract every piece", "extract assistant recommendations as 'User was recommended X'")
  and is **not config-overridable**.
- We counter it with an external gate file **`.opencode/memory/EXTRACTION_GATE.md`**, loaded by
  `mem0-client.ts` and passed as mem0's `customInstructions` (which lands as a
  `## Custom Instructions` section appended to the prompt). It enforces the "restateable next
  month in a different task?" test, the four categories, and hard-drops for assistant
  advice/acknowledgments and task-episodic noise.
- Honest limitation: this *biases* the high-recall base prompt toward dropping; it does not
  fully replace it. True low-recall would require patching the dist (not done).

### Assistant-attribution prune (deterministic)
- mem0 sometimes stores the assistant's own statements with `attributedTo: "assistant"`.
- `pruneAssistantAttributed()` does a direct Qdrant filtered-delete of those points
  (`filter: attributedTo == "assistant"`), no LLM/embedding. Runs in the maintenance pass
  (before each snapshot) so it doesn't slow `add`.

### Audit snapshot (one-way)
- `maybeSnapshot()` regenerates `notes/memory/SNAPSHOT.md` from `getAll()` on churn (every 5
  adds) / interval (12h). The notes repo's daily sync commits it → grep / git log -p / diff
  review. Snapshot is disposable; mem0/Qdrant is the store of record.

## Config / env (`.env`)
- `GOOGLE_API_KEY` — required (embeddings + extraction).
- `QDRANT_URL` (default `http://localhost:6333`), `MEM0_USER_ID` (`sum`).
- Optional: `MEM0_LLM_MODEL` (set to `gemini-2.5-flash`), `MEM0_EMBED_MODEL`,
  `MEM0_EMBED_DIMS`, `MEM0_COLLECTION`, `MEMORY_*_DEBOUNCE_MS`, `MEMORY_SNAPSHOT_*`,
  `MEM0_TELEMETRY` (defaults off via `mem0-env.ts`).

## Files
- **NEW:** `.opencode/plugin/mem0-client.ts` (configured `Memory` + gate loader),
  `.opencode/plugin/mem0-memory.ts` (plugin: extract/search/prune/snapshot),
  `.opencode/plugin/mem0-env.ts` (loads `.env` + disables telemetry before mem0 import),
  `.opencode/memory/EXTRACTION_GATE.md` (low-recall gate).
- **EDIT:** `.opencode/opencode.json` (plugin list + instructions), `docker-compose.yml`
  (qdrant), `.env.example`, `.opencode/memory/PROTOCOL.md` (pull-based),
  `scripts/start-opencode-serve.sh` (forwards `GOOGLE_API_KEY`).
- **RETIRED (decommissioned, file kept):** `.opencode/plugin/memory.ts`; old
  `notes/memory/*.md` + `MEMORY.md` remain inert (no longer in `instructions`).

## History / skipped
- **Phase 5 backfill SKIPPED** — started the mem0 store clean rather than migrating the old 50
  files (mostly the task-episodic junk this work set out to leave behind; durable facts already
  in CLAUDE.md / notes/user.md / AGENTS.md / skills). `scripts/mem0-backfill.ts` was written
  then removed (recoverable from git if a selective import is ever wanted).
- **Backend was OpenAI in the original plan**, switched to Gemini (single key, fully on Google).

## Verification (done)
1. Gemini key valid, Qdrant healthy, models respond (200): `gemini-embedding-001`,
   `gemini-2.5-flash`.
2. Live add/search round-trip works; memories land in Qdrant with `source` + `sessionId`.
3. Cross-session dedup: removing `runId` collapsed the "donut ×3" duplication into one pool.
4. Gate: assistant-advice junk ("User was advised to…") and over-extraction eliminated; durable
   facts retained.
5. Race: single writer → no explicit/idle duplicate.

## Open items: compaction (semantic-overlap consolidation) — DEFERRED, not implemented

### The problem
The active write path (mem0-ts OSS additive pipeline) is **ADD-only with exact-text hash
dedup**. So memories that *mean* the same thing but are worded differently are **not merged** —
they coexist and slowly accumulate. Observed example (both passed the gate, both kept):
- "User prefers matcha over coffee"
- "User cannot drink coffee because it causes their heart to race, but matcha is acceptable"

The extraction gate stops *junk*; it does **not** look across the store for *overlap*. Removing
`runId` (so dedup sees the whole user pool) made the LLM skip obvious exact restatements, but
differently-worded near-duplicates still slip in. Impact is low (search still returns relevant
hits) but the store bloats over time.

### What mem0 does / doesn't provide (verified in source)
- **No standalone batch "compaction"** anywhere in mem0 (Python or TS). Confirmed by grep —
  there is no whole-store merge/reconcile feature.
- mem0 **does** ship a write-time UPDATE/DELETE "smart memory manager" flow
  (`DEFAULT_UPDATE_MEMORY_PROMPT` in Python; `getUpdateMemoryMessages` helper in TS). It's a
  *different `add` pipeline* than the additive one — and in the installed TS version
  `getUpdateMemoryMessages` is **imported but never called** (`add` runs
  `ADDITIVE_EXTRACTION_PROMPT`). The two pipelines are mutually exclusive.
- Therefore switching to mem0's native consolidation would require a **fork/patch of mem0-ts**,
  and would **replace the additive prompt** and change how our `EXTRACTION_GATE.md` gate is
  injected. NOT worth it.

### Chosen approach (when we do it): external compaction pass — NO fork
Use mem0's **public API** as a separate maintenance step, orthogonal to `add` (so the additive
pipeline + the gate stay exactly as-is, on stock `mem0ai`):
- `getAll({ user_id })` → hand the whole store to an LLM → reconciliation plan
  (merge near-dups / delete superseded / rewrite / **flag** genuine contradictions, never guess)
  → apply via `mem.add` / `mem.delete`.
- Ride the existing `maybeSnapshot` maintenance tick (churn/interval). `SNAPSHOT.md` (git-
  committed by the notes sync) is the revertable safety net.
- The reconciliation **logic already exists** in the retired `.opencode/plugin/memory.ts`
  (Layer B compaction: `COMPACT_SYSTEM` prompt + merge/delete/rewrite/flag ops). Port it,
  swapping markdown file I/O for `getAll`/`add`/`delete`.

### Why deferred
Not worth building until the store has grown enough to actually contain real overlap; at a
handful of memories there is nothing to compact. Revisit when SNAPSHOT.md shows accumulating
near-duplicates.

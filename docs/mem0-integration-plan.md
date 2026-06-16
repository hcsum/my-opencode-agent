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
  `getUpdateMemoryMessages` does not exist in `mem0ai@3.0.8` dist at all (`add` runs
  `ADDITIVE_EXTRACTION_PROMPT` only). The two pipelines are mutually exclusive.
- Therefore switching to mem0's native consolidation would require a **fork/patch of mem0-ts**,
  and would **replace the additive prompt** and change how our `EXTRACTION_GATE.md` gate is
  injected. NOT worth it.

### Community context (GitHub findings, 2026-06)
- **Issue #4896 closed "not planned"**: Official position — semantic conflict resolution will NOT
  be added to the additive pipeline. The team's answer is memory linking + client-side retrieval
  prioritization, not write-time merging.
- **Issue #4573** ("97.8% junk" production audit, 10,134 entries, 32 days):
  - The extraction prompt is the bottleneck, not the model. Upgrading from gemma2:2b to
    Sonnet 4.6 made extraction *worse* — a better model follows the permissive default prompt
    more faithfully, so it extracts more indiscriminately.
  - Largest junk category (52.7%): **system prompt / boot file restating** — the agent's own
    instructions get re-extracted every session.
  - **Feedback loop amplification** is a confirmed production risk: memories recalled into
    context are treated as new conversation content by the extraction LLM and re-extracted.
    One hallucinated "User prefers Vim" became 808 copies over 32 days. Our EXTRACTION_GATE
    should explicitly instruct the LLM to skip content that looks like a recalled memory.
  - Their fix recommendation: negative few-shot examples in the extraction prompt (what NOT to
    store), and a REJECT action in the update-decision prompt — both missing from the additive
    pipeline.
- **Issue #5352** (external workaround, open): Someone open-sourced a drop-in recipe:
  timestamp + UUID prefixing on recall output, explicit `mem0_update(id)`/`mem0_delete(id)`
  agent tools, and a weekly hygiene script (cosine ≥ 0.82 cluster → LLM merge → SDK
  update/delete). Same pattern as our planned external compaction pass.
- **PR #4302** (merged): `openclaw/` plugin in the mem0 repo added `filtering.ts`,
  `isolation.ts`, and `DEFAULT_CUSTOM_INSTRUCTIONS`. These are in a **separate `openclaw`
  package**, not in the `mem0ai` npm package — they are NOT in our `mem0ai@3.0.8` install.
- **PR #5254** (open, unmerged as of 2026-06): Adds per-call `prompt` override to
  `AddMemoryOptions` (TS parity with Python). Would let explicit "记住" triggers use a
  stricter gate than idle session writes. Not yet usable.

### Implementation (as built, 2026-06)

Implemented in `mem0-memory.ts` as a maintenance pass orthogonal to `add`. Key design:

- **Trigger**: every 20 adds (`COMPACT_CHURN`) OR 24 hours (`COMPACT_INTERVAL_MS`), whichever
  comes first. Guard: skips if store has fewer than 10 entries (`COMPACT_MIN_ENTRIES`).
- **Pass**: `getAll({ user_id })` → integer-indexed listing (UUID anti-hallucination trick,
  same as mem0's own extraction) → single Gemini call with `COMPACT_SYSTEM` prompt → parse
  ops → apply via `mem.add` / `mem.delete` / `mem.update` → force snapshot.
- **Ops**: `merge` (add merged entry, delete sources) / `delete` / `rewrite` (in-place update)
  / `flag` (unresolvable contradictions written to `notes/memory/CONFLICTS.md`).
- **Safety**: `COMPACT_MAX_CHARS = 80_000` hard limit — skips the LLM call if the serialized
  store exceeds this. `SNAPSHOT.md` (git-committed by notes sync) is the revert safety net.
- **Model**: `COMPACT_MODEL` env var (defaults to `MEM0_LLM_MODEL`, i.e. `gemini-2.5-flash`).
  Direct Gemini REST call — no extra SDK dependency.
- **Env vars**: `MEMORY_COMPACT_ENABLED` (default on), `MEMORY_COMPACT_CHURN`,
  `MEMORY_COMPACT_MIN_ENTRIES`, `MEMORY_COMPACT_INTERVAL_MS`, `MEMORY_COMPACT_MODEL`.

**Requires opencode server to be running** — all state (`addsSinceCompact`, `lastCompactAt`)
is in-process memory. Process restart resets counters. On VPS where opencode runs continuously
this is fine; local instances shouldn't rely on compaction firing reliably.

### Known limitation: whole-store pass

Every compaction run feeds the **entire store** to the LLM in one call. Cost grows linearly
with store size. Current mitigations:
- `COMPACT_MAX_CHARS = 80_000` aborts the call if the store is too large (but then compaction
  never runs, which is also bad).
- `COMPACT_CHURN = 20` and `COMPACT_INTERVAL_MS = 24h` keep the cadence low.

**Not a problem now** (store is small), but will need a proper fix at scale. The right
approach is semantic clustering: group memories by cosine similarity, compact only within
each cluster. This avoids the whole-store pass entirely. Deferred until the store is large
enough to warrant it.

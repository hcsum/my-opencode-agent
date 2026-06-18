#!/usr/bin/env -S npx tsx
/**
 * Claude Code Stop-hook counterpart of the OpenCode plugin's idle extraction
 * (.opencode/plugin/mem0-memory.ts → extract()). Fires when Claude finishes a
 * turn; feeds the new transcript since a per-session watermark to mem0's own
 * `infer:true` extractor, which decides what (if anything) is durable and
 * dedups/updates against the SHARED store (same user_id as the OpenCode runtime).
 *
 * The extraction behavior itself (watermark, slicing, gate, mem.add) lives in
 * the shared `mem0-extract.ts`; this file only NORMALIZES Claude's transcript
 * JSONL into NormMsg[]. Snapshot/compaction are NOT run here (their churn state
 * is in-memory in the long-lived OpenCode plugin, which owns that maintenance
 * against the same store); a hook is a fresh process per turn.
 *
 * Reads Claude's hook JSON from stdin: { session_id, transcript_path, cwd, ... }.
 * Always exits 0 — memory must never block or fail a turn.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runExtraction, type NormMsg } from "./mem0-extract";

const EXTRACT_ENABLED = process.env.MEMORY_EXTRACT_ENABLED !== "0";
// Worker mode (argv: --worker <payload-file>) does the actual mem0 add. The
// foreground hook process detaches into this so Claude's turn-end never blocks
// on the Gemini extraction call.
const WORKER_FLAG = "--worker";

/** Extract ordered user/assistant text turns from a Claude transcript JSONL.
 * Skips meta/sidechain rows, tool_use/tool_result parts, and non-message types. */
function parseTranscript(file: string): NormMsg[] {
  const out: NormMsg[] = [];
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return out;
  }
  for (const line of raw.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    let d: any;
    try {
      d = JSON.parse(s);
    } catch {
      continue;
    }
    if (d.isMeta || d.isSidechain) continue;
    if (d.type !== "user" && d.type !== "assistant") continue;
    const content = d.message?.content;
    let text = "";
    if (typeof content === "string") {
      text = content;
    } else if (Array.isArray(content)) {
      // Only real text parts; drop tool_use / tool_result / images.
      text = content
        .filter((p: any) => p && p.type === "text" && typeof p.text === "string")
        .map((p: any) => p.text.trim())
        .filter(Boolean)
        .join("\n");
    }
    text = text.trim();
    if (!text) continue;
    out.push({ id: d.uuid ?? "", role: d.type, text });
  }
  return out;
}

/** Worker: read the hook payload from a file, run the extraction, delete the file. */
async function runWorker(payloadFile: string) {
  let hook: any;
  try {
    hook = JSON.parse(fs.readFileSync(payloadFile, "utf8"));
  } catch {
    return;
  } finally {
    try {
      fs.unlinkSync(payloadFile);
    } catch {
      /* already gone */
    }
  }
  const sessionID: string = hook.session_id;
  const transcriptPath: string = hook.transcript_path;
  const root: string = hook.cwd || process.cwd();
  if (!sessionID || !transcriptPath) return;

  await runExtraction({
    root,
    sessionID,
    messages: parseTranscript(transcriptPath),
    runtime: "claude",
    // No pending-explicit set in a fresh hook process: let runExtraction scan
    // the fresh user messages for a "记住/remember" keyword.
  });
}

/** Foreground: stash stdin to a temp file, detach a worker, return instantly so
 * the turn doesn't wait on the Gemini extraction call. */
async function runForeground() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  try {
    JSON.parse(input); // cheap validity gate before spawning anything
  } catch {
    return;
  }
  const payloadFile = path.join(
    os.tmpdir(),
    `mem0-hook-${process.pid}-${Date.now()}.json`,
  );
  fs.writeFileSync(payloadFile, input);

  const self = fileURLToPath(import.meta.url);
  const child = spawn("npx", ["tsx", self, WORKER_FLAG, payloadFile], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

async function main() {
  if (!EXTRACT_ENABLED) return;
  const workerIdx = process.argv.indexOf(WORKER_FLAG);
  if (workerIdx !== -1) {
    await runWorker(process.argv[workerIdx + 1]);
  } else {
    await runForeground();
  }
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));

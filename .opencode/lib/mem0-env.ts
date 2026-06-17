// Side-effect module: must be imported BEFORE "mem0ai/oss" so these env vars
// are set when mem0 reads them at module-evaluation time. (Import/require order
// is preserved, so importing this first reliably wins.)

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Disable mem0's PostHog telemetry + "notice flag" network calls. They are
// awaited inside add()/search() and the event-capture fetch has no timeout, so
// if PostHog egress is slow/blocked they stall memory writes. We also just
// don't want to phone home. Overridable via the real env if ever needed.
process.env.MEM0_TELEMETRY ??= "false";

// Load the project `.env` into process.env for keys the plugin needs, IF they
// aren't already set. opencode loads plugins in its own process and does NOT
// source `.env` — only the npm launcher script (opencode-local.sh) and the
// bridge's process env (which the in-process server inherits) carry it. So a
// bare `opencode` TUI launch has no GOOGLE_API_KEY, and mem0's Gemini client
// throws an auth error. Loading it here makes memory work regardless of how
// opencode started.
function findEnvFile(): string | null {
  // Walk up from cwd looking for a `.env` (cwd is normally the project root).
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function parseEnvLine(line: string): [string, string] | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const eq = trimmed.indexOf("=");
  if (eq <= 0) return null;
  const key = trimmed.slice(0, eq).trim();
  let val = trimmed.slice(eq + 1).trim();
  // Strip a single layer of matching surrounding quotes.
  if (val.length >= 2 && ((val[0] === '"' && val.at(-1) === '"') || (val[0] === "'" && val.at(-1) === "'"))) {
    val = val.slice(1, -1);
  }
  return [key, val];
}

try {
  const envPath = findEnvFile();
  if (envPath) {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const kv = parseEnvLine(line);
      if (!kv) continue;
      const [key, val] = kv;
      // Never clobber a value the real environment already provides (e.g. the
      // launcher scripts, or docker-compose, which set QDRANT_URL=qdrant:6333).
      if (process.env[key] === undefined) process.env[key] = val;
    }
  }
} catch {
  // If .env can't be read, fall back to whatever the process env already has;
  // mem0-client.ts logs a clear warning when GOOGLE_API_KEY ends up missing.
}

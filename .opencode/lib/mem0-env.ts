// Side-effect module: must be imported BEFORE "mem0ai/oss" so these env vars
// are set when mem0 reads them at module-evaluation time. (Import/require order
// is preserved, so importing this first reliably wins.)

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// Disable mem0's PostHog telemetry + "notice flag" network calls. They are
// awaited inside add()/search() and the event-capture fetch has no timeout, so
// if PostHog egress is slow/blocked they stall memory writes. We also just
// don't want to phone home. Overridable via the real env if ever needed.
process.env.MEM0_TELEMETRY ??= "false";

// Silence dotenv@17's promotional "injected env (N) … // tip: …" banner. mem0ai
// pulls in `natural`, which calls dotenv.config() at import time; v17 logs that
// line (with rotating ad tips) by default, and it leaks into the opencode TUI.
// dotenv reads this before logging, and we set it before mem0ai loads.
process.env.DOTENV_CONFIG_QUIET ??= "true";

// Route Node's global `fetch` (undici) through the proxy. mem0's Gemini client
// (embeddings + extraction LLM) uses global fetch, which — unlike curl or the
// OS — does NOT honor HTTP(S)_PROXY env vars. On a network where direct egress
// to Google is blocked behind a local proxy, every add()/search() then dies
// with "TypeError: fetch failed" (connect timeout to Google's IPs), silently
// disabling memory. EnvHttpProxyAgent reads HTTP_PROXY/HTTPS_PROXY/NO_PROXY, so
// it proxies Gemini while leaving local Qdrant (NO_PROXY=localhost) direct. No
// proxy set → it's a passthrough no-op, so this is safe everywhere (incl. VPS).
try {
  if (process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy) {
    const { setGlobalDispatcher, EnvHttpProxyAgent } = createRequire(import.meta.url)("undici");
    setGlobalDispatcher(new EnvHttpProxyAgent());
  }
} catch {
  // undici unavailable / API changed → leave the default dispatcher in place.
}

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

# opencode-agent

OpenCode workspace with local skills, local notes, and an optional Telegram bridge.

## What it does

- works directly in OpenCode as the primary interface
- keeps project-local skills, notes, and MCP wiring in one repo
- can optionally add a Telegram bridge on top of the same project setup
- keeps Telegram in one persistent Telegram-specific OpenCode session
- queues Telegram requests so prompts never overlap
- replies to Telegram only when a turn completes

## Included project skills

- `.opencode/skills/web-access` for local browser CDP access through your current Chrome session
- `.opencode/skills/x-home-feed` for reading and summarizing your X home feed
- `.opencode/skills/x-search` for searching X posts by keyword or topic
- `.opencode/skills/use-google-trends` for raw Google Trends comparisons
- `.opencode/skills/serp-inspection` for live SERP competition analysis
- `.opencode/skills/learn-seo` for learning durable Web.Cafe methodology into notes
- `.opencode/skills/refine-web-cafe-notes` for consolidating `notes/webcafe.md`
- `.opencode/skills/keyword-research` for writing durable keyword memos to `notes/keyword-research.md`
- `.opencode/skills/validate-keyword` for deciding whether a keyword is worth building around and whether it has commercial value
- `.opencode/skills/google-drive-backup` for uploading the local `notes/` directory to Google Drive with timestamped snapshots

## Requirements

- Node.js 22+
- `uv` / `uvx` available on PATH for the local `seo-mcp` server
- local sibling repo at `../seo-mcp`

## Modes

### 1. OpenCode only

If you only want to use the project in OpenCode, no Telegram and no shared server are required.

```bash
npm install
opencode
```

This mode uses:

- `opencode.json`
- `AGENTS.md`
- `.opencode/skills/*`
- `notes/*`
- local `seo` MCP

You do not need `.env` for this mode unless a skill or MCP dependency needs secrets like `CAPSOLVER_API_KEY`.

### 2. Telegram bridge with shared server

Use this when you want Telegram and OpenCode to talk to the same OpenCode server, but in separate sessions.

Requirements:

- a running OpenCode server, for example `opencode serve --port 4096`
- a Telegram bot token
- a filled `.env`

Start order:

```bash
opencode serve --port 4096
opencode attach http://127.0.0.1:4096
npm run dev
```

### 3. Telegram bridge without the TUI

If you only want the Telegram bridge and do not care about attaching the TUI to the same server, you can still run the server and the bridge without `opencode attach`.

## Setup

1. Install dependencies:

```bash
npm install
```

2. If you plan to use Telegram, copy `.env.example` to `.env` and fill in values.

3. If you plan to use Telegram, start an OpenCode server.

4. If you plan to use Telegram, start the bot:

```bash
npm run dev
```

## Sitemap Monitor

- Fixed watchlist lives in `notes/website-watchlist.csv` with header `site,sitemap_url`.
- Results are written to `notes/sitemap-slugs/<site>.csv` with header `site,slug,first_seen_at`.
- Each site keeps its own CSV file, with newest discovered rows first.
- The monitor tries direct fetch first and falls back to the local browser CDP path when direct fetch is blocked.

Run the monitor with the fixed watchlist:

```bash
npm run monitor:sitemaps
```

Add temporary targets on the command line:

```bash
npm run monitor:sitemaps -- --target dashmetry=https://dashmetry.com/sitemap.xml
```

## Environment

- `TELEGRAM_BOT_TOKEN`: Telegram bot token, only needed for the Telegram bridge
- `TELEGRAM_ALLOWED_CHAT_ID`: only this chat is serviced, only needed for the Telegram bridge
- `OPENCODE_BASE_URL`: base URL for the shared OpenCode server, only needed for the Telegram bridge
- `OPENCODE_SERVER_USERNAME`: optional basic auth username for the OpenCode server
- `OPENCODE_SERVER_PASSWORD`: optional basic auth password for the OpenCode server
- `CAPSOLVER_API_KEY`: used by the local `seo` MCP server when `seo-mcp` needs it
- `TELEGRAM_SESSION_TITLE`: optional title for the Telegram OpenCode session
- `STATE_FILE`: optional JSON state file path for the Telegram bridge's local runtime state, mainly the persisted OpenCode session ID used to resume the same Telegram conversation after restarts

## MCP

- `opencode.json` configures the local `seo` MCP server.
- The launcher script `scripts/run-seo-mcp.sh` reads `.env` and starts `seo-mcp` via `uvx`.
- It is pinned to the sibling local repo at `../seo-mcp`.
- `CAPSOLVER_API_KEY` is injected through the launcher script: `run-seo-mcp.sh` sources `.env` with `set -a`, exports the variables into the shell environment, and then `uvx` passes that environment through to the `seo-mcp` process.

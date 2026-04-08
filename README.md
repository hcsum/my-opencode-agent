# opencode-agent

Small Telegram bridge for an already-running OpenCode server.

## What it does

- connects to one shared OpenCode server via `@opencode-ai/sdk`
- accepts messages from one allowed Telegram chat
- sends them into one persistent Telegram-specific OpenCode session
- queues requests so prompts never overlap
- replies only when a turn completes

## Included project skills

- `.opencode/skills/web-access` for local browser CDP access through your current Chrome session
- `.opencode/skills/x-home-feed` for reading and summarizing your X home feed
- `.opencode/skills/x-search` for searching X posts by keyword or topic
- `.opencode/skills/check-google-trends` for raw Google Trends comparisons
- `.opencode/skills/check-serp-inspection` for live SERP competition analysis
- `.opencode/skills/learn-web-cafe` for learning durable Web.Cafe methodology into notes
- `.opencode/skills/refine-web-cafe-notes` for consolidating `notes/webcafe.md`
- `.opencode/skills/keyword-research` for writing durable keyword memos to `notes/keyword-research.md`

## What it does not do

- no scheduler
- no multi-channel routing
- no container runtime
- no database
- no shared session with the TUI

## Requirements

- Node.js 22+
- a running OpenCode server, for example `opencode serve --port 4096`
- a Telegram bot token
- `uv` / `uvx` available on PATH for the local `seo-mcp` server
- local sibling repo at `../seo-mcp`

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env` and fill in values.

3. Start OpenCode server.

4. Start the bot:

```bash
npm run dev
```

## Environment

- `TELEGRAM_BOT_TOKEN`: Telegram bot token
- `TELEGRAM_ALLOWED_CHAT_ID`: only this chat is serviced
- `OPENCODE_BASE_URL`: base URL for the shared OpenCode server
- `OPENCODE_SERVER_USERNAME`: optional basic auth username
- `OPENCODE_SERVER_PASSWORD`: optional basic auth password
- `CAPSOLVER_API_KEY`: passed to the local `seo-mcp` MCP server through `scripts/run-seo-mcp.sh`
- `TELEGRAM_SESSION_TITLE`: optional title for the OpenCode session
- `STATE_FILE`: optional JSON state file path for the Telegram bridge's local runtime state, mainly the persisted OpenCode session ID used to resume the same Telegram conversation after restarts

## MCP

- `opencode.json` configures a local `seo` MCP server.
- The launcher script `scripts/run-seo-mcp.sh` reads `.env` and starts `seo-mcp` via `uvx`.
- It is pinned to the sibling local repo at `../seo-mcp`.
- `CAPSOLVER_API_KEY` is injected through the launcher script: `run-seo-mcp.sh` sources `.env` with `set -a`, exports the variables into the shell environment, and then `uvx` passes that environment through to the `seo-mcp` process.

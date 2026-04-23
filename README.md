# opencode-agent

This repo now runs channel bridges on top of the Codex SDK (`@openai/codex-sdk`), not the OpenCode SDK.

## Current Architecture

- `src/codex.ts`: wraps Codex threads (`startThread` / `resumeThread` / `run`)
- `src/telegram.ts`: Telegram inbound/outbound bridge
- `src/gmail.ts`: Gmail polling + reply bridge
- `src/state.ts`: persists channel session keys to Codex thread IDs in `.data/state.json`
- `AGENTS.md` + `.codex/skills` (symlink to `.opencode/skills`): native Codex CLI guidance/skills

## Requirements

- Node.js 22+
- npm dependencies installed (`npm install`)
- Codex SDK auth:
  - set `CODEX_API_KEY`, or
  - set `OPENAI_API_KEY`, or
  - rely on existing Codex CLI auth on your machine
- Gmail channel additionally requires OAuth files under `~/.gmail-mcp/`:
  - `gcp-oauth.keys.json`
  - `credentials.json`

## Environment

Copy `.env.example` to `.env` and fill what you need.

Key variables:

- `CHANNELS`: comma-separated channels (`telegram,gmail`, `gmail`, `telegram`)
- `CODEX_API_KEY` / `OPENAI_API_KEY`: auth for Codex SDK
- `OPENAI_BASE_URL`: optional custom base URL
- `CODEX_APPROVAL_POLICY`: default `never` for non-interactive bridge runs
- `CODEX_SANDBOX_MODE`: `read-only` | `workspace-write` | `danger-full-access`
- `CODEX_ADDITIONAL_DIRS`: optional comma-separated extra directories for Codex sandbox
- `STATE_FILE`: local state file for persisted thread IDs
- `GMAIL_TO`: target inbox address to poll
- `GMAIL_POLL_INTERVAL_MS`: polling interval
- `TELEGRAM_BOT_TOKEN` / `TELEGRAM_ALLOWED_CHAT_ID`: required only when Telegram is enabled

## Run

Install:

```bash
npm install
```

Run both channels:

```bash
npm run dev
```

Run Gmail channel only:

```bash
npm run dev:gmail
```

Reauthorize Gmail OAuth (when you see `invalid_grant`):

```bash
npm run gmail:reauth
```

Production-style Gmail start (build + node):

```bash
npm run build
npm run start:gmail
```

## Notes

- This bridge is non-interactive by design; `CODEX_APPROVAL_POLICY=never` avoids blocked tool approval prompts.
- If `CHANNELS=gmail`, Telegram env vars are not required.
- If startup fails with `invalid_grant`, your refresh token is invalid/expired. Run `npm run gmail:reauth` and then `npm run start:gmail`.
- For browser-based skills under `workspace-write`, keep `CODEX_NETWORK_ACCESS=true`. By default the bridge also adds `$HOME`, `~/.web-access`, and `~/.gmail-mcp` to `additionalDirectories`.

---
source_url: https://github.com/grinev/opencode-telegram-bot
raw_file: ../../raw/processed/github-grinev-opencode-telegram-bot.md
source_type: github-repository
date_ingested: 2026-05-17
---

# Opencode Telegram Bot

**Author:** grinev  
**Repository:** https://github.com/grinev/opencode-telegram-bot  

## What It Is

A Telegram bot client for the OpenCode CLI. It lets users run and monitor AI coding tasks from their phone, with everything executing locally on their machine.

## Architecture

- **Interface:** Telegram Bot API
- **Backend:** OpenCode CLI (local execution)
- **Pattern:** Bridge / client wrapper — the bot acts as a remote control layer over the local OpenCode instance
- **Deployment model:** Fully local; no cloud hosting of the OpenCode agent itself

## Use Cases

- Start OpenCode sessions remotely from mobile
- Monitor task progress while away from the computer
- Receive notifications about completion or errors

## Comparison with User's Project

The user's `opencode-agent` (this repo) is architecturally similar but differs in scope:

| Aspect | grinev/opencode-telegram-bot | User's opencode-agent |
|--------|------------------------------|----------------------|
| Platform | Telegram | Telegram |
| OpenCode integration | Direct CLI wrapper | SDK-based bridge (`@opencode-ai/sdk`) |
| Scale | Personal / single-user | Shared server / potentially multi-user |
| Additional features | Basic run/monitor | Skills, notes, Gmail bridge |
| Stack | Not specified | TypeScript, SQLite, Telegraf |

## Related Projects

- **[[entities/kimaki.md|Kimaki]]** — Discord bot controlling OpenCode sessions
- **[[entities/open-dispatch.md|Open Dispatch]]** — Slack/Teams bridge with 75+ AI providers
- **[[entities/hcom.md|hcom]]** — Cross-terminal agent messaging (Claude Code, Gemini CLI, Codex CLI, OpenCode)

## Source

**Original URL:** https://github.com/grinev/opencode-telegram-bot  
**Source path:** `notes/knowledge/raw/processed/github-grinev-opencode-telegram-bot.md`  
**Discovered via:** [awesome-opencode](https://github.com/awesome-opencode/awesome-opencode) curated community list

## Summary

grinev/opencode-telegram-bot is a Telegram bot client for OpenCode CLI that enables remote monitoring and control of AI coding tasks from mobile devices, with all execution happening locally on the user's machine.

## Key Takeaways

- Architecture pattern: Bridge / client wrapper over local OpenCode CLI
- Use case: Mobile remote control of OpenCode sessions
- Stack: Telegram Bot API + OpenCode CLI (local)
- Relation to user's project: Similar Telegram bridge concept, but user's project uses OpenCode SDK (`@opencode-ai/sdk`) and targets shared/multi-user scenarios with additional features (skills, notes, Gmail)
- Related projects in same space: Kimaki (Discord), Open Dispatch (Slack/Teams), hcom (cross-terminal messaging)

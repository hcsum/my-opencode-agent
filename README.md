# My Opencode Agent

This repo mainly contains 2 parts: 
- a `.opencode` folder containing the agent skills that I wrote or curated from else where
- an Opencode runtime with a Gmail bridge 

## How I use this agent

I use this project in 2 ways:

- Deploy the agent to the cloud and talk to the agent via the Gmail bridge
- Run an OpenCode TUI on this repo on my computer  

## Features of this agent 

- Web research through the web-access skill, can connect to a local browser if on my computer, or use BrowserBase remote browser if running on the VPS
- LLM Wiki for accumulating and consolidating knowledge overtime

## Notes repo

`notes/` is a separate private Git repo that lives at the same path the agent already expects.

The standard setup and workflow live in `docs/notes-repo.md`.

Set `NOTES_REPO_URL` in `.env`, then use these commands:

Local can use `https://github.com/hcsum/my-agent-notes.git`.
VPS should use the SSH host alias you configured for the deploy key, for example `git@github.com-my-agent-notes:hcsum/my-agent-notes.git`.
If unset, the scripts default to branch `main` and remote `origin`.

- `npm run notes:bootstrap` to initialize `notes/` in a standard way
- `npm run notes:ensure` to clone `notes/` if it does not exist yet
- `npm run notes:sync` to pull the latest notes changes with `--rebase --autostash`
- `npm run notes:backup` to push a timestamped `notes/` backup to Google Drive

The local OpenCode entrypoints already call `notes:ensure`, and the VPS deploy workflow calls `notes:sync` before `docker compose up --build`.
If a machine still has a pre-migration plain `notes/` directory, the bootstrap logic renames it to `notes.pre-git-migration.<timestamp>` before cloning the private repo.

Because `notes/` is its own repo, commit and push notes changes from inside `notes/`, not from the parent repo.

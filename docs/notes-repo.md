# Notes Repo Workflow

`notes/` is a separate private Git repo that stays mounted at `./notes` so the agent can keep using the same paths.

## Source of truth

- `notes/` has its own commit history, remotes, and pushes.
- The parent repo must not track files inside `notes/`.
- Notes changes must be committed from inside `notes/`, not from the parent repo.

## Required config

Set `NOTES_REPO_URL` in the repo root `.env` when a machine may need to clone or repair the local `notes` remote.

Examples:

- Local: `NOTES_REPO_URL=https://github.com/hcsum/my-agent-notes.git`
- VPS: `NOTES_REPO_URL=git@github.com-my-agent-notes:hcsum/my-agent-notes.git`

Defaults built into the scripts:

- branch: `main`
- remote: `origin`

## Standard commands

- `npm run notes:bootstrap`
Initializes `./notes` if missing and prints the current branch and origin URL.

- `npm run notes:sync`
Runs `git pull --rebase --autostash` inside `notes/`.

- `npm run notes:backup`
Uploads a timestamped Google Drive backup of `notes/`.

## Local setup

1. Set `NOTES_REPO_URL` in `.env` if this machine may need to clone `notes/`.
2. Run `npm run notes:bootstrap`.
3. Work normally.
4. Commit notes changes inside `notes/`.

## VPS setup

1. Configure a repo-scoped deploy key for `my-agent-notes`.
2. Add an SSH host alias like `github.com-my-agent-notes` in `/home/deploy/.ssh/config`.
3. Set `NOTES_REPO_URL=git@github.com-my-agent-notes:hcsum/my-agent-notes.git` in the project `.env` on the VPS.
4. Deploy normally. The GitHub Actions workflow already runs `bash scripts/sync-notes.sh` before `docker compose up -d --build`.

## Day-to-day workflow

1. Before editing shared notes on a machine, run `npm run notes:sync` if you are not sure it is current.
2. Edit files under `notes/`.
3. Commit and push from inside `notes/`.
4. If another machine also writes to notes, sync there before editing.

## Failure cases

- `NOTES_REPO_URL is required`
The machine tried to clone `notes/` but no repo URL was configured.

- `expected .../notes to be a git repo, but it exists without .git`
The `notes/` directory exists but is not a valid checkout. If `NOTES_REPO_URL` is set, bootstrap now auto-renames that directory to `notes.pre-git-migration.<timestamp>` and reclones `notes/`. If no repo URL is configured, repair or replace it before rerunning bootstrap.

- `Permission denied (publickey)` on VPS
The deploy key or SSH host alias is missing or incorrect.

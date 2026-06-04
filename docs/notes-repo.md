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

### Auth: HTTPS token (recommended) vs SSH key

`scripts/ensure-notes.sh` supports two auth modes and picks one automatically:

- **`NOTES_REPO_TOKEN` set** → the `notes` remote is rewritten to HTTPS
  (`https://github.com/<owner>/<repo>.git`, derived from `NOTES_REPO_URL` in any
  form) and authenticated with the token via a git credential helper. The
  helper reads the token from the environment at call time, so it is never
  written into `.git/config` or any tracked file. This is the only mode that
  works **identically everywhere** — the container (which runs as root with no
  ssh client or ssh config), the host, and CI — so it lets the agent push notes
  from inside the container.
- **`NOTES_REPO_TOKEN` unset** → falls back to using `NOTES_REPO_URL` as-is
  (SSH/host-alias). This only works where the matching ssh key + config exist
  (historically only the `deploy` user's home), so the container cannot push.

`docker compose` already passes `.env` into the container via `env_file`, so a
token placed in `.env` reaches the container with no further wiring.

## Standard commands

- `npm run notes:bootstrap`
Initializes `./notes` if missing and prints the current branch and origin URL.

## Local setup

1. Set `NOTES_REPO_URL` in `.env` if this machine may need to clone `notes/`.
2. Run `npm run notes:bootstrap`.
3. Work normally.
4. Use normal Git commands inside `notes/` to sync, commit, and push changes.

## VPS setup (recommended: HTTPS token)

This keeps the whole auth mechanism in code; the only host-specific artifact is
the token value in `.env`. It works the same for the host, the deploy pipeline,
and the container.

1. Create a GitHub fine-grained PAT scoped to `hcsum/my-agent-notes` with
   Contents: read and write.
2. In the project `.env` on the VPS set:
   - `NOTES_REPO_URL=https://github.com/hcsum/my-agent-notes.git`
     (an SSH form also works; the HTTPS URL is derived from it)
   - `NOTES_REPO_TOKEN=<the PAT>`
3. Deploy normally. `scripts/ensure-notes.sh` switches the `notes` remote to
   HTTPS and configures the env-reading credential helper; the deploy workflow
   sources `.env` before pulling notes and treats a notes-pull failure as
   non-fatal so it never blocks the code deploy. `docker compose` passes the
   token into the container via `env_file: .env`, so the agent can push notes
   from inside the container too.

### Legacy: SSH deploy key (still supported)

If `NOTES_REPO_TOKEN` is unset, the scripts fall back to the SSH form of
`NOTES_REPO_URL`:

1. Configure a repo-scoped deploy key for `my-agent-notes`.
2. Add an SSH host alias like `github.com-my-agent-notes` in `/home/deploy/.ssh/config`.
3. Set `NOTES_REPO_URL=git@github.com-my-agent-notes:hcsum/my-agent-notes.git` in `.env`.

Note: that ssh key/alias only lives in the `deploy` user's home, so the
container (running as root, no ssh client) cannot push notes with it — which is
exactly why the token approach above is preferred.

## Day-to-day workflow

1. Before editing shared notes on a machine, run `git pull --rebase --autostash` inside `notes/` if you are not sure it is current.
2. Edit files under `notes/`.
3. On a machine with write access, use normal Git commands inside `notes/` to stage, commit, and push.
4. If another machine also writes to notes, sync there before editing.

## Failure cases

- `NOTES_REPO_URL is required`
The machine tried to clone `notes/` but no repo URL was configured.

- `expected .../notes to be a git repo, but it exists without .git`
The `notes/` directory exists but is not a valid checkout. If `NOTES_REPO_URL` is set, bootstrap now auto-renames that directory to `notes.pre-git-migration.<timestamp>` and reclones `notes/`. If no repo URL is configured, repair or replace it before rerunning bootstrap.

- `Permission denied (publickey)` on VPS
The deploy key or SSH host alias is missing or incorrect.

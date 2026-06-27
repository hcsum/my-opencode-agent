# Deployment Guide

Canonical, low-friction procedure for standing up the opencode-agent bridge on
a VPS. The goal: **everything that can live in code lives in code**; the only
manual work is a short, fixed list of secrets that by definition cannot be
committed.

For LLM-guided deployment, the `deploy-agent` skill drives this document.

## Mental model: three buckets

| Bucket | In repo? | Where it lives |
| --- | --- | --- |
| Code + mechanism | ✅ yes | this repo |
| Secrets (tokens, OAuth, keys) | ❌ never | VPS `.env` + `.secrets/` + GitHub Actions secrets |
| VPS provisioning | scripted | `scripts/provision-vps.sh` |

The whole point of the design is to keep buckets 2 and 3 small and explicit.

## Architecture (what runs where)

- The agent runs in a **Docker container** on the VPS, started by
  `docker compose` as an **unprivileged `deploy` user** (never root).
- Deploy is a **GitHub Action** (`.github/workflows/deploy.yml`) that fires on
  push to `main`: it SSHes in as `deploy`, `git reset --hard origin/main`,
  syncs the `notes` repo, then `docker compose up -d --build`.
- `notes/` is a **separate private git repo** mounted into the container; the
  agent reads and writes it. See `docs/notes-repo.md`.
- Host-side credential/state dirs are **project-relative** (`./.secrets/...`),
  so they resolve to the same path regardless of which user runs compose.

## Prerequisites

- A VPS (root SSH access for the one-time provisioning).
- A GitHub repo for the agent code (this repo / a fork).
- A separate private GitHub repo for `notes`.
- Accounts/keys for any integrations you use (Gmail, Browserbase, etc.).

## Step 1 — Provision the VPS (one-time, as root)

```bash
# On a fresh VPS, as root:
REPO_URL=https://github.com/<you>/<agent-repo>.git \
  bash <(curl -fsSL https://raw.githubusercontent.com/<you>/<agent-repo>/main/scripts/provision-vps.sh)
```

This is idempotent and:

- creates the `deploy` user and adds it to the `docker` group,
- installs Docker + the compose plugin,
- clones the repo to `/opt/opencode-agent` (owned by `deploy`),
- creates `.secrets/{gmail-mcp,opencode-share}` (mode 700),
- scaffolds `.env` from `.env.example`,
- prints the remaining manual steps.

## Step 2 — Fill secrets in `.env`

Edit `/opt/opencode-agent/.env` (as `deploy`). Required / common keys:

| Key | Purpose |
| --- | --- |
| `NOTES_REPO_URL` | `https://github.com/<you>/<notes-repo>.git` |
| `NOTES_REPO_TOKEN` | GitHub **fine-grained PAT**, scoped to the notes repo, **Contents: Read and write**. Enables the container to push notes over HTTPS — no SSH key needed. |
| `USER_EMAIL` / `AGENT_INBOX_EMAIL` | result recipient / polled inbox |
| `BROWSERBASE_*`, `CAPSOLVER_API_KEY` | web-access providers (if used) |
| `OPENCODE_MODEL` | model id (or set in compose `environment`) |
| `APT_MIRROR` | **optional** build knob: Debian apt mirror used during image build. Defaults to the upstream CDN; set a domestic mirror (e.g. `mirrors.tuna.tsinghua.edu.cn`) when building behind a slow cross-border link. Wired into the build via `docker-compose.yml` `build.args`. |

Long-term memory (mem0) needs an external Qdrant: the compose stack no longer
bundles one. Leave `QDRANT_URL` unset to run memory-less (the plugin degrades to
a no-op); point it at a reachable Qdrant to enable memory.

Credential/state dirs are mounted from the project's `./.secrets/...` (sources
hardcoded in `docker-compose.yml`). The global `~/.config/opencode` is not
mounted — custom providers are injected in code and provider auth lives in the
share dir's `auth.json`.

## Step 3 — One-time interactive auth (cannot be scripted)

**Gmail OAuth** (only if using the email bridge):

1. Create a Google Cloud OAuth client; download `gcp-oauth.keys.json`.
2. Run `scripts/gmail-reauth.ts` locally, complete the Google consent for the
   inbox account, producing `credentials.json`.
3. Place both files in `/opt/opencode-agent/.secrets/gmail-mcp/` owned by
   `deploy` (`install -o deploy -g deploy -m 600 ...`).
4. To avoid 7-day refresh-token expiry, publish the OAuth app to **In
   production** (not "Testing").
5. **Verify the account.** After the container starts, confirm the log line
   `[gmail] connected as <X>` shows the *same* Google account whose alias you
   set in `AGENT_INBOX_EMAIL` (the poll query is `to:<AGENT_INBOX_EMAIL>`). The
   consent screen silently defaults to whatever account the browser is signed
   into — consenting as the wrong account makes the bridge poll an empty mailbox
   and never receive anything. Re-run the reauth (use "Use another account" /
   an incognito window) if it mismatches.

**OpenCode model auth:**

Run the login *inside the running container* so credentials land in the share
dir via its `XDG_DATA_HOME` mapping (container `/workspace/.local/share/opencode`
= host `./.secrets/opencode-share`):

```bash
# as deploy, container must be up
docker exec -it opencode-agent opencode auth login -p openai
```

This writes `auth.json` (OAuth tokens / API keys) to
`./.secrets/opencode-share/auth.json`. Repeat with `-p <provider>` for any other
provider you use (deepseek, zai, packyapi-usage, …). Custom provider
*definitions* come from code (`src/opencode-server-config.ts`), not a config
file.

## Step 4 — GitHub Actions secrets (on the repo)

Settings → Secrets and variables → Actions:

| Secret | Value |
| --- | --- |
| `DEPLOY_HOST` | VPS IP / hostname |
| `DEPLOY_USER` | `deploy` |
| `DEPLOY_PORT` | SSH port (default 22) |
| `DEPLOY_PATH` | `/opt/opencode-agent` |
| `DEPLOY_SSH_KEY` | private key whose public half is in `deploy`'s `~/.ssh/authorized_keys` |

## Step 5 — First deploy

Push to `main` (triggers the Action), or run manually **as `deploy`**:

```bash
sudo -iu deploy bash -c 'cd /opt/opencode-agent && docker compose up -d --build'
```

## Step 6 — Verify

```bash
sudo -iu deploy bash -c 'cd /opt/opencode-agent && docker compose ps'
# logs should show, in order:
#   [opencode-serve] listening on http://127.0.0.1:4096
#   [opencode] connected; visibleSessions=...
#   [scheduler] recovered N task(s)
#   [gmail] connected as <inbox>           (if Gmail enabled)
docker compose -f /opt/opencode-agent/docker-compose.yml logs --tail 30 agent
# notes auth wired correctly:
#   container env has NOTES_REPO_TOKEN, notes remote is https://...
```

**First boot is slow — don't mistake it for a hang.** On the very first start
(especially on ARM / a slow link) opencode downloads its `ripgrep` binary and
loads plugins; the gap between `[opencode-serve] listening` and
`[opencode] connected` can be **60–90s**. During that window the server accepts
the port but doesn't answer requests yet, so an early `curl`/healthcheck returns
nothing (`HTTP 000`). Wait for `[opencode] connected` before concluding it's stuck.

**Notes is best-effort.** `scripts/ensure-notes.sh` now bootstraps the notes repo
*in place* (it never `mv`s the bind-mounted `notes/`), and a notes failure no
longer crash-loops the bridge — so a plain `docker compose up` works without any
host-side notes pre-clone. With no `NOTES_REPO_URL` it initializes a local-only
notes repo (sync off); with a bad token it logs the error and continues. A
healthy deploy still shows the `notes` remote as `https://...` with the token.

## Golden rules (avoid the known footguns)

- **Never run `docker compose` as root** on the VPS. Container state now lives
  under `/workspace` (not `/root`), so the old empty-`/root/...` failure is gone;
  running as `deploy` still keeps `.data`/`.secrets` file ownership consistent.
  Always `sudo -iu deploy`.
- **Notes auth = HTTPS token**, not SSH keys. A token in `.env` works in the
  container, on the host, and in CI identically; an SSH key only works for the
  one user whose home holds it.
- **Secrets never enter the repo.** They live in `.env` (gitignored) and
  `.secrets/` (gitignored, dockerignored) on the VPS, plus GitHub Actions
  secrets for CI.
- A **notes sync failure is non-fatal** to the deploy by design — it must never
  block shipping code.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `[gmail] skipping — missing credentials` | compose run as root, or creds missing | recreate as `deploy`; confirm files in `.secrets/gmail-mcp/` |
| notes `pull --rebase` conflict during deploy | notes diverged (commits piled up locally) | resolve in `notes/`, push; ensure container can push (token set) |
| `Could not resolve hostname github.com-...` | SSH host alias only in one user's home | switch notes to HTTPS token (`NOTES_REPO_TOKEN`) |
| no morning report AND no email task replies | Gmail OAuth `invalid_grant` | re-auth, copy `credentials.json`, restart; publish OAuth app |

Deeper operational detail lives in the maintainer runbook (Gmail recovery,
account specifics). This document covers standing up and verifying a deployment.

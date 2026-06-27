---
name: deploy-agent
description: Standardized procedure for deploying and operating the opencode-agent bridge on a VPS. Use when setting up a new deployment, deploying to a new VPS/server, provisioning a host, redeploying, recreating or restarting the container, wiring up notes/Gmail/OpenCode auth, or troubleshooting a failed deploy. Triggers on requests like "deploy the agent", "set up the agent on a new server", "redeploy", "restart the container on the VPS", or "the deploy is failing".
---

Deploy and operate the opencode-agent bridge with minimal friction and no
hidden, unreproducible host state. The full canonical checklist is
`docs/DEPLOY.md` — read it before acting; this skill is the operating guide and
guardrails on top of it.

## Goal

- Stand up or update a deployment by following `docs/DEPLOY.md`, keeping all
  mechanism in code and secrets confined to a short, explicit list.
- Never reintroduce per-user SSH state or HOME-relative (`/root/...`) mounts.
  All container state now lives under `/workspace` (XDG_*/GMAIL_MCP_DIR redirect
  opencode and Gmail off `$HOME`), so mounts no longer depend on the running
  user's home.

## Golden rules (do not violate)

- **Never run `docker compose` as root on the VPS.** Always
  `sudo -iu deploy bash -c 'cd <APP_DIR> && docker compose ...'`. Mounts are
  project-relative and container state lives under `/workspace`, so the old
  empty-`/root/...` failure is gone — but running as `deploy` still keeps
  ownership of the bind-mounted `.data`/`.secrets` files consistent.
- **Notes auth is HTTPS token (`NOTES_REPO_TOKEN`), not SSH keys.** A token in
  `.env` works in the container, on the host, and in CI identically. Do not set
  up or depend on an SSH deploy key / host alias in some user's home.
- **Secrets never go in the repo.** They live in the VPS `.env` (gitignored),
  `.secrets/` (gitignored + dockerignored), and GitHub Actions secrets.
- **A notes-sync failure must not block the deploy — in CI *or* the container.**
  The GitHub workflow treats `notes pull` as non-fatal, and `scripts/bridge.sh`
  now does too (`ensure-notes.sh || continue`). `ensure-notes.sh` bootstraps the
  notes repo **in place** — it never `mv`s the bind-mounted `notes/` (a mount
  can't be moved → the old "Device or resource busy" crash loop). So a plain
  `docker compose up` works with no host-side notes pre-clone. Do not reintroduce
  a `mv`-the-dir migration or a hard `exit 1` when notes is unset/unreachable.

## Procedure

1. **New VPS:** run `scripts/provision-vps.sh` as root (idempotent). It creates
   the `deploy` user, installs Docker, clones the repo to `/opt/opencode-agent`,
   creates `.secrets/{gmail-mcp,opencode-share}`, and scaffolds
   `.env`.
2. **Secrets:** fill `.env` (`NOTES_REPO_URL`, `NOTES_REPO_TOKEN`, `USER_EMAIL`,
   provider keys). See `docs/DEPLOY.md` Step 2. Optional knobs: `APT_MIRROR`
   (domestic Debian mirror for faster image builds behind slow links);
   `QDRANT_URL` (memory is opt-in — the stack no longer bundles Qdrant, so leave
   it unset to run memory-less, or point at an external Qdrant to enable it).
3. **One-time interactive auth** (cannot be scripted): Gmail OAuth and OpenCode
   model auth, landing files in the matching `.secrets/` dir. See Step 3. For
   Gmail, **verify `[gmail] connected as <X>` matches the account behind
   `AGENT_INBOX_EMAIL`** — the consent screen defaults to the browser's signed-in
   account, and the wrong one silently polls an empty mailbox.
4. **CI:** set the `DEPLOY_*` GitHub Actions secrets (Step 4).
5. **Deploy:** push to `main`, or manually as `deploy` (Step 5).
6. **Verify** (Step 6): confirm the log sequence — opencode listening →
   `[opencode] connected` → `[scheduler] recovered N task(s)` →
   `[gmail] connected as <inbox>` (if Gmail enabled) — and that the container
   has `NOTES_REPO_TOKEN` with an `https://` notes remote. **First boot is slow:**
   opencode downloads ripgrep + loads plugins, so `[opencode] connected` can lag
   `listening` by 60–90s (worse on ARM); an early healthcheck seeing `HTTP 000`
   is that warm-up, not a hang.

## Common operations

- **Redeploy / pick up code or .env changes:**
  `sudo -iu deploy bash -c 'cd /opt/opencode-agent && docker compose up -d --build'`
- **Restart only:** `... docker compose restart agent`
- **Check health:** `... docker compose ps` and
  `docker compose logs --tail 30 agent`.

## Troubleshooting

Match symptoms to the table in `docs/DEPLOY.md` ("Troubleshooting"). Common ones:

- `[gmail] skipping — missing credentials` — compose run as root (wrong mount);
  recreate as `deploy`, confirm files in `.secrets/gmail-mcp/`.
- **Container crash-loops on `[notes] ... Device or resource busy`** — an old
  `ensure-notes.sh` trying to `mv` the bind-mounted `notes/`. Fixed by the
  in-place bootstrap; if you see it, the container is on stale code — rebuild.
- **`/session` hangs / healthcheck `HTTP 000` right after start** — first-boot
  warm-up (ripgrep download + plugin load), not a hang. Wait for
  `[opencode] connected` (up to ~90s on ARM) before debugging.
- **Gmail bridge receives nothing** — check `[gmail] connected as <X>` matches
  the `AGENT_INBOX_EMAIL` account; re-auth with the correct Google account if not.
- **Slow image build behind a cross-border link** — set `APT_MIRROR` in `.env`
  to a domestic Debian mirror and rebuild.

## References

- `docs/DEPLOY.md` — full step-by-step checklist and secrets inventory.
- `docs/notes-repo.md` — notes repo auth modes (token vs legacy SSH).
- `scripts/provision-vps.sh` — idempotent host provisioning.

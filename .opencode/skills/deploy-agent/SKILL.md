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
- Never reintroduce per-user SSH state or HOME-relative mounts (the two
  historical footguns).

## Golden rules (do not violate)

- **Never run `docker compose` as root on the VPS.** Always
  `sudo -iu deploy bash -c 'cd <APP_DIR> && docker compose ...'`. Compose mounts
  resolve relative to the project dir now, but running as root has historically
  mounted empty `/root/...` dirs and silently broken Gmail/auth.
- **Notes auth is HTTPS token (`NOTES_REPO_TOKEN`), not SSH keys.** A token in
  `.env` works in the container, on the host, and in CI identically. Do not set
  up or depend on an SSH deploy key / host alias in some user's home.
- **Secrets never go in the repo.** They live in the VPS `.env` (gitignored),
  `.secrets/` (gitignored + dockerignored), and GitHub Actions secrets.
- **A notes-sync failure must not block the code deploy.** The workflow already
  treats `notes pull` as non-fatal — keep it that way.

## Procedure

1. **New VPS:** run `scripts/provision-vps.sh` as root (idempotent). It creates
   the `deploy` user, installs Docker, clones the repo to `/opt/opencode-agent`,
   creates `.secrets/{gmail-mcp,opencode-share,opencode-config}`, and scaffolds
   `.env`.
2. **Secrets:** fill `.env` (`NOTES_REPO_URL`, `NOTES_REPO_TOKEN`, `USER_EMAIL`,
   provider keys). See `docs/DEPLOY.md` Step 2.
3. **One-time interactive auth** (cannot be scripted): Gmail OAuth and OpenCode
   model auth, landing files in the matching `.secrets/` dir. See Step 3.
4. **CI:** set the `DEPLOY_*` GitHub Actions secrets (Step 4).
5. **Deploy:** push to `main`, or manually as `deploy` (Step 5).
6. **Verify** (Step 6): confirm the log sequence — opencode listening →
   `[opencode] connected` → `[scheduler] recovered N task(s)` →
   `[gmail] connected as <inbox>` (if Gmail enabled) — and that the container
   has `NOTES_REPO_TOKEN` with an `https://` notes remote.

## Common operations

- **Redeploy / pick up code or .env changes:**
  `sudo -iu deploy bash -c 'cd /opt/opencode-agent && docker compose up -d --build'`
- **Restart only:** `... docker compose restart agent`
- **Check health:** `... docker compose ps` and
  `docker compose logs --tail 30 agent`.

## Troubleshooting

Match symptoms to the table in `docs/DEPLOY.md` ("Troubleshooting"). The most
common: `[gmail] skipping — missing credentials` almost always means compose was
run as root (wrong mount) — recreate as `deploy`.

## References

- `docs/DEPLOY.md` — full step-by-step checklist and secrets inventory.
- `docs/notes-repo.md` — notes repo auth modes (token vs legacy SSH).
- `scripts/provision-vps.sh` — idempotent host provisioning.

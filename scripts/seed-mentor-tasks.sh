#!/usr/bin/env bash
# Idempotently create the Mentor scheduled tasks via the local scheduler HTTP API.
# Safe to re-run: a task is skipped if one with the same summary already exists.
#
# The scheduler API binds to 127.0.0.1, so this must run inside the agent
# container (same network namespace). On the VPS, as the deploy user:
#   sudo -iu deploy bash -c 'cd /opt/opencode-agent && docker compose exec -T agent bash scripts/seed-mentor-tasks.sh'
# or via npm:  npm run mentor:seed   (inside the container)
#
# Override timezone with MENTOR_TZ, port with SCHEDULER_API_PORT.
set -euo pipefail

PORT="${SCHEDULER_API_PORT:-4097}"
BASE="http://127.0.0.1:${PORT}/scheduler"
TZ_NAME="${MENTOR_TZ:-Asia/Shanghai}"

existing="$(curl -fsS "${BASE}/list")" || {
  echo "ERR: scheduler API not reachable at ${BASE} — is the agent running?" >&2
  exit 1
}

create_if_missing() {
  local summary="$1" cron="$2" prompt="$3"
  if printf '%s' "$existing" | grep -qF "\"${summary}\""; then
    echo "skip (exists): ${summary}"
    return
  fi
  local payload
  payload=$(printf '{"kind":"cron","cron":"%s","timezone":"%s","summary":"%s","prompt":"%s"}' \
    "$cron" "$TZ_NAME" "$summary" "$prompt")
  local res
  res="$(curl -fsS -X POST -H 'content-type: application/json' -d "$payload" "${BASE}/create")" || {
    echo "ERR: failed to create '${summary}'" >&2
    exit 1
  }
  echo "created: ${summary} (${cron} ${TZ_NAME}) -> ${res}"
}

# Mentor heartbeat (timezone ${TZ_NAME}):
create_if_missing "Mentor 日检" "0 22 * * *" "run the mentor skill in daily-light mode"
create_if_missing "Mentor 周检" "0 21 * * 0" "run the mentor skill in weekly-deep mode"

echo "done."

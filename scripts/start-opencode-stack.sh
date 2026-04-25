#!/usr/bin/env bash
set -euo pipefail

PORT="${OPENCODE_PORT:-4096}"
BASE_URL="${OPENCODE_BASE_URL:-http://127.0.0.1:${PORT}}"

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]]; then
    kill "${SERVER_PID}" 2>/dev/null || true
    wait "${SERVER_PID}" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

echo "[stack] starting opencode server on port ${PORT}"
opencode serve --port "${PORT}" &
SERVER_PID=$!

export OPENCODE_BASE_URL="${BASE_URL}"

echo "[stack] starting bridge with AGENT_BACKEND=opencode"
AGENT_BACKEND=opencode npm run start:opencode

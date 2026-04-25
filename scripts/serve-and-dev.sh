#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

cleanup() {
  local code=$?
  trap - EXIT INT TERM
  if [[ -n "${SERVE_PID:-}" ]]; then
    kill "$SERVE_PID" 2>/dev/null || true
  fi
  if [[ -n "${DEV_PID:-}" ]]; then
    kill "$DEV_PID" 2>/dev/null || true
  fi
  wait 2>/dev/null || true
  exit "$code"
}

trap cleanup EXIT INT TERM

npm run serve &
SERVE_PID=$!

npm run dev &
DEV_PID=$!

while true; do
  if ! kill -0 "$SERVE_PID" 2>/dev/null; then
    wait "$SERVE_PID" || true
    break
  fi
  if ! kill -0 "$DEV_PID" 2>/dev/null; then
    wait "$DEV_PID" || true
    break
  fi
  sleep 1
done

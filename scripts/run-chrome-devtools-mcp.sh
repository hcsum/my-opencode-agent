#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -f "$ROOT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT_DIR/.env"
  set +a
fi

DEFAULT_ARGS=(--autoConnect --channel stable)

if [ -n "${CHROME_DEVTOOLS_MCP_ARGS:-}" ]; then
  # shellcheck disable=SC2206
  EXTRA_ARGS=(${CHROME_DEVTOOLS_MCP_ARGS})
  exec npx chrome-devtools-mcp@latest "${EXTRA_ARGS[@]}"
fi

exec npx chrome-devtools-mcp@latest "${DEFAULT_ARGS[@]}"

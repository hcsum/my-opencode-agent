#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f .env && -z "${OPENCODE_SERVE_PORT:-}" && -z "${HTTPS_PROXY:-${https_proxy:-}}" ]]; then
  set -a
  source .env
  set +a
fi

mkdir -p "$ROOT_DIR/.data"

export OPENCODE_DB="$ROOT_DIR/.data/opencode.db"

PORT="${OPENCODE_SERVE_PORT:-4096}"
PROXY="${HTTPS_PROXY:-${https_proxy:-}}"

if [[ -n "$PROXY" ]]; then
  export HTTPS_PROXY="$PROXY"
  export NO_PROXY="${NO_PROXY:-127.0.0.1,localhost}"
  echo "[opencode-serve] proxy enabled: $PROXY"
else
  echo "[opencode-serve] proxy disabled"
fi

echo "[opencode-serve] listening on 127.0.0.1:$PORT"
exec opencode serve --port "$PORT"

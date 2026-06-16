#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f .env && -z "${OPENCODE_SERVE_PORT:-}" && -z "${HTTPS_PROXY:-${https_proxy:-}}" ]]; then
  set -a
  source .env
  set +a
fi

# The mem0 long-term-memory plugin needs GOOGLE_API_KEY (and optionally MEM0_*/
# QDRANT_URL) in the opencode process env. opencode's own model auth is separate
# (oauth in auth.json), so these may be absent even when opencode otherwise
# works. Pull just these from .env when not already set — without clobbering
# vars the environment already provides (e.g. docker compose overrides).
if [[ -f .env ]]; then
  while IFS='=' read -r key val; do
    [[ -z "$key" || -n "${!key:-}" ]] && continue
    export "$key=$val"
  done < <(grep -E '^(GOOGLE_API_KEY|MEM0_[A-Z_]+|QDRANT_URL)=' .env)
fi

bash "$ROOT_DIR/scripts/ensure-notes.sh"

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

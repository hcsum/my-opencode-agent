#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NOTES_DIR="$ROOT_DIR/notes"

bash "$ROOT_DIR/scripts/ensure-notes.sh"

CURRENT_BRANCH="$(git -C "$NOTES_DIR" rev-parse --abbrev-ref HEAD)"
REMOTE_URL="$(git -C "$NOTES_DIR" remote get-url origin 2>/dev/null || true)"

echo "[notes] ready at $NOTES_DIR"
echo "[notes] branch: $CURRENT_BRANCH"

if [[ -n "$REMOTE_URL" ]]; then
  echo "[notes] origin: $REMOTE_URL"
fi

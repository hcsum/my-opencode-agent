#!/usr/bin/env bash
set -euo pipefail

# Commit all local notes changes and push them to the remote git repo.
# Usage: bash scripts/save-notes.sh "optional commit message"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NOTES_DIR="$ROOT_DIR/notes"

bash "$ROOT_DIR/scripts/ensure-notes.sh"

if [[ -z "$(git -C "$NOTES_DIR" status --porcelain)" ]]; then
  echo "[notes] nothing to commit; working tree clean."
else
  MESSAGE="${1:-notes: backup $(date +%Y-%m-%d\ %H:%M:%S)}"
  git -C "$NOTES_DIR" add -A
  git -C "$NOTES_DIR" commit -m "$MESSAGE"
  echo "[notes] committed: $MESSAGE"
fi

echo "[notes] pushing to origin..."
git -C "$NOTES_DIR" push
echo "[notes] pushed."

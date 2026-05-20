#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

bash "$ROOT_DIR/scripts/ensure-notes.sh"

if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  source "$ROOT_DIR/.env"
  set +a
fi

NOTES_DIR="$ROOT_DIR/notes"
NOTES_REPO_REMOTE="${NOTES_REPO_REMOTE:-origin}"
CURRENT_BRANCH="$(git -C "$NOTES_DIR" rev-parse --abbrev-ref HEAD)"

if [[ "$CURRENT_BRANCH" == "HEAD" ]]; then
  CURRENT_BRANCH="${NOTES_REPO_BRANCH:-main}"
fi

echo "[notes] syncing $CURRENT_BRANCH from $NOTES_REPO_REMOTE"
git -C "$NOTES_DIR" pull --rebase --autostash "$NOTES_REPO_REMOTE" "$CURRENT_BRANCH"

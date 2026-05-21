#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NOTES_DIR="$ROOT_DIR/notes"
COMMIT_MESSAGE="${1:-}"

if [[ -z "$COMMIT_MESSAGE" ]]; then
  echo "[notes] commit message is required" >&2
  echo "usage: npm run notes:push -- \"your commit message\"" >&2
  exit 1
fi

bash "$ROOT_DIR/scripts/sync-notes.sh"

git -C "$NOTES_DIR" add -A

if git -C "$NOTES_DIR" diff --cached --quiet; then
  echo "[notes] no staged changes to commit"
  exit 0
fi

git -C "$NOTES_DIR" commit -m "$COMMIT_MESSAGE"

CURRENT_BRANCH="$(git -C "$NOTES_DIR" rev-parse --abbrev-ref HEAD)"

if [[ "$CURRENT_BRANCH" == "HEAD" ]]; then
  CURRENT_BRANCH="${NOTES_REPO_BRANCH:-main}"
fi

NOTES_REPO_REMOTE="${NOTES_REPO_REMOTE:-origin}"

echo "[notes] pushing $CURRENT_BRANCH to $NOTES_REPO_REMOTE"
git -C "$NOTES_DIR" push "$NOTES_REPO_REMOTE" "$CURRENT_BRANCH"

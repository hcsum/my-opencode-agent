#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NOTES_DIR="$ROOT_DIR/notes"

if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  source "$ROOT_DIR/.env"
  set +a
fi

NOTES_REPO_URL="${NOTES_REPO_URL:-}"
NOTES_REPO_BRANCH="${NOTES_REPO_BRANCH:-main}"
NOTES_REPO_REMOTE="${NOTES_REPO_REMOTE:-origin}"

if [[ -d "$NOTES_DIR/.git" ]]; then
  git -C "$NOTES_DIR" rev-parse --is-inside-work-tree >/dev/null
  if [[ -n "$NOTES_REPO_URL" ]]; then
    if git -C "$NOTES_DIR" remote get-url "$NOTES_REPO_REMOTE" >/dev/null 2>&1; then
      git -C "$NOTES_DIR" remote set-url "$NOTES_REPO_REMOTE" "$NOTES_REPO_URL"
    else
      git -C "$NOTES_DIR" remote add "$NOTES_REPO_REMOTE" "$NOTES_REPO_URL"
    fi
  fi
  exit 0
fi

if [[ -e "$NOTES_DIR" ]]; then
  echo "[notes] expected $NOTES_DIR to be a git repo, but it exists without .git" >&2
  exit 1
fi

if [[ -z "$NOTES_REPO_URL" ]]; then
  echo "[notes] NOTES_REPO_URL is required to clone notes into $NOTES_DIR" >&2
  exit 1
fi

echo "[notes] cloning $NOTES_REPO_URL into $NOTES_DIR"
git clone --branch "$NOTES_REPO_BRANCH" "$NOTES_REPO_URL" "$NOTES_DIR"

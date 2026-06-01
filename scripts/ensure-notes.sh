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
# Commit identity for the notes repo. Falls back to USER_EMAIL so a clean
# host (e.g. the VPS Docker container) can commit without a global git config.
NOTES_GIT_USER_NAME="${NOTES_GIT_USER_NAME:-opencode-agent}"
NOTES_GIT_USER_EMAIL="${NOTES_GIT_USER_EMAIL:-${USER_EMAIL:-}}"
HAS_GIT=0

if command -v git >/dev/null 2>&1; then
  HAS_GIT=1
fi

ensure_notes_identity() {
  if [[ "$HAS_GIT" -eq 0 ]]; then
    return
  fi

  # Only set what is missing, and only at the repo level so we never clobber
  # the host's global git identity.
  if [[ -z "$(git -C "$NOTES_DIR" config --get user.name 2>/dev/null)" ]]; then
    git -C "$NOTES_DIR" config user.name "$NOTES_GIT_USER_NAME"
  fi

  if [[ -z "$(git -C "$NOTES_DIR" config --get user.email 2>/dev/null)" ]]; then
    if [[ -n "$NOTES_GIT_USER_EMAIL" ]]; then
      git -C "$NOTES_DIR" config user.email "$NOTES_GIT_USER_EMAIL"
    else
      echo "[notes] warning: no notes commit identity configured." >&2
      echo "[notes] set NOTES_GIT_USER_EMAIL (or USER_EMAIL) in .env to enable commits." >&2
    fi
  fi
}

mark_notes_safe_directory() {
  if [[ "$HAS_GIT" -eq 0 ]]; then
    return
  fi

  if git config --global --get-all safe.directory 2>/dev/null | grep -Fx -- "$NOTES_DIR" >/dev/null; then
    return
  fi

  git config --global --add safe.directory "$NOTES_DIR"
}

if [[ -d "$NOTES_DIR/.git" ]]; then
  if [[ "$HAS_GIT" -eq 0 ]]; then
    echo "[notes] git is unavailable; using existing checkout at $NOTES_DIR"
    exit 0
  fi

  mark_notes_safe_directory
  git -C "$NOTES_DIR" rev-parse --is-inside-work-tree >/dev/null
  if [[ -n "$NOTES_REPO_URL" ]]; then
    if git -C "$NOTES_DIR" remote get-url "$NOTES_REPO_REMOTE" >/dev/null 2>&1; then
      git -C "$NOTES_DIR" remote set-url "$NOTES_REPO_REMOTE" "$NOTES_REPO_URL"
    else
      git -C "$NOTES_DIR" remote add "$NOTES_REPO_REMOTE" "$NOTES_REPO_URL"
    fi
  fi
  ensure_notes_identity
  exit 0
fi

if [[ "$HAS_GIT" -eq 0 ]]; then
  if [[ -d "$NOTES_DIR" ]]; then
    echo "[notes] git is unavailable; using existing directory at $NOTES_DIR"
    exit 0
  fi

  echo "[notes] git is required to clone notes into $NOTES_DIR" >&2
  exit 1
fi

if [[ -e "$NOTES_DIR" ]]; then
  if [[ -z "$NOTES_REPO_URL" ]]; then
    echo "[notes] expected $NOTES_DIR to be a git repo, but it exists without .git" >&2
    exit 1
  fi

  BACKUP_DIR="$ROOT_DIR/notes.pre-git-migration.$(date +%Y%m%d-%H%M%S)"
  echo "[notes] moving existing non-git directory to $BACKUP_DIR"
  mv "$NOTES_DIR" "$BACKUP_DIR"
fi

if [[ -z "$NOTES_REPO_URL" ]]; then
  echo "[notes] NOTES_REPO_URL is required to clone notes into $NOTES_DIR" >&2
  exit 1
fi

echo "[notes] cloning $NOTES_REPO_URL into $NOTES_DIR"
git clone --branch "$NOTES_REPO_BRANCH" "$NOTES_REPO_URL" "$NOTES_DIR"
mark_notes_safe_directory
ensure_notes_identity

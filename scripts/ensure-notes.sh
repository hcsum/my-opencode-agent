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
# Optional HTTPS token (GitHub PAT). When set, the notes remote is switched to
# HTTPS and authenticated with this token instead of an SSH key/host alias, so
# auth works identically in the container, on the host, and in CI — no ssh
# client, key files, or per-user ssh config required.
NOTES_REPO_TOKEN="${NOTES_REPO_TOKEN:-}"
# Credential helper that reads the token from the environment at call time, so
# the secret is never written into .git/config or any tracked file.
NOTES_CRED_HELPER='!f() { echo username=x-access-token; echo "password=${NOTES_REPO_TOKEN}"; }; f'
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

# Derive https://github.com/<owner>/<repo>.git from NOTES_REPO_URL in any form
# (ssh, ssh host-alias, or https).
notes_https_url() {
  local url="$1" path
  case "$url" in
    https://*) path="${url#https://}"; path="${path#*/}" ;;
    *:*)       path="${url##*:}" ;;
    *)         path="$url" ;;
  esac
  printf 'https://github.com/%s' "$path"
}

# When a token is configured, point the remote at HTTPS and wire up the
# env-reading credential helper. Returns non-zero when no token is set so
# callers fall back to the SSH/alias remote.
configure_notes_token_auth() {
  [[ "$HAS_GIT" -eq 1 ]] || return 1
  [[ -n "$NOTES_REPO_TOKEN" && -n "$NOTES_REPO_URL" ]] || return 1
  local https_url
  https_url="$(notes_https_url "$NOTES_REPO_URL")"
  if git -C "$NOTES_DIR" remote get-url "$NOTES_REPO_REMOTE" >/dev/null 2>&1; then
    git -C "$NOTES_DIR" remote set-url "$NOTES_REPO_REMOTE" "$https_url"
  else
    git -C "$NOTES_DIR" remote add "$NOTES_REPO_REMOTE" "$https_url"
  fi
  git -C "$NOTES_DIR" config credential.helper "$NOTES_CRED_HELPER"
}

if [[ -d "$NOTES_DIR/.git" ]]; then
  if [[ "$HAS_GIT" -eq 0 ]]; then
    echo "[notes] git is unavailable; using existing checkout at $NOTES_DIR"
    exit 0
  fi

  mark_notes_safe_directory
  git -C "$NOTES_DIR" rev-parse --is-inside-work-tree >/dev/null
  if ! configure_notes_token_auth; then
    if [[ -n "$NOTES_REPO_URL" ]]; then
      if git -C "$NOTES_DIR" remote get-url "$NOTES_REPO_REMOTE" >/dev/null 2>&1; then
        git -C "$NOTES_DIR" remote set-url "$NOTES_REPO_REMOTE" "$NOTES_REPO_URL"
      else
        git -C "$NOTES_DIR" remote add "$NOTES_REPO_REMOTE" "$NOTES_REPO_URL"
      fi
    fi
  fi
  ensure_notes_identity
  exit 0
fi

# No .git yet. We must bootstrap the notes repo INTO the existing directory.
# Crucially, $NOTES_DIR is usually a bind mount (docker-compose maps ./notes),
# and a mount point can never be `mv`d ("Device or resource busy"). So we always
# clone/init *in place* and, when needed, relocate the directory's *contents*
# rather than the directory itself.

if [[ "$HAS_GIT" -eq 0 ]]; then
  if [[ -d "$NOTES_DIR" ]]; then
    echo "[notes] git is unavailable; using existing directory at $NOTES_DIR"
    exit 0
  fi

  echo "[notes] git is required to set up notes at $NOTES_DIR" >&2
  exit 1
fi

# No remote configured: notes is optional. Initialize a local-only repo in place
# so the agent has a working notes/ tree (sync stays off) instead of failing and
# crash-looping the whole bridge.
if [[ -z "$NOTES_REPO_URL" ]]; then
  echo "[notes] NOTES_REPO_URL unset — initializing a local-only notes repo at $NOTES_DIR (sync disabled)"
  mkdir -p "$NOTES_DIR"
  git -C "$NOTES_DIR" init -q
  mark_notes_safe_directory
  ensure_notes_identity
  exit 0
fi

# A remote IS configured but the dir isn't a git repo yet. If it holds unrelated
# files, move just the CONTENTS aside (the directory itself may be an unmovable
# bind mount), leaving an empty dir to clone into.
mkdir -p "$NOTES_DIR"
if [[ -n "$(ls -A "$NOTES_DIR" 2>/dev/null)" ]]; then
  BACKUP_DIR="$ROOT_DIR/notes.pre-git-migration.$(date +%Y%m%d-%H%M%S)"
  echo "[notes] $NOTES_DIR has non-git contents; moving them to $BACKUP_DIR"
  mkdir -p "$BACKUP_DIR"
  ( shopt -s dotglob nullglob; mv "$NOTES_DIR"/* "$BACKUP_DIR"/ )
fi

if [[ -n "$NOTES_REPO_TOKEN" ]]; then
  https_url="$(notes_https_url "$NOTES_REPO_URL")"
  echo "[notes] cloning $https_url into $NOTES_DIR (HTTPS token auth)"
  git -c "credential.helper=$NOTES_CRED_HELPER" \
    clone --branch "$NOTES_REPO_BRANCH" "$https_url" "$NOTES_DIR"
  git -C "$NOTES_DIR" config credential.helper "$NOTES_CRED_HELPER"
else
  echo "[notes] cloning $NOTES_REPO_URL into $NOTES_DIR"
  git clone --branch "$NOTES_REPO_BRANCH" "$NOTES_REPO_URL" "$NOTES_DIR"
fi
mark_notes_safe_directory
ensure_notes_identity

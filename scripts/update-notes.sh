#!/usr/bin/env bash
set -euo pipefail

# Pull the latest notes from the remote git repo (fast-forward only).
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NOTES_DIR="$ROOT_DIR/notes"

bash "$ROOT_DIR/scripts/ensure-notes.sh"

echo "[notes] pulling latest from origin..."
git -C "$NOTES_DIR" pull --ff-only
echo "[notes] up to date."

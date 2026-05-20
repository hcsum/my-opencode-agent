#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

INPUT="${1:-{}}"

exec npx tsx .opencode/skills/google-drive-backup/scripts/backup.ts <<< "$INPUT"

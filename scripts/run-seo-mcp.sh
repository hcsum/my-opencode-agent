#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SEO_MCP_DIR="$(cd "$ROOT_DIR/../seo-mcp" && pwd)"

if [ -f "$ROOT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT_DIR/.env"
  set +a
fi

if [ ! -f "$SEO_MCP_DIR/pyproject.toml" ]; then
  echo "Local seo-mcp repo not found at $SEO_MCP_DIR" >&2
  exit 1
fi

exec uvx --from "$SEO_MCP_DIR" seo-mcp

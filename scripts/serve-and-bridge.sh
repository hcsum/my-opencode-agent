#!/usr/bin/env bash
# Intentionally no `-e`: this script supervises two long-lived children and
# handles their exit/signals explicitly, where `-e` would abort prematurely.
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SERVE_PID=""
BRIDGE_PID=""
shutting_down=0

# Graceful shutdown ordering matters: the bridge needs the OpenCode server
# alive to finish the in-flight task and deliver its reply/result. So on a
# signal we hand SIGTERM to the bridge first and wait for it to drain and exit
# on its own (bounded by SHUTDOWN_DRAIN_TIMEOUT_MS inside the bridge), and only
# then stop the model server.
graceful_shutdown() {
  if [[ "$shutting_down" -eq 1 ]]; then return; fi
  shutting_down=1
  echo "[serve-and-bridge] signal received; draining bridge before stopping server"

  if [[ -n "$BRIDGE_PID" ]] && kill -0 "$BRIDGE_PID" 2>/dev/null; then
    kill -TERM "$BRIDGE_PID" 2>/dev/null || true
    wait "$BRIDGE_PID" 2>/dev/null || true
  fi

  if [[ -n "$SERVE_PID" ]] && kill -0 "$SERVE_PID" 2>/dev/null; then
    echo "[serve-and-bridge] bridge drained; stopping OpenCode server"
    kill -TERM "$SERVE_PID" 2>/dev/null || true
    wait "$SERVE_PID" 2>/dev/null || true
  fi

  exit 0
}

trap graceful_shutdown TERM INT

bash "$ROOT_DIR/scripts/start-opencode-serve.sh" &
SERVE_PID=$!

bash "$ROOT_DIR/scripts/bridge.sh" &
BRIDGE_PID=$!

# Block until a signal fires graceful_shutdown, or until a child exits on its
# own. `wait -n` is interruptible by the trap; on a plain child exit the loop
# re-checks liveness and falls through to the unexpected-exit handling below.
while kill -0 "$SERVE_PID" 2>/dev/null && kill -0 "$BRIDGE_PID" 2>/dev/null; do
  wait -n 2>/dev/null || true
done

if [[ "$shutting_down" -eq 0 ]]; then
  echo "[serve-and-bridge] a child exited unexpectedly; tearing down the other"
  [[ -n "$BRIDGE_PID" ]] && kill -TERM "$BRIDGE_PID" 2>/dev/null || true
  [[ -n "$SERVE_PID" ]] && kill -TERM "$SERVE_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  exit 1
fi

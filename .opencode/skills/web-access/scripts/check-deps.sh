#!/usr/bin/env bash

set -euo pipefail

BROWSER_MODE="${BROWSER_MODE:-dedicated}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEDICATED_PROFILE_DIR="${DEDICATED_PROFILE_DIR:-$HOME/.web-access/brave-profile}"

show_help() {
  cat <<EOF
Usage: check-deps.sh [OPTIONS]

  --browser MODE   Browser mode: dedicated (default), user
                    dedicated: Brave on fixed port 9222 (web-access dedicated)
                    user:      Chrome via DevToolsActivePort (your main browser)

  Without arguments, uses the default (dedicated) mode.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --browser)
      BROWSER_MODE="$2"
      shift 2
      ;;
    --help|-h)
      show_help
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      show_help
      exit 1
      ;;
  esac
done

if command -v node >/dev/null 2>&1; then
  NODE_VER=$(node --version 2>/dev/null)
  NODE_MAJOR=$(printf '%s' "$NODE_VER" | cut -c2- | cut -d. -f1)
  if [ "$NODE_MAJOR" -ge 22 ] 2>/dev/null; then
    echo "node: ok ($NODE_VER)"
  else
    echo "node: warn ($NODE_VER, recommended 22+)"
  fi
else
  echo "node: missing - install Node.js 22+"
  exit 1
fi

check_node_script() {
  local mode="$1"
  node --eval "
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');

function checkPort(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection(port, '127.0.0.1');
    const timer = setTimeout(() => { socket.destroy(); resolve(false); }, 2000);
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
    socket.once('error', () => { clearTimeout(timer); resolve(false); });
  });
}

function activePortFiles() {
  const home = os.homedir();
  const localAppData = process.env.LOCALAPPDATA || '';
  const platform = process.platform;
  const files = [];

  if (platform === 'darwin') {
    if (BROWSER_MODE === 'user') {
      files.push(
        path.join(home, 'Library/Application Support/Google/Chrome/DevToolsActivePort'),
        path.join(home, 'Library/Application Support/Google/Chrome Canary/DevToolsActivePort'),
        path.join(home, 'Library/Application Support/Chromium/DevToolsActivePort'),
        path.join(home, 'Library/Application Support/BraveSoftware/Brave-Browser/DevToolsActivePort'),
      );
    } else {
      files.push(path.join(process.env.DEDICATED_PROFILE_DIR || '', 'DevToolsActivePort'));
    }
  } else if (platform === 'linux') {
    if (BROWSER_MODE === 'user') {
      files.push(
        path.join(home, '.config/google-chrome/DevToolsActivePort'),
        path.join(home, '.config/chromium/DevToolsActivePort'),
        path.join(home, '.config/BraveSoftware/Brave-Browser/DevToolsActivePort'),
      );
    } else {
      files.push(path.join(process.env.DEDICATED_PROFILE_DIR || '', 'DevToolsActivePort'));
    }
  } else if (platform === 'win32') {
    if (BROWSER_MODE === 'user') {
      files.push(
        path.join(localAppData, 'Google/Chrome/User Data/DevToolsActivePort'),
        path.join(localAppData, 'Chromium/User Data/DevToolsActivePort'),
        path.join(localAppData, 'BraveSoftware/Brave-Browser/User Data/DevToolsActivePort'),
      );
    } else {
      files.push(path.join(process.env.DEDICATED_PROFILE_DIR || '', 'DevToolsActivePort'));
    }
  }

  return files;
}

const BROWSER_MODE = '$mode';
const fixedPorts = BROWSER_MODE === 'user' ? [9222, 9229, 9333] : [9222];

async function main() {
  for (const filePath of activePortFiles()) {
    try {
      if (fs.existsSync(filePath)) {
        const lines = fs.readFileSync(filePath, 'utf8').trim().split(/\r?\n/).filter(Boolean);
        const port = parseInt(lines[0], 10);
        if (port > 0 && port < 65536 && await checkPort(port)) {
          console.log(port);
          process.exit(0);
        }
      }
    } catch (_) {}
  }

  for (const port of fixedPorts) {
    if (await checkPort(port)) {
      console.log(port);
      process.exit(0);
    }
  }

  process.exit(1);
}

main();
" 2>&1
}

if ! CHROME_PORT=$(BROWSER_MODE="$BROWSER_MODE" check_node_script "$BROWSER_MODE" 2>/dev/null); then
  echo "browser: not connected ($BROWSER_MODE mode)"
  echo ""
  if [ "$BROWSER_MODE" = "user" ]; then
    echo "=== Chrome (user browser) not found ==="
    echo ""
    echo "Open Chrome, go to chrome://inspect/#remote-debugging and check 'Allow remote debugging'."
    echo "Then restart this script."
  else
    echo "=== Brave (dedicated browser) not found ==="
    echo ""
    echo "Start Brave with debugging enabled:"
    echo "  open -na \"Brave Browser\" --args --remote-debugging-port=9222 --user-data-dir=$DEDICATED_PROFILE_DIR"
  fi
  exit 1
fi
echo "browser: ok (port $CHROME_PORT, $BROWSER_MODE mode)"

HEALTH=$(curl -s --connect-timeout 3 "http://127.0.0.1:3456/health" 2>/dev/null || true)
case "$HEALTH" in
  *'"ok"'* )
    if printf '%s' "$HEALTH" | grep -Fq '"browserMode":"'$BROWSER_MODE'"' &&
       printf '%s' "$HEALTH" | grep -Fq '"chromePort":'$CHROME_PORT; then
      echo "proxy: ready"
      exit 0
    fi
    echo "proxy: restarting for $BROWSER_MODE mode"
    pkill -f "cdp-proxy.mjs" 2>/dev/null || true
    sleep 1
    ;;
esac

echo "proxy: connecting..."
BROWSER_MODE="$BROWSER_MODE" DEDICATED_PROFILE_DIR="$DEDICATED_PROFILE_DIR" node "$SCRIPT_DIR/cdp-proxy.mjs" >/tmp/opencode-web-access-proxy.log 2>&1 &
sleep 2

i=1
while [ "$i" -le 15 ]; do
  HEALTH=$(curl -s --connect-timeout 5 --max-time 8 "http://127.0.0.1:3456/health" 2>/dev/null || true)
  case "$HEALTH" in
    *'"ok"'* )
      echo "proxy: ready"
      exit 0
      ;;
  esac

  if [ "$i" -eq 1 ]; then
    echo "chrome may show an authorization prompt; allow it and wait"
  fi
  i=$((i + 1))
done

echo "proxy connection timed out; check browser remote debugging settings"
exit 1

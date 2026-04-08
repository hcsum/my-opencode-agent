#!/usr/bin/env bash

set -euo pipefail

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

if ! CHROME_PORT=$(node -e "
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
  switch (process.platform) {
    case 'darwin':
      return [
        path.join(home, 'Library/Application Support/Google/Chrome/DevToolsActivePort'),
        path.join(home, 'Library/Application Support/Google/Chrome Canary/DevToolsActivePort'),
        path.join(home, 'Library/Application Support/Chromium/DevToolsActivePort'),
      ];
    case 'linux':
      return [
        path.join(home, '.config/google-chrome/DevToolsActivePort'),
        path.join(home, '.config/chromium/DevToolsActivePort'),
      ];
    case 'win32':
      return [
        path.join(localAppData, 'Google/Chrome/User Data/DevToolsActivePort'),
        path.join(localAppData, 'Chromium/User Data/DevToolsActivePort'),
      ];
    default:
      return [];
  }
}

(async () => {
  for (const filePath of activePortFiles()) {
    try {
      const lines = fs.readFileSync(filePath, 'utf8').trim().split(/\\r?\\n/).filter(Boolean);
      const port = parseInt(lines[0], 10);
      if (port > 0 && port < 65536 && await checkPort(port)) {
        console.log(port);
        process.exit(0);
      }
    } catch (_) {}
  }

  for (const port of [9222, 9229, 9333]) {
    if (await checkPort(port)) {
      console.log(port);
      process.exit(0);
    }
  }

  process.exit(1);
})();
" 2>/dev/null); then
  echo "browser: not connected"
  echo ""
  echo "=== Web Access Browser Setup ==="
  echo ""
  echo "web-access 需要一个开启 remote debugging 的浏览器。"
  echo ""
  echo "先选择你要使用的浏览器，再在另一个终端启动它（保持那个终端不关闭）："
  echo ""
  echo "  1. Brave"
  echo "  2. Chrome"
  echo "  3. Edge"
  echo "  4. Chrome Canary"
  echo "  5. Chromium"
  echo "  6. 其他（手动输入路径）"
  echo ""
  echo "选择后，按 web-access skill 里的对应命令启动浏览器，再回到本终端重新运行此脚本。"
  exit 1
fi
echo "browser: ok (port $CHROME_PORT)"

HEALTH=$(curl -s --connect-timeout 3 "http://127.0.0.1:3456/health" 2>/dev/null || true)
case "$HEALTH" in
  *'"ok"'* )
    echo "proxy: ready"
    exit 0
    ;;
esac

echo "proxy: connecting..."
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
node "$SCRIPT_DIR/cdp-proxy.mjs" >/tmp/opencode-web-access-proxy.log 2>&1 &
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

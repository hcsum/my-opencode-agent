#!/usr/bin/env node
// 环境检查 + 确保 CDP Proxy 就绪（跨平台，替代 check-deps.mjs）

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROXY_SCRIPT = path.join(ROOT, 'scripts', 'cdp-proxy.mjs');
const PROXY_PORT = Number(process.env.CDP_PROXY_PORT || 3456);
const ALLOWED_BROWSER_IDS = new Set(['chrome', 'chrome-canary', 'chromium', 'brave', 'edge', 'arc']);

function printJson(result) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function fail(result, exitCode = 1) {
  printJson({ ok: false, ...result });
  process.exit(exitCode);
}

function defaultDedicatedProfileDir(browserId) {
  return path.join(os.homedir(), '.web-access', `${browserId}-dedicated-profile`);
}

function parseArgs(argv) {
  const options = {
    browser: process.env.BROWSER_MODE || null,
    browserSpecified: false,
    browserId: process.env.BROWSER_ID || process.env.BROWSER_APP || null,
    dedicatedProfileDir: process.env.DEDICATED_PROFILE_DIR || null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--browser') {
      options.browser = argv[index + 1] || options.browser;
      options.browserSpecified = true;
      index += 1;
      continue;
    }
    if (arg === '--browser-id' || arg === '--browser-app') {
      options.browserId = argv[index + 1] || options.browserId;
      index += 1;
      continue;
    }
    if (arg === '--dedicated-profile-dir') {
      options.dedicatedProfileDir = argv[index + 1] || options.dedicatedProfileDir;
      index += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printJson({
        ok: true,
        help: true,
        usage: 'node check-deps.mjs [--browser primary|dedicated] [--browser-id <id>] [--dedicated-profile-dir <path>]',
        defaultBehavior: 'auto-pick mode; dedicated preferred when both available',
      });
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.browserSpecified && !['primary', 'dedicated'].includes(options.browser)) {
    throw new Error(`Invalid browser mode: ${options.browser}`);
  }

  if (options.browser === 'dedicated') {
    if (!options.browserId) {
      throw new Error('Dedicated mode requires --browser-id <chrome|chrome-canary|chromium|brave|edge|arc>');
    }
    if (!ALLOWED_BROWSER_IDS.has(options.browserId)) {
      throw new Error(`Invalid browser id: ${options.browserId}`);
    }
    options.dedicatedProfileDir = options.dedicatedProfileDir || defaultDedicatedProfileDir(options.browserId);
  }

  return options;
}

const OPTIONS = parseArgs(process.argv.slice(2));

// --- Node.js 版本检查 ---

function checkNode() {
  const major = Number(process.versions.node.split('.')[0]);
  const version = `v${process.versions.node}`;
  return {
    ok: major >= 22,
    version,
    recommendation: major >= 22 ? null : '建议升级到 22+',
  };
}

// --- TCP 端口探测 ---

function checkPort(port, host = '127.0.0.1', timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = net.createConnection(port, host);
    const timer = setTimeout(() => { socket.destroy(); resolve(false); }, timeoutMs);
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
    socket.once('error', () => { clearTimeout(timer); resolve(false); });
  });
}

// --- 浏览器调试端口检测（DevToolsActivePort 多路径 + 常见端口回退） ---

function activePortFiles() {
  const home = os.homedir();
  const localAppData = process.env.LOCALAPPDATA || '';
  switch (os.platform()) {
    case 'darwin':
      return OPTIONS.browser === 'primary'
        ? [
            path.join(home, 'Library/Application Support/Google/Chrome/DevToolsActivePort'),
            path.join(home, 'Library/Application Support/Google/Chrome Canary/DevToolsActivePort'),
            path.join(home, 'Library/Application Support/Chromium/DevToolsActivePort'),
            path.join(home, 'Library/Application Support/BraveSoftware/Brave-Browser/DevToolsActivePort'),
            path.join(home, 'Library/Application Support/Microsoft Edge/DevToolsActivePort'),
            path.join(home, 'Library/Application Support/Arc/User Data/DevToolsActivePort'),
          ]
        : [path.join(OPTIONS.dedicatedProfileDir, 'DevToolsActivePort')];
    case 'linux':
      return OPTIONS.browser === 'primary'
        ? [
            path.join(home, '.config/google-chrome/DevToolsActivePort'),
            path.join(home, '.config/chromium/DevToolsActivePort'),
            path.join(home, '.config/BraveSoftware/Brave-Browser/DevToolsActivePort'),
            path.join(home, '.config/microsoft-edge/DevToolsActivePort'),
          ]
        : [path.join(OPTIONS.dedicatedProfileDir, 'DevToolsActivePort')];
    case 'win32':
      return OPTIONS.browser === 'primary'
        ? [
            path.join(localAppData, 'Google/Chrome/User Data/DevToolsActivePort'),
            path.join(localAppData, 'Chromium/User Data/DevToolsActivePort'),
            path.join(localAppData, 'BraveSoftware/Brave-Browser/User Data/DevToolsActivePort'),
            path.join(localAppData, 'Microsoft/Edge/User Data/DevToolsActivePort'),
          ]
        : [path.join(OPTIONS.dedicatedProfileDir, 'DevToolsActivePort')];
    default:
      return [];
  }
}

async function detectChromePort() {
  // 优先从 DevToolsActivePort 文件读取
  for (const filePath of activePortFiles()) {
    try {
      const lines = fs.readFileSync(filePath, 'utf8').trim().split(/\r?\n/).filter(Boolean);
      const port = parseInt(lines[0], 10);
      if (port > 0 && port < 65536 && await checkPort(port)) {
        return port;
      }
    } catch (_) {}
  }
  return null;
}

function preferredDedicatedIds() {
  const preferred = [];
  if (OPTIONS.browserId && ALLOWED_BROWSER_IDS.has(OPTIONS.browserId)) {
    preferred.push(OPTIONS.browserId);
  }
  for (const id of ALLOWED_BROWSER_IDS) {
    if (!preferred.includes(id)) preferred.push(id);
  }
  return preferred;
}

async function detectFirstDedicatedAvailable() {
  for (const browserId of preferredDedicatedIds()) {
    const profile = defaultDedicatedProfileDir(browserId);
    const port = await detectChromePortFor('dedicated', profile);
    if (port) {
      return { browser: 'dedicated', browserId, dedicatedProfileDir: profile, port };
    }
  }
  return null;
}

function activePortFilesFor(browser, dedicatedProfileDir = null) {
  const previousBrowser = OPTIONS.browser;
  const previousProfile = OPTIONS.dedicatedProfileDir;
  OPTIONS.browser = browser;
  if (dedicatedProfileDir) {
    OPTIONS.dedicatedProfileDir = dedicatedProfileDir;
  }
  const files = activePortFiles();
  OPTIONS.browser = previousBrowser;
  OPTIONS.dedicatedProfileDir = previousProfile;
  return files;
}

async function detectChromePortFor(browser, dedicatedProfileDir = null) {
  for (const filePath of activePortFilesFor(browser, dedicatedProfileDir)) {
    try {
      const lines = fs.readFileSync(filePath, 'utf8').trim().split(/\r?\n/).filter(Boolean);
      const port = parseInt(lines[0], 10);
      if (port > 0 && port < 65536 && await checkPort(port)) {
        return port;
      }
    } catch (_) {}
  }
  return null;
}

async function resolveRuntime() {
  if (OPTIONS.browserSpecified) {
    if (OPTIONS.browser === 'primary') {
      const port = await detectChromePortFor('primary');
      if (!port) {
        return {
          ok: false,
          reason: 'primary_not_connected',
          availableModes: [],
          requestedMode: 'primary',
          guidance: '请先开启 primary browser 的远程调试，或改为 dedicated 模式。',
        };
      }
      return {
        ok: true,
        browser: 'primary',
        browserId: null,
        dedicatedProfileDir: null,
        port,
        availableModes: ['primary'],
        selectedBecause: 'requested_mode',
      };
    }

    const dedicatedProfileDir = OPTIONS.dedicatedProfileDir || defaultDedicatedProfileDir(OPTIONS.browserId);
    const port = await detectChromePortFor('dedicated', dedicatedProfileDir);
    if (!port) {
      return {
        ok: false,
        reason: 'dedicated_not_connected',
        availableModes: [],
        requestedMode: 'dedicated',
        browserId: OPTIONS.browserId,
        dedicatedProfileDir,
        guidance: '请先启动专用浏览器，或检查 dedicated profile 路径是否正确。',
      };
    }
    return {
      ok: true,
      browser: 'dedicated',
      browserId: OPTIONS.browserId,
      dedicatedProfileDir,
      port,
      availableModes: ['dedicated'],
      selectedBecause: 'requested_mode',
    };
  }

  const primaryPort = await detectChromePortFor('primary');
  const dedicated = await detectFirstDedicatedAvailable();
  const availableModes = [];
  if (primaryPort) availableModes.push('primary');
  if (dedicated) availableModes.push('dedicated');

  if (primaryPort && dedicated) {
    return {
      ok: true,
      ...dedicated,
      availableModes,
      selectedBecause: 'dedicated_preferred_when_both_available',
    };
  }
  if (dedicated) {
    return {
      ok: true,
      ...dedicated,
      availableModes,
      selectedBecause: 'only_dedicated_available',
    };
  }
  if (primaryPort) {
    return {
      ok: true,
      browser: 'primary',
      browserId: null,
      dedicatedProfileDir: null,
      port: primaryPort,
      availableModes,
      selectedBecause: 'only_primary_available',
    };
  }

  return {
    ok: false,
    reason: 'no_browser_available',
    availableModes,
    requestedMode: null,
    guidance: {
      primary: '先在主力浏览器开启 remote debugging，然后重跑 check-deps。',
      dedicated: '先启动 dedicated profile（带 --remote-debugging-port），再重跑 check-deps。',
    },
  };
}

// --- CDP Proxy 启动与等待 ---

function httpGetJson(url, timeoutMs = 3000) {
  return fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    .then(async (res) => {
      try { return JSON.parse(await res.text()); } catch { return null; }
    })
    .catch(() => null);
}

function startProxyDetached() {
  const logFile = path.join(os.tmpdir(), 'cdp-proxy.log');
  const logFd = fs.openSync(logFile, 'a');
  const child = spawn(process.execPath, [PROXY_SCRIPT], {
    env: {
      ...process.env,
      BROWSER_MODE: OPTIONS.browser,
      BROWSER_ID: OPTIONS.browserId || '',
      DEDICATED_PROFILE_DIR: OPTIONS.dedicatedProfileDir || '',
    },
    detached: true,
    stdio: ['ignore', logFd, logFd],
    ...(os.platform() === 'win32' ? { windowsHide: true } : {}),
  });
  child.unref();
  fs.closeSync(logFd);
}

async function ensureProxy() {
  const healthUrl = `http://127.0.0.1:${PROXY_PORT}/health`;
  const shutdownUrl = `http://127.0.0.1:${PROXY_PORT}/shutdown`;
  const targetsUrl = `http://127.0.0.1:${PROXY_PORT}/targets`;

  const health = await httpGetJson(healthUrl);
  if (
    health?.status === 'ok' &&
    health.browserMode === OPTIONS.browser &&
    health.connected === true
  ) {
    return { ok: true, reusedExisting: true, restartedForModeSwitch: false };
  }

  let restartedForModeSwitch = false;
  if (health?.status === 'ok' && health.browserMode && health.browserMode !== OPTIONS.browser) {
    await httpGetJson(shutdownUrl, 2000);
    await new Promise((r) => setTimeout(r, 1000));
    restartedForModeSwitch = true;
  }

  // /targets 返回 JSON 数组即 ready
  const targets = await httpGetJson(targetsUrl);
  if (Array.isArray(targets)) {
    return { ok: true, reusedExisting: true, restartedForModeSwitch };
  }

  // 未运行或未连接，启动并等待
  startProxyDetached();

  // 等 proxy 进程就绪
  await new Promise((r) => setTimeout(r, 2000));

  let hint = null;
  for (let i = 1; i <= 15; i++) {
    const result = await httpGetJson(targetsUrl, 8000);
    if (Array.isArray(result)) {
      return { ok: true, reusedExisting: false, restartedForModeSwitch, hint };
    }
    if (i === 1) {
      hint = OPTIONS.browser === 'primary'
        ? '主力浏览器模式下，可能有远程调试授权弹窗，请点击“允许”后等待连接。'
        : '专用浏览器模式下通常不会有授权弹窗；若持续超时，请检查 dedicated profile 路径和启动参数是否一致。';
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  return {
    ok: false,
    reusedExisting: false,
    restartedForModeSwitch,
    hint,
    reason: 'proxy_connect_timeout',
    logFile: path.join(os.tmpdir(), 'cdp-proxy.log'),
  };
}

// --- main ---

async function main() {
  const node = checkNode();

  const runtime = await resolveRuntime();
  if (!runtime.ok) {
    fail({
      node,
      proxyReady: false,
      ...runtime,
    });
  }

  OPTIONS.browser = runtime.browser;
  OPTIONS.browserId = runtime.browserId;
  OPTIONS.dedicatedProfileDir = runtime.dedicatedProfileDir;

  const proxy = await ensureProxy();
  if (!proxy.ok) {
    fail({
      node,
      selectedMode: runtime.browser,
      browserId: runtime.browserId,
      dedicatedProfileDir: runtime.dedicatedProfileDir,
      port: runtime.port,
      availableModes: runtime.availableModes,
      selectedBecause: runtime.selectedBecause,
      proxyReady: false,
      proxy,
    });
  }

  // 列出已有站点经验
  const patternsDir = path.join(ROOT, 'references', 'site-patterns');
  let sitePatterns = [];
  try {
    sitePatterns = fs.readdirSync(patternsDir)
      .filter(f => f.endsWith('.md'))
      .map(f => f.replace(/\.md$/, ''));
  } catch {}

  printJson({
    ok: true,
    node,
    availableModes: runtime.availableModes,
    selectedMode: runtime.browser,
    selectedBecause: runtime.selectedBecause,
    browserId: runtime.browserId,
    dedicatedProfileDir: runtime.dedicatedProfileDir,
    port: runtime.port,
    proxyReady: true,
    proxy,
    sitePatterns,
  });
}

try {
  await main();
} catch (error) {
  fail({
    reason: 'unexpected_error',
    message: error instanceof Error ? error.message : String(error),
    proxyReady: false,
  });
}

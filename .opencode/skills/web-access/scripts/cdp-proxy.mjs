#!/usr/bin/env node

import http from 'node:http';
import fs from 'node:fs';
import net from 'node:net';

import { createRuntime, loadRuntimeConfig, resolveRuntimeAvailability } from './browser-runtime/index.mjs';

const PORT = parseInt(process.env.CDP_PROXY_PORT || '3456');
const BROWSERBASE_IDLE_SHUTDOWN_MS = parseInt(process.env.BROWSERBASE_IDLE_SHUTDOWN_MS || '60000', 10);

let runtime = null;
let runtimeInfo = null;
let runtimeConfig = loadRuntimeConfig(process.env);
let runtimePromise = null;
let shuttingDown = false;
let idleShutdownTimer = null;
let activeRequests = 0;
let lastActivityAt = 0;

async function ensureRuntime() {
  if (runtime) return runtime;
  if (runtimePromise) return runtimePromise;
  runtimePromise = (async () => {
    runtimeInfo = await resolveRuntimeAvailability(runtimeConfig);
    if (!runtimeInfo.ok) {
      throw new Error(runtimeInfo.reason || 'runtime_unavailable');
    }
    runtime = await createRuntime(runtimeConfig, runtimeInfo);
    return runtime;
  })();
  try {
    return await runtimePromise;
  } finally {
    runtimePromise = null;
  }
}

function isBrowserbaseRuntime() {
  return runtimeInfo?.provider === 'browserbase';
}

function clearIdleShutdownTimer() {
  if (!idleShutdownTimer) return;
  clearTimeout(idleShutdownTimer);
  idleShutdownTimer = null;
}

async function triggerIdleShutdown() {
  if (shuttingDown || !isBrowserbaseRuntime() || activeRequests > 0 || !runtime) return;
  const idleFor = Date.now() - lastActivityAt;
  if (idleFor < BROWSERBASE_IDLE_SHUTDOWN_MS) {
    scheduleIdleShutdown();
    return;
  }
  try {
    const release = await releaseRuntime();
    console.log('[CDP Proxy] Browserbase idle shutdown complete', JSON.stringify(release));
  } catch (error) {
    console.error('[CDP Proxy] Browserbase idle shutdown failed:', error?.message || error);
  }
  await shutdown(0);
}

function scheduleIdleShutdown() {
  clearIdleShutdownTimer();
  if (shuttingDown || !isBrowserbaseRuntime() || activeRequests > 0 || !runtime) return;
  idleShutdownTimer = setTimeout(() => {
    idleShutdownTimer = null;
    triggerIdleShutdown().catch((error) => {
      console.error('[CDP Proxy] idle shutdown crashed:', error?.message || error);
    });
  }, BROWSERBASE_IDLE_SHUTDOWN_MS);
  idleShutdownTimer.unref?.();
}

async function withRuntime(handler) {
  clearIdleShutdownTimer();
  activeRequests += 1;
  try {
    const activeRuntime = await ensureRuntime();
    return await handler(activeRuntime);
  } finally {
    activeRequests = Math.max(0, activeRequests - 1);
    lastActivityAt = Date.now();
    scheduleIdleShutdown();
  }
}

async function getHealth() {
  if (!runtime) {
    return {
      status: 'ok',
      connected: false,
      provider: runtimeConfig.provider,
      browserMode: runtimeConfig.browserMode,
      sessions: 0,
      chromePort: null,
      browserbaseSessionId: null,
      browserbaseDebugUrl: null,
    };
  }
  const health = await runtime.health();
  return { status: 'ok', ...health };
}

async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearIdleShutdownTimer();
  server.close(() => process.exit(code));
  setTimeout(() => process.exit(code), 500).unref?.();
}

async function releaseRuntime() {
  return await runtime?.shutdown?.() ?? { released: false, skipped: true };
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body;
}

function sendJson(res, payload, statusCode = 200) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsed.pathname;
  const q = Object.fromEntries(parsed.searchParams);

  try {
    if (pathname === '/health') {
      sendJson(res, await getHealth());
      return;
    }
    if (pathname === '/shutdown') {
      const release = await releaseRuntime();
      sendJson(res, { status: 'ok', shuttingDown: true, release });
      setTimeout(() => shutdown(0), 50).unref?.();
      return;
    }

    if (pathname === '/targets') {
      sendJson(res, await withRuntime((activeRuntime) => activeRuntime.listTargets()));
      return;
    }
    if (pathname === '/new') {
      sendJson(res, await withRuntime((activeRuntime) => activeRuntime.createTarget({ url: q.url || 'about:blank', background: q.background !== 'false' })));
      return;
    }
    if (pathname === '/close') {
      sendJson(res, await withRuntime((activeRuntime) => activeRuntime.closeTarget(q.target)));
      return;
    }
    if (pathname === '/navigate') {
      sendJson(res, await withRuntime((activeRuntime) => activeRuntime.navigate(q.target, q.url)));
      return;
    }
    if (pathname === '/activate') {
      sendJson(res, await withRuntime((activeRuntime) => activeRuntime.activate(q.target)));
      return;
    }
    if (pathname === '/back') {
      sendJson(res, await withRuntime((activeRuntime) => activeRuntime.back(q.target)));
      return;
    }
    if (pathname === '/eval') {
      const expr = (await readBody(req)) || q.expr || 'document.title';
      sendJson(res, await withRuntime((activeRuntime) => activeRuntime.evaluate(q.target, expr)));
      return;
    }
    if (pathname === '/click') {
      const selector = await readBody(req);
      if (!selector) return sendJson(res, { error: 'POST body 需要 CSS 选择器' }, 400);
      sendJson(res, await withRuntime((activeRuntime) => activeRuntime.click(q.target, selector)));
      return;
    }
    if (pathname === '/clickAt') {
      const selector = await readBody(req);
      if (!selector) return sendJson(res, { error: 'POST body 需要 CSS 选择器' }, 400);
      sendJson(res, await withRuntime((activeRuntime) => activeRuntime.clickAt(q.target, selector)));
      return;
    }
    if (pathname === '/setFiles') {
      const body = JSON.parse(await readBody(req));
      if (!body.selector || !body.files) return sendJson(res, { error: '需要 selector 和 files 字段' }, 400);
      sendJson(res, await withRuntime((activeRuntime) => activeRuntime.setFiles(q.target, body.selector, body.files)));
      return;
    }
    if (pathname === '/scroll') {
      sendJson(res, await withRuntime((activeRuntime) => activeRuntime.scroll(q.target, { y: parseInt(q.y || '3000', 10), direction: q.direction || 'down' })));
      return;
    }
    if (pathname === '/screenshot') {
      const result = await withRuntime((activeRuntime) => activeRuntime.screenshot(q.target, { filePath: q.file || null, format: q.format || 'png' }));
      if (result.filePath) {
        fs.writeFileSync(result.filePath, result.buffer);
        sendJson(res, { saved: result.filePath });
      } else {
        res.setHeader('Content-Type', 'image/' + (q.format || 'png'));
        res.end(result.buffer);
      }
      return;
    }
    if (pathname === '/info') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(await withRuntime((activeRuntime) => activeRuntime.info(q.target)));
      return;
    }

    sendJson(res, {
      error: '未知端点',
      endpoints: {
        '/health': 'GET - 健康检查',
        '/targets': 'GET - 列出所有页面 tab',
        '/new?url=': 'GET - 创建新后台 tab（自动等待加载）',
        '/close?target=': 'GET - 关闭 tab',
        '/navigate?target=&url=': 'GET - 导航（自动等待加载）',
        '/activate?target=': 'GET - 激活 tab 并切到前台',
        '/back?target=': 'GET - 后退',
        '/info?target=': 'GET - 页面标题/URL/状态',
        '/eval?target=': 'POST body=JS表达式 - 执行 JS',
        '/click?target=': 'POST body=CSS选择器 - 点击元素',
        '/scroll?target=&y=&direction=': 'GET - 滚动页面',
        '/screenshot?target=&file=': 'GET - 截图',
      },
    }, 404);
  } catch (error) {
    const statusCode = error?.statusCode || 500;
    // If the error is a Playwright disconnect (browser/context closed), reset the runtime
    // so the next request creates a fresh Browserbase session instead of reusing the dead one.
    if (!error?.statusCode && isRuntimeDisconnected(error)) {
      console.error('[cdp-proxy] browser disconnected, resetting runtime for next request:', error?.message);
      runtime = null;
    }
    sendJson(res, { error: error instanceof Error ? error.message : String(error) }, statusCode);
  }
});

function isRuntimeDisconnected(error) {
  const msg = error?.message || '';
  return (
    msg.includes('Target page, context or browser has been closed') ||
    msg.includes('Browser has been closed') ||
    msg.includes('Underlying Browser is disconnected') ||
    msg.includes('WebSocket is closed') ||
    msg.includes('WebSocket is not open')
  );
}

function checkPortAvailable(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => { s.close(); resolve(true); });
    s.listen(port, '127.0.0.1');
  });
}

async function main() {
  const available = await checkPortAvailable(PORT);
  if (!available) {
    try {
      const ok = await new Promise((resolve) => {
        http.get(`http://127.0.0.1:${PORT}/health`, { timeout: 2000 }, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => resolve(data.includes('"ok"')));
        }).on('error', () => resolve(false));
      });
      if (ok) {
        console.log(`[CDP Proxy] 已有实例运行在端口 ${PORT}，退出`);
        process.exit(0);
      }
    } catch {}
    console.error(`[CDP Proxy] 端口 ${PORT} 已被占用`);
    process.exit(1);
  }

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[CDP Proxy] 运行在 http://localhost:${PORT}`);
    ensureRuntime().catch((error) => console.error('[CDP Proxy] 初始连接失败:', error.message, '（将在首次请求时重试）'));
  });
}

process.on('uncaughtException', (error) => {
  console.error('[CDP Proxy] 未捕获异常:', error.message);
});

process.on('unhandledRejection', (error) => {
  console.error('[CDP Proxy] 未处理拒绝:', error?.message || error);
});

main();

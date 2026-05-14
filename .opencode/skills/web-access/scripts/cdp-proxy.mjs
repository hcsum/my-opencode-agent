#!/usr/bin/env node

import http from 'node:http';
import fs from 'node:fs';
import net from 'node:net';

import { createRuntime, loadRuntimeConfig, resolveRuntimeAvailability } from './browser-runtime/index.mjs';

const PORT = parseInt(process.env.CDP_PROXY_PORT || '3456');

let runtime = null;
let runtimeInfo = null;
let runtimeConfig = loadRuntimeConfig(process.env);
let runtimePromise = null;
let shuttingDown = false;

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
  try {
    await runtime?.shutdown?.();
  } catch {}
  server.close(() => process.exit(code));
  setTimeout(() => process.exit(code), 500).unref?.();
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
      sendJson(res, { status: 'ok', shuttingDown: true });
      setTimeout(() => shutdown(0), 50).unref?.();
      return;
    }

    const activeRuntime = await ensureRuntime();

    if (pathname === '/targets') {
      sendJson(res, await activeRuntime.listTargets());
      return;
    }
    if (pathname === '/new') {
      sendJson(res, await activeRuntime.createTarget({ url: q.url || 'about:blank', background: q.background !== 'false' }));
      return;
    }
    if (pathname === '/close') {
      sendJson(res, await activeRuntime.closeTarget(q.target));
      return;
    }
    if (pathname === '/navigate') {
      sendJson(res, await activeRuntime.navigate(q.target, q.url));
      return;
    }
    if (pathname === '/activate') {
      sendJson(res, await activeRuntime.activate(q.target));
      return;
    }
    if (pathname === '/back') {
      sendJson(res, await activeRuntime.back(q.target));
      return;
    }
    if (pathname === '/eval') {
      const expr = (await readBody(req)) || q.expr || 'document.title';
      sendJson(res, await activeRuntime.evaluate(q.target, expr));
      return;
    }
    if (pathname === '/click') {
      const selector = await readBody(req);
      if (!selector) return sendJson(res, { error: 'POST body 需要 CSS 选择器' }, 400);
      sendJson(res, await activeRuntime.click(q.target, selector));
      return;
    }
    if (pathname === '/clickAt') {
      const selector = await readBody(req);
      if (!selector) return sendJson(res, { error: 'POST body 需要 CSS 选择器' }, 400);
      sendJson(res, await activeRuntime.clickAt(q.target, selector));
      return;
    }
    if (pathname === '/setFiles') {
      const body = JSON.parse(await readBody(req));
      if (!body.selector || !body.files) return sendJson(res, { error: '需要 selector 和 files 字段' }, 400);
      sendJson(res, await activeRuntime.setFiles(q.target, body.selector, body.files));
      return;
    }
    if (pathname === '/scroll') {
      sendJson(res, await activeRuntime.scroll(q.target, { y: parseInt(q.y || '3000', 10), direction: q.direction || 'down' }));
      return;
    }
    if (pathname === '/screenshot') {
      const result = await activeRuntime.screenshot(q.target, { filePath: q.file || null, format: q.format || 'png' });
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
      res.end(await activeRuntime.info(q.target));
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
    sendJson(res, { error: error instanceof Error ? error.message : String(error) }, statusCode);
  }
});

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

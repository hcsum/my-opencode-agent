#!/usr/bin/env node

import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { URL } from "node:url";

const PORT = parseInt(process.env.CDP_PROXY_PORT || "3456", 10);
const PROXY_BASE_URL = `http://127.0.0.1:${PORT}`;
const WS_URL_FILE = "/tmp/cdp-browser-ws-url";
const BROWSER_MODE = process.env.BROWSER_MODE || "dedicated";
const DEDICATED_PROFILE_DIR =
  process.env.DEDICATED_PROFILE_DIR ||
  path.join(os.homedir(), ".web-access/brave-profile");
let ws = null;
let cmdId = 0;
const pending = new Map();
const sessions = new Map();
const portGuardedSessions = new Set();

let WS;
if (typeof globalThis.WebSocket !== "undefined") {
  WS = globalThis.WebSocket;
} else {
  try {
    WS = (await import("ws")).default;
  } catch {
    console.error("[CDP Proxy] Node.js 22+ or ws is required");
    process.exit(1);
  }
}

async function fetchWebSocketUrl(port) {
  try {
    const resp = await new Promise((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve(body));
      });
      req.on("error", reject);
      req.setTimeout(3000, () => {
        req.destroy();
        reject(new Error("timeout"));
      });
    });
    const parsed = JSON.parse(resp);
    return parsed.webSocketDebuggerUrl || null;
  } catch {
    return null;
  }
}

async function discoverChromePort(mode = "user") {
  const possiblePaths = [];
  const platform = os.platform();

  if (platform === "darwin") {
    const home = os.homedir();
    if (mode === "user") {
      possiblePaths.push(
        path.join(home, "Library/Application Support/Google/Chrome/DevToolsActivePort"),
        path.join(home, "Library/Application Support/Google/Chrome Canary/DevToolsActivePort"),
        path.join(home, "Library/Application Support/Chromium/DevToolsActivePort"),
        path.join(home, "Library/Application Support/BraveSoftware/Brave-Browser/DevToolsActivePort"),
      );
    } else {
      possiblePaths.push(path.join(DEDICATED_PROFILE_DIR, "DevToolsActivePort"));
    }
  } else if (platform === "linux") {
    const home = os.homedir();
    if (mode === "user") {
      possiblePaths.push(
        path.join(home, ".config/google-chrome/DevToolsActivePort"),
        path.join(home, ".config/chromium/DevToolsActivePort"),
        path.join(home, ".config/BraveSoftware/Brave-Browser/DevToolsActivePort"),
      );
    } else {
      possiblePaths.push(path.join(DEDICATED_PROFILE_DIR, "DevToolsActivePort"));
    }
  } else if (platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || "";
    if (mode === "user") {
      possiblePaths.push(
        path.join(localAppData, "Google/Chrome/User Data/DevToolsActivePort"),
        path.join(localAppData, "Chromium/User Data/DevToolsActivePort"),
        path.join(localAppData, "BraveSoftware/Brave-Browser/User Data/DevToolsActivePort"),
      );
    } else {
      possiblePaths.push(path.join(DEDICATED_PROFILE_DIR, "DevToolsActivePort"));
    }
  }

  for (const filePath of possiblePaths) {
    try {
      const content = fs.readFileSync(filePath, "utf-8").trim();
      const lines = content.split("\n");
      const port = parseInt(lines[0], 10);
      if (port > 0 && port < 65536) {
        const ok = await checkPort(port);
        if (ok) {
          return { port, wsPath: lines[1] || null };
        }
      }
    } catch {}
  }

  const fixedPorts = mode === "user" ? [9222, 9223, 9229, 9333] : [9222];
  for (const port of fixedPorts) {
    if (await checkPort(port)) {
      const wsUrl = await fetchWebSocketUrl(port);
      if (wsUrl) {
        return { port, wsPath: new URL(wsUrl).pathname };
      }
      return { port, wsPath: null };
    }
  }

  return null;
}

function checkPort(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection(port, "127.0.0.1");
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 2000);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

function getWebSocketUrl(port, wsPath) {
  if (wsPath) return `ws://127.0.0.1:${port}${wsPath}`;
  return `ws://127.0.0.1:${port}/devtools/browser`;
}

let chromePort = null;
let chromeWsPath = null;
let connectingPromise = null;

async function connectWithUrl(wsUrl) {
  return (connectingPromise = new Promise((resolve, reject) => {
    ws = new WS(wsUrl);

    const onOpen = () => {
      cleanup();
      connectingPromise = null;
      console.log(`[CDP Proxy] connected to ${wsUrl}`);
      resolve();
    };
    const onError = (event) => {
      cleanup();
      connectingPromise = null;
      const message =
        event.message || event.error?.message || "connection failed";
      reject(new Error(message));
    };
    const onClose = () => {
      ws = null;
      chromePort = null;
      chromeWsPath = null;
      sessions.clear();
      portGuardedSessions.clear();
    };
    const onMessage = (event) => {
      const raw = typeof event === "string" ? event : event.data || event;
      const text = typeof raw === "string" ? raw : raw.toString();
      const msg = JSON.parse(text);

      if (msg.method === "Target.attachedToTarget") {
        const { sessionId, targetInfo } = msg.params;
        sessions.set(targetInfo.targetId, sessionId);
      }

      if (msg.method === "Fetch.requestPaused") {
        const { requestId, sessionId } = msg.params;
        sendCDP(
          "Fetch.failRequest",
          { requestId, errorReason: "ConnectionRefused" },
          sessionId,
        ).catch(() => {});
      }

      if (msg.id && pending.has(msg.id)) {
        const entry = pending.get(msg.id);
        clearTimeout(entry.timer);
        pending.delete(msg.id);
        entry.resolve(msg);
      }
    };

    function cleanup() {
      ws.removeEventListener?.("open", onOpen);
      ws.removeEventListener?.("error", onError);
    }

    if (ws.on) {
      ws.on("open", onOpen);
      ws.on("error", onError);
      ws.on("close", onClose);
      ws.on("message", onMessage);
    } else {
      ws.addEventListener("open", onOpen);
      ws.addEventListener("error", onError);
      ws.addEventListener("close", onClose);
      ws.addEventListener("message", onMessage);
    }
  }));
}

async function connect() {
  if (ws && (ws.readyState === WS.OPEN || ws.readyState === 1)) return;
  if (connectingPromise) return connectingPromise;

  if (!chromePort) {
    // First, try to read pre-configured WebSocket URL from file
    try {
      if (fs.existsSync(WS_URL_FILE)) {
        const content = fs.readFileSync(WS_URL_FILE, "utf-8").trim();
        const match = content.match(/^ws_url:\s*(.+)$/);
        if (match) {
          const configuredUrl = match[1];
          const urlMatch = configuredUrl.match(/ws:\/\/127\.0\.0\.1:(\d+)(.+)/);
          if (urlMatch) {
            chromePort = parseInt(urlMatch[1], 10);
            chromeWsPath = configuredUrl;
            return connectWithUrl(configuredUrl);
          }
        }
      }
    } catch {}

    const discovered = await discoverChromePort(BROWSER_MODE);
    if (!discovered) {
      throw new Error(
        BROWSER_MODE === "user"
          ? "Chrome remote debugging is not available. Enable it in your normal Chrome session first."
          : "Dedicated browser remote debugging is not available. Start the dedicated Brave instance first.",
      );
    }
    chromePort = discovered.port;
    chromeWsPath = discovered.wsPath;
  }

  const wsUrl = getWebSocketUrl(chromePort, chromeWsPath);
  return connectWithUrl(wsUrl);
}

function sendCDP(method, params = {}, sessionId = null) {
  return new Promise((resolve, reject) => {
    if (!ws || (ws.readyState !== WS.OPEN && ws.readyState !== 1)) {
      reject(new Error("WebSocket not connected"));
      return;
    }

    const id = ++cmdId;
    const message = { id, method, params };
    if (sessionId) {
      message.sessionId = sessionId;
    }

    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP command timed out: ${method}`));
    }, 30_000);

    pending.set(id, { resolve, timer });
    ws.send(JSON.stringify(message));
  });
}

async function ensureSession(targetId) {
  if (sessions.has(targetId)) return sessions.get(targetId);
  const response = await sendCDP("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  if (response.result?.sessionId) {
    sessions.set(targetId, response.result.sessionId);
    await enablePortGuard(response.result.sessionId);
    return response.result.sessionId;
  }
  throw new Error(`Failed to attach to target ${targetId}`);
}

async function enablePortGuard(sessionId) {
  if (!chromePort || portGuardedSessions.has(sessionId)) return;

  try {
    await sendCDP(
      "Fetch.enable",
      {
        patterns: [
          { urlPattern: `http://127.0.0.1:${chromePort}/*`, requestStage: "Request" },
          { urlPattern: `http://localhost:${chromePort}/*`, requestStage: "Request" },
        ],
      },
      sessionId,
    );
    portGuardedSessions.add(sessionId);
  } catch {}
}

async function waitForLoad(sessionId, timeoutMs = 15_000) {
  await sendCDP("Page.enable", {}, sessionId);

  return new Promise((resolve) => {
    let finished = false;
    const done = (value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearInterval(interval);
      resolve(value);
    };

    const timer = setTimeout(() => done("timeout"), timeoutMs);
    const interval = setInterval(async () => {
      try {
        const response = await sendCDP(
          "Runtime.evaluate",
          {
            expression: "document.readyState",
            returnByValue: true,
          },
          sessionId,
        );
        if (response.result?.result?.value === "complete") {
          done("complete");
        }
      } catch {}
    }, 500);
  });
}

async function readBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
  }
  return body;
}

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsed.pathname;
  const query = Object.fromEntries(parsed.searchParams);

  res.setHeader("Content-Type", "application/json; charset=utf-8");

  try {
    if (pathname === "/health") {
      const connected =
        ws && (ws.readyState === WS.OPEN || ws.readyState === 1);
      res.end(
        JSON.stringify({
          status: "ok",
          connected,
          browserMode: BROWSER_MODE,
          sessions: sessions.size,
          chromePort,
        }),
      );
      return;
    }

    await connect();

    if (pathname === "/targets") {
      const response = await sendCDP("Target.getTargets");
      const pages = response.result.targetInfos.filter(
        (target) => target.type === "page",
      );
      res.end(JSON.stringify(pages, null, 2));
      return;
    }

    if (pathname === "/new") {
      const targetUrl = query.url || "about:blank";
      const background = query.background !== "false";
      const response = await sendCDP("Target.createTarget", {
        url: targetUrl,
        background,
      });
      const targetId = response.result.targetId;
      if (targetUrl !== "about:blank") {
        try {
          const sessionId = await ensureSession(targetId);
          await waitForLoad(sessionId);
        } catch {}
      }
      res.end(JSON.stringify({ targetId }));
      return;
    }

    if (pathname === "/close") {
      const response = await sendCDP("Target.closeTarget", {
        targetId: query.target,
      });
      sessions.delete(query.target);
      res.end(JSON.stringify(response.result));
      return;
    }

    if (pathname === "/navigate") {
      const sessionId = await ensureSession(query.target);
      const response = await sendCDP(
        "Page.navigate",
        { url: query.url },
        sessionId,
      );
      await waitForLoad(sessionId);
      res.end(JSON.stringify(response.result));
      return;
    }

    if (pathname === "/back") {
      const sessionId = await ensureSession(query.target);
      await sendCDP(
        "Runtime.evaluate",
        { expression: "history.back()" },
        sessionId,
      );
      await waitForLoad(sessionId);
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (pathname === "/eval") {
      const sessionId = await ensureSession(query.target);
      const body = await readBody(req);
      const expression = body || query.expr || "document.title";
      const response = await sendCDP(
        "Runtime.evaluate",
        {
          expression,
          returnByValue: true,
          awaitPromise: true,
        },
        sessionId,
      );

      if (response.result?.result?.value !== undefined) {
        res.end(JSON.stringify({ value: response.result.result.value }));
        return;
      }
      if (response.result?.exceptionDetails) {
        res.statusCode = 400;
        res.end(
          JSON.stringify({ error: response.result.exceptionDetails.text }),
        );
        return;
      }
      res.end(JSON.stringify(response.result));
      return;
    }

    if (pathname === "/click") {
      const sessionId = await ensureSession(query.target);
      const selector = await readBody(req);
      if (!selector) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "POST body must be a CSS selector" }));
        return;
      }
      const selectorJson = JSON.stringify(selector);
      const expression = `(() => {
        const el = document.querySelector(${selectorJson});
        if (!el) return { error: 'Element not found: ' + ${selectorJson} };
        el.scrollIntoView({ block: 'center' });
        el.click();
        return { clicked: true, tag: el.tagName, text: (el.textContent || '').slice(0, 100) };
      })()`;
      const response = await sendCDP(
        "Runtime.evaluate",
        {
          expression,
          returnByValue: true,
          awaitPromise: true,
        },
        sessionId,
      );
      const value = response.result?.result?.value;
      if (value?.error) {
        res.statusCode = 400;
      }
      res.end(JSON.stringify(value ?? response.result));
      return;
    }

    if (pathname === "/clickAt") {
      const sessionId = await ensureSession(query.target);
      const selector = await readBody(req);
      if (!selector) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "POST body must be a CSS selector" }));
        return;
      }

      const selectorJson = JSON.stringify(selector);
      const response = await sendCDP(
        "Runtime.evaluate",
        {
          expression: `(() => {
            const el = document.querySelector(${selectorJson});
            if (!el) return { error: 'Element not found: ' + ${selectorJson} };
            el.scrollIntoView({ block: 'center' });
            const rect = el.getBoundingClientRect();
            return {
              x: rect.x + rect.width / 2,
              y: rect.y + rect.height / 2,
              tag: el.tagName,
              text: (el.textContent || '').slice(0, 100),
            };
          })()`,
          returnByValue: true,
          awaitPromise: true,
        },
        sessionId,
      );

      const point = response.result?.result?.value;
      if (!point || point.error) {
        res.statusCode = 400;
        res.end(JSON.stringify(point ?? response.result));
        return;
      }

      await sendCDP(
        "Input.dispatchMouseEvent",
        {
          type: "mousePressed",
          x: point.x,
          y: point.y,
          button: "left",
          clickCount: 1,
        },
        sessionId,
      );
      await sendCDP(
        "Input.dispatchMouseEvent",
        {
          type: "mouseReleased",
          x: point.x,
          y: point.y,
          button: "left",
          clickCount: 1,
        },
        sessionId,
      );
      res.end(
        JSON.stringify({
          clicked: true,
          x: point.x,
          y: point.y,
          tag: point.tag,
          text: point.text,
        }),
      );
      return;
    }

    if (pathname === "/setFiles") {
      const sessionId = await ensureSession(query.target);
      const body = JSON.parse(await readBody(req));
      if (!body.selector || !body.files) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "selector and files are required" }));
        return;
      }

      await sendCDP("DOM.enable", {}, sessionId);
      const documentResponse = await sendCDP("DOM.getDocument", {}, sessionId);
      const nodeResponse = await sendCDP(
        "DOM.querySelector",
        {
          nodeId: documentResponse.result.root.nodeId,
          selector: body.selector,
        },
        sessionId,
      );
      if (!nodeResponse.result?.nodeId) {
        res.statusCode = 400;
        res.end(
          JSON.stringify({ error: `Element not found: ${body.selector}` }),
        );
        return;
      }

      await sendCDP(
        "DOM.setFileInputFiles",
        {
          nodeId: nodeResponse.result.nodeId,
          files: body.files,
        },
        sessionId,
      );
      res.end(JSON.stringify({ success: true, files: body.files.length }));
      return;
    }

    if (pathname === "/scroll") {
      const sessionId = await ensureSession(query.target);
      const y = parseInt(query.y || "3000", 10);
      const direction = query.direction || "down";
      let expression;
      if (direction === "top") {
        expression = 'window.scrollTo(0, 0); "scrolled to top"';
      } else if (direction === "bottom") {
        expression =
          'window.scrollTo(0, document.body.scrollHeight); "scrolled to bottom"';
      } else if (direction === "up") {
        expression = `window.scrollBy(0, -${Math.abs(y)}); "scrolled up ${Math.abs(y)}px"`;
      } else {
        expression = `window.scrollBy(0, ${Math.abs(y)}); "scrolled down ${Math.abs(y)}px"`;
      }
      const response = await sendCDP(
        "Runtime.evaluate",
        { expression, returnByValue: true },
        sessionId,
      );
      await new Promise((resolve) => setTimeout(resolve, 800));
      res.end(JSON.stringify({ value: response.result?.result?.value }));
      return;
    }

    if (pathname === "/screenshot") {
      const sessionId = await ensureSession(query.target);
      const format = query.format || "png";
      const response = await sendCDP(
        "Page.captureScreenshot",
        {
          format,
          quality: format === "jpeg" ? 80 : undefined,
        },
        sessionId,
      );
      if (query.file) {
        fs.writeFileSync(
          query.file,
          Buffer.from(response.result.data, "base64"),
        );
        res.end(JSON.stringify({ saved: query.file }));
        return;
      }

      res.setHeader("Content-Type", `image/${format}`);
      res.end(Buffer.from(response.result.data, "base64"));
      return;
    }

    if (pathname === "/info") {
      const sessionId = await ensureSession(query.target);
      const response = await sendCDP(
        "Runtime.evaluate",
        {
          expression:
            "JSON.stringify({title: document.title, url: location.href, ready: document.readyState})",
          returnByValue: true,
        },
        sessionId,
      );
      res.end(response.result?.result?.value || "{}");
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "Unknown endpoint" }));
  } catch (error) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: error.message }));
  }
});

function checkPortAvailable(port) {
  return new Promise((resolve) => {
    const serverInstance = net.createServer();
    serverInstance.once("error", () => resolve(false));
    serverInstance.once("listening", () => {
      serverInstance.close();
      resolve(true);
    });
    serverInstance.listen(port, "127.0.0.1");
  });
}

async function main() {
  const available = await checkPortAvailable(PORT);
  if (!available) {
    try {
      const ok = await new Promise((resolve) => {
        http
          .get(`${PROXY_BASE_URL}/health`, { timeout: 2000 }, (res) => {
            let body = "";
            res.on("data", (chunk) => {
              body += chunk.toString();
            });
            res.on("end", () => resolve(body.includes('"ok"')));
          })
          .on("error", () => resolve(false));
      });
      if (ok) {
        console.log(`[CDP Proxy] already running on port ${PORT}`);
        process.exit(0);
      }
    } catch {}

    console.error(`[CDP Proxy] port ${PORT} is already in use`);
    process.exit(1);
  }

  server.listen(PORT, "127.0.0.1", () => {
    console.log(`[CDP Proxy] listening on http://127.0.0.1:${PORT}`);
    connect().catch((error) => {
      console.error("[CDP Proxy] initial connect failed:", error.message);
    });
  });
}

process.on("uncaughtException", (error) => {
  console.error("[CDP Proxy] uncaught exception:", error.message);
});
process.on("unhandledRejection", (error) => {
  console.error("[CDP Proxy] unhandled rejection:", error?.message || error);
});

main();

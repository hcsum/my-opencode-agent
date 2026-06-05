export async function createBrowserbaseSession(config) {
  if (!config.browserbaseApiKey) {
    throw new Error('云浏览器凭据未配置，无法创建 Browserbase session');
  }

  const payload = {
    keepAlive: true,
    browserSettings: {},
  };

  if (config.browserbaseProjectId) payload.projectId = config.browserbaseProjectId;
  if (config.browserbaseContextId) {
    payload.browserSettings.context = {
      id: config.browserbaseContextId,
      persist: config.browserbaseContextPersist ?? true,
    };
  }
  if (config.browserbaseUseProxy !== undefined) payload.proxies = config.browserbaseUseProxy;
  if (config.browserbaseSolveCaptcha !== undefined) payload.browserSettings.solveCaptchas = config.browserbaseSolveCaptcha;
  if (config.browserbaseVerified !== undefined) payload.browserSettings.verified = config.browserbaseVerified;
  if (config.browserbaseRegion) payload.region = config.browserbaseRegion;
  if (Number.isFinite(config.browserbaseSessionTimeoutSec) && config.browserbaseSessionTimeoutSec >= 60) {
    payload.timeout = config.browserbaseSessionTimeoutSec;
  }
  if (Object.keys(payload.browserSettings).length === 0) delete payload.browserSettings;

  const response = await fetch(`${config.browserbaseApiBaseUrl}/v1/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-BB-API-Key': config.browserbaseApiKey,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });

  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}

  if (!response.ok || !json?.id || !json?.connectUrl) {
    const detail = json?.error || json?.message || text || 'unknown error';
    throw new Error(`Browserbase session 创建失败: ${detail}`);
  }

  return {
    id: json.id,
    connectUrl: json.connectUrl,
    debugUrl: json.sessionViewerUrl || null,
  };
}

export async function releaseBrowserbaseSession(config, sessionId) {
  if (!sessionId || !config.browserbaseApiKey) {
    return { released: false, skipped: true, sessionId };
  }
  const payload = { status: 'REQUEST_RELEASE' };
  if (config.browserbaseProjectId) payload.projectId = config.browserbaseProjectId;

  const response = await fetch(`${config.browserbaseApiBaseUrl}/v1/sessions/${sessionId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-BB-API-Key': config.browserbaseApiKey,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });

  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}

  if (!response.ok) {
    const detail = json?.error || json?.message || text || `HTTP ${response.status}`;
    throw new Error(`Browserbase session 释放失败: ${detail}`);
  }

  return {
    released: true,
    sessionId,
    statusCode: response.status,
    response: json,
  };
}

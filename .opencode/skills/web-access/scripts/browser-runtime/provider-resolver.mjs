import os from 'node:os';
import path from 'node:path';

const ALLOWED_BROWSER_IDS = new Set(['chrome', 'chrome-canary', 'chromium', 'brave', 'edge', 'arc']);

function defaultDedicatedProfileDir(browserId) {
  return path.join(os.homedir(), '.web-access', `${browserId}-dedicated-profile`);
}

export function resolveProviderFromEnv(env = process.env) {
  const browserbaseApiKey = env.BROWSERBASE_API_KEY?.trim() || '';
  const browserbaseProjectId = env.BROWSERBASE_PROJECT_ID?.trim() || '';
  const browserMode = env.BROWSER_MODE?.trim() || null;
  const browserId = env.BROWSER_ID?.trim() || env.BROWSER_APP?.trim() || null;
  const dedicatedProfileDir = env.DEDICATED_PROFILE_DIR?.trim() || null;

  if (browserbaseApiKey) {
    return {
      provider: 'browserbase',
      browserMode: 'browserbase',
      browserId: null,
      dedicatedProfileDir: null,
      browserbaseApiKey,
      browserbaseProjectId,
      browserbaseContextId: env.BROWSERBASE_CONTEXT_ID?.trim() || '',
      browserbaseContextPersist: parseOptionalBoolean(env.BROWSERBASE_CONTEXT_PERSIST),
      browserbaseUseProxy: parseOptionalBoolean(env.BROWSERBASE_USE_PROXY),
      browserbaseSolveCaptcha: parseOptionalBoolean(env.BROWSERBASE_SOLVE_CAPTCHA),
      browserbaseVerified: parseOptionalBoolean(env.BROWSERBASE_VERIFIED),
      browserbaseRegion: env.BROWSERBASE_REGION?.trim() || null,
      browserbaseSessionTimeoutSec: parseOptionalNumber(env.BROWSERBASE_SESSION_TIMEOUT_SEC),
    };
  }

  const config = {
    provider: 'local',
    browserMode,
    browserId,
    dedicatedProfileDir,
  };

  if (config.browserMode === 'dedicated') {
    if (!config.browserId) {
      throw new Error('Dedicated mode requires BROWSER_ID / BROWSER_APP');
    }
    if (!ALLOWED_BROWSER_IDS.has(config.browserId)) {
      throw new Error(`Invalid browser id: ${config.browserId}`);
    }
    config.dedicatedProfileDir = config.dedicatedProfileDir || defaultDedicatedProfileDir(config.browserId);
  }

  return config;
}

export function parseOptionalBoolean(value) {
  if (value == null || value === '') return undefined;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return undefined;
}

function parseOptionalNumber(value) {
  if (value == null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export { ALLOWED_BROWSER_IDS, defaultDedicatedProfileDir };

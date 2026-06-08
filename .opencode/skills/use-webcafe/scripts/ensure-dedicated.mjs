#!/usr/bin/env node
// Preflight for use-webcafe: guarantee the shared CDP proxy (localhost:3456) is
// pointed at the DEDICATED browser before any Web.Cafe tab work happens.
//
// Why this exists: browse.ts only talks to the proxy at :3456 and has no say in
// which browser that proxy is attached to. If web-access last switched the proxy
// to the user's primary browser, Web.Cafe automation would silently drive the
// user's main browser. This script makes "always dedicated" actually hold by
// (1) launching the dedicated browser if its debug port isn't live, then
// (2) running web-access's check-deps in dedicated mode, which re-points the
// proxy at the dedicated browser (shutting down a primary-pointed proxy).
//
// Browser selection: set WEBCAFE_BROWSER_ID to one of
// chrome | chrome-canary | chromium | brave | edge | arc.
// If unset, auto-detect: use the single existing ~/.web-access/<id>-dedicated-profile,
// preferring brave when several exist.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHECK_DEPS = path.resolve(HERE, '../../web-access/scripts/check-deps.mjs');
const WEB_ACCESS_DIR = path.resolve(HERE, '../../web-access');
const DEDICATED_PORT = '9333';
const READY_TIMEOUT_MS = 30000;
const POLL_MS = 2000;

const APP_NAMES = {
  chrome: 'Google Chrome',
  'chrome-canary': 'Google Chrome Canary',
  chromium: 'Chromium',
  brave: 'Brave Browser',
  edge: 'Microsoft Edge',
  arc: 'Arc',
};

function profileDir(browserId) {
  return path.join(os.homedir(), '.web-access', `${browserId}-dedicated-profile`);
}

function detectBrowserId() {
  const explicit = (process.env.WEBCAFE_BROWSER_ID || '').trim();
  if (explicit) {
    if (!APP_NAMES[explicit]) throw new Error(`Invalid WEBCAFE_BROWSER_ID: ${explicit}`);
    return explicit;
  }
  const base = path.join(os.homedir(), '.web-access');
  let ids = [];
  try {
    ids = fs
      .readdirSync(base)
      .filter((n) => n.endsWith('-dedicated-profile'))
      .map((n) => n.replace(/-dedicated-profile$/, ''))
      .filter((id) => APP_NAMES[id]);
  } catch {}
  if (ids.length === 0) {
    throw new Error(
      'No dedicated browser profile found under ~/.web-access. ' +
        'Set WEBCAFE_BROWSER_ID and launch the dedicated browser once, or run the web-access skill to set one up.',
    );
  }
  if (ids.includes('brave')) return 'brave';
  return ids[0];
}

function runCheckDeps(browserId) {
  const res = spawnSync(
    process.execPath,
    [CHECK_DEPS, '--browser', 'dedicated', '--browser-id', browserId],
    { cwd: WEB_ACCESS_DIR, encoding: 'utf8' },
  );
  try {
    return JSON.parse(res.stdout);
  } catch {
    return { ok: false, _raw: res.stdout, _err: res.stderr };
  }
}

function launchBrowser(browserId) {
  const app = APP_NAMES[browserId];
  spawnSync('open', [
    '-na',
    app,
    '--args',
    `--remote-debugging-port=${DEDICATED_PORT}`,
    `--user-data-dir=${profileDir(browserId)}`,
  ]);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browserId = detectBrowserId();

  // Fast path: already connected and proxy ready on dedicated.
  let state = runCheckDeps(browserId);
  if (state.ok && state.proxyReady) {
    process.stdout.write(JSON.stringify({ ok: true, browserId, launched: false }) + '\n');
    return;
  }

  // Browser debug port not live -> launch the dedicated browser, then poll.
  launchBrowser(browserId);
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    state = runCheckDeps(browserId);
    if (state.ok && state.proxyReady) {
      process.stdout.write(JSON.stringify({ ok: true, browserId, launched: true }) + '\n');
      return;
    }
  }

  process.stdout.write(
    JSON.stringify({
      ok: false,
      browserId,
      reason: state.reason || 'dedicated_not_ready',
      message:
        `Dedicated browser (${APP_NAMES[browserId]}) did not become ready in time. ` +
        'Make sure it can launch with the dedicated profile.',
    }) + '\n',
  );
  process.exit(1);
}

main().catch((err) => {
  process.stdout.write(JSON.stringify({ ok: false, message: String(err?.message || err) }) + '\n');
  process.exit(1);
});

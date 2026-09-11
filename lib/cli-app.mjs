import path from 'node:path';
import os from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadManifest } from './manifest.mjs';
import { fetchCapsData, credsFromEnv } from './capsdata.mjs';
import { pickAppDevices, cachedUpload } from './app.mjs';
import { runPool } from './pool.mjs';
import { formatMatrix } from './report.mjs';

const HUB = 'https://hub-cloud.browserstack.com/wd/hub';
const args = process.argv.slice(2);
const freshIdx = args.indexOf('--fresh');
const fresh = freshIdx >= 0;
if (fresh) args.splice(freshIdx, 1);
const [projectDir, platform] = args;
if (!['ios', 'android'].includes(platform)) { console.error('usage: bs.sh app ios|android [--fresh]'); process.exit(1); }

const creds = credsFromEnv();
const manifest = loadManifest(projectDir);
for (const w of manifest.warnings) console.error(`warning: ${w}`);
const section = manifest.apps[platform];
if (!section) { console.error(`no [app.${platform}] in platforms.toml`); process.exit(1); }

const cacheDir = path.join(os.homedir(), '.cache/browserstack');
const { appDevices } = await fetchCapsData(creds, cacheDir);
const { picked: devices, unmatched } = pickAppDevices(section, appDevices, platform);
for (const name of unmatched) console.error(`warning: declared device "${name}" matches nothing in devices.json for ${platform}`);
if (devices.length === 0) { console.error('no declared device matches the os ranges'); process.exit(2); }

const appUrl = section.app.startsWith('bs://') ? section.app
  : await cachedUpload(path.resolve(projectDir, section.app), creds, path.join(cacheDir, 'apps.json'), { fresh });
console.error(`app: ${appUrl}`);

async function wd(method, p, body) {
  const res = await fetch(`${HUB}${p}`, { method, headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return data.value;
}

const shotsDir = path.join(projectDir, 'browserstack-shots', 'app');
mkdirSync(shotsDir, { recursive: true });

const results = await runPool(devices, 2, async (d) => {
  const label = `${d.device} (${platform} ${d.os_version})`;
  // Caught locally, not left to runPool's generic catch: that catch has no
  // access to `label`, so an uncaught rejection here (auth failure creating
  // the session, network error, timeout) would reach formatMatrix as a
  // labelless result and crash it on r.label.length. Every path out of this
  // function must carry a label (see the identical note in cli-check.mjs).
  try {
    const caps = { capabilities: { alwaysMatch: {
      platformName: platform, 'appium:app': appUrl, 'appium:autoGrantPermissions': true,
      'bstack:options': { deviceName: d.device, osVersion: d.os_version,
        sessionName: `app smoke ${label}`, userName: creds.user, accessKey: creds.key },
    } } };
    const session = await wd('POST', '/session', caps);
    const id = session.sessionId;
    try {
      await new Promise((r) => setTimeout(r, 8000)); // let the app settle after autolaunch
      const png = await wd('GET', `/session/${id}/screenshot`);
      const file = path.join(shotsDir, `${label.replace(/[^\w.-]+/g, '_')}.png`);
      writeFileSync(file, Buffer.from(png, 'base64'));
      return { label, status: 'pass', detail: file };
    } finally {
      await wd('DELETE', `/session/${id}`).catch(() => {});
    }
  } catch (e) {
    return { label, status: 'error', detail: String(e?.message ?? e) };
  }
});
console.log(formatMatrix(results));
if (results.some((r) => r.status !== 'pass')) process.exit(1);

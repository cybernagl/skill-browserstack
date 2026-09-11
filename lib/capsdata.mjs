import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';

const DAY = 24 * 60 * 60 * 1000;

async function cached(file, fetcher) {
  try { if (Date.now() - statSync(file).mtimeMs < DAY) return JSON.parse(readFileSync(file, 'utf8')); } catch {}
  const data = await fetcher();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data));
  return data;
}

async function getJson(url, creds) {
  const res = await fetch(url, { headers: { Authorization: 'Basic ' + Buffer.from(`${creds.user}:${creds.key}`).toString('base64') } });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

export function credsFromEnv() {
  const user = process.env.BROWSERSTACK_USERNAME, key = process.env.BROWSERSTACK_ACCESS_KEY;
  if (!user || !key) throw new Error('bs.sh must export BROWSERSTACK_USERNAME/BROWSERSTACK_ACCESS_KEY');
  return { user, key };
}

export async function fetchCapsData(creds, cacheDir) {
  const [automate, appDevices] = await Promise.all([
    cached(path.join(cacheDir, 'browsers.json'), () => getJson('https://api.browserstack.com/automate/browsers.json', creds)),
    cached(path.join(cacheDir, 'app-devices.json'), () => getJson('https://api-cloud.browserstack.com/app-automate/devices.json', creds)),
  ]);
  return { automate, appDevices };
}

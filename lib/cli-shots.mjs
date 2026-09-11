import path from 'node:path';
import os from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadManifest } from './manifest.mjs';
import { buildMatrix } from './matrix.mjs';
import { fetchCapsData, credsFromEnv } from './capsdata.mjs';
import { pickShotBrowsers } from './shots.mjs';

const BASE = 'https://www.browserstack.com/screenshots';
const [projectDir, ...rest] = process.argv.slice(2);
const outIdx = rest.indexOf('--out');
const outDir = outIdx >= 0 ? rest.splice(outIdx, 2)[1] : 'browserstack-shots';
const creds = credsFromEnv();
const auth = { Authorization: 'Basic ' + Buffer.from(`${creds.user}:${creds.key}`).toString('base64') };

const manifest = loadManifest(projectDir);
const url = rest[0] ?? manifest.web.check.url;
if (!url) { console.error('no URL: pass one or set [web.check].url'); process.exit(1); }

const capsData = await fetchCapsData(creds, path.join(os.homedir(), '.cache/browserstack'));
const { targets } = buildMatrix(manifest, capsData, projectDir);

const list = await fetch(`${BASE}/browsers.json`, { headers: auth });
if (list.status === 403) { console.error('Screenshots API not enabled on this plan (HTTP 403)'); process.exit(3); }
if (list.status === 404) { console.error(`Screenshots API not found (HTTP 404 from ${BASE}/browsers.json)`); process.exit(3); }
if (!list.ok) { console.error(`Screenshots API error: HTTP ${list.status} from ${BASE}/browsers.json`); process.exit(3); }
let shotBrowsers;
try {
  shotBrowsers = await list.json();
} catch (e) {
  console.error(`Screenshots API returned a non-JSON response from ${BASE}/browsers.json: ${e.message}`);
  process.exit(3);
}
const browsers = pickShotBrowsers(targets, shotBrowsers);
if (browsers.length === 0) { console.error('no matrix target maps to a Screenshots browser'); process.exit(2); }

const job = await fetch(BASE, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
  body: JSON.stringify({ url, browsers, wait_time: 5 }) }).then((r) => r.json());
console.log(`job ${job.job_id}: ${browsers.length} screenshot(s)`);

let done;
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 10_000));
  done = await fetch(`${BASE}/${job.job_id}.json`, { headers: auth }).then((r) => r.json());
  if (done.state === 'done') break;
  console.error(`  ${done.state}...`);
}
mkdirSync(outDir, { recursive: true });
for (const s of done.screenshots ?? []) {
  if (s.state !== 'done' || !s.image_url) { console.error(`  skip ${s.browser ?? s.device}: ${s.state}`); continue; }
  const name = `${s.os}-${s.os_version}-${s.browser ?? s.device}-${s.browser_version ?? ''}.png`.replace(/[^\w.-]+/g, '_');
  const buf = Buffer.from(await (await fetch(s.image_url)).arrayBuffer());
  writeFileSync(path.join(outDir, name), buf);
  console.log(`  ${path.join(outDir, name)}`);
}

import path from 'node:path';
import os from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadManifest } from './manifest.mjs';
import { buildMatrix } from './matrix.mjs';
import { fetchCapsData, credsFromEnv } from './capsdata.mjs';
import { pickShotBrowsers, summarizeShots } from './shots.mjs';

const BASE = 'https://www.browserstack.com/screenshots';
const [projectDir, ...rest] = process.argv.slice(2);
const outIdx = rest.indexOf('--out');
const outDir = outIdx >= 0 ? rest.splice(outIdx, 2)[1] : 'browserstack-shots';
const creds = credsFromEnv();
const auth = { Authorization: 'Basic ' + Buffer.from(`${creds.user}:${creds.key}`).toString('base64') };

// failNetwork prints the HTTP status and a body snippet for a failed
// network call, then exits immediately, so a bad response is never chased
// further (e.g. polling `${BASE}/undefined.json` for ten minutes on a
// failed job-creation POST).
async function failNetwork(label, res) {
  const body = await res.text().catch(() => '');
  console.error(`${label} failed: HTTP ${res.status} ${body.slice(0, 300)}`);
  process.exit(1);
}

const manifest = loadManifest(projectDir);
for (const w of manifest.warnings) console.error(`warning: ${w}`);
const url = rest[0] ?? manifest.web.check.url;
if (!url) { console.error('no URL: pass one or set [web.check].url'); process.exit(1); }

const capsData = await fetchCapsData(creds, path.join(os.homedir(), '.cache/browserstack'));
const { targets, gaps } = buildMatrix(manifest, capsData, projectDir);
for (const g of gaps) console.error(`gap: ${g.entry}: ${g.reason}`);

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
const { picked: browsers, unmatched } = pickShotBrowsers(targets, shotBrowsers);
for (const t of unmatched) console.error(`skip: ${t.label}: no Screenshots browser match`);
if (browsers.length === 0) { console.error('no matrix target maps to a Screenshots browser'); process.exit(2); }

const jobRes = await fetch(BASE, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
  body: JSON.stringify({ url, browsers, wait_time: 5 }) });
if (!jobRes.ok) await failNetwork('Screenshots job creation', jobRes);
const job = await jobRes.json();
console.log(`job ${job.job_id}: ${browsers.length} screenshot(s)`);

let done;
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 10_000));
  const pollRes = await fetch(`${BASE}/${job.job_id}.json`, { headers: auth });
  if (!pollRes.ok) await failNetwork('Screenshots job poll', pollRes);
  done = await pollRes.json();
  if (done.state === 'done') break;
  console.error(`  ${done.state}...`);
}

mkdirSync(outDir, { recursive: true });
const summary = summarizeShots(done?.screenshots);
let written = 0;
for (const s of summary) {
  if (!s.ok) { console.error(`  skip ${s.label}: ${s.state}`); continue; }
  const buf = Buffer.from(await (await fetch(s.image_url)).arrayBuffer());
  writeFileSync(path.join(outDir, s.name), buf);
  console.log(`  ${path.join(outDir, s.name)}`);
  written++;
}
if (written === 0) { console.error('0 screenshots written'); process.exit(1); }

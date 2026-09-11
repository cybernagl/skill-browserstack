import path from 'node:path';
import os from 'node:os';
import { loadManifest } from './manifest.mjs';
import { buildMatrix } from './matrix.mjs';
import { fetchCapsData, credsFromEnv } from './capsdata.mjs';
import { playwrightWss, webdriverPayload } from './caps.mjs';
import { smokePlaywright, smokeWebdriver, runScriptTarget } from './drivers.mjs';
import { runPool } from './pool.mjs';
import { formatMatrix } from './report.mjs';

const args = process.argv.slice(2);
const projectDir = args.shift();
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 1)[0] : null; };
const flagVal = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : null; };
const local = Boolean(flag('--local'));
const parallel = parseInt(flagVal('--parallel') ?? '2', 10);
const urlOverride = flagVal('--url');
const script = args[0] ?? null;

const creds = credsFromEnv();
const manifest = loadManifest(projectDir);
const url = urlOverride ?? manifest.web.check.url;
if (!url) { console.error('no target URL: set [web.check].url or pass --url'); process.exit(1); }
const useLocal = local || manifest.web.check.local || /localhost|127\.0\.0\.1/.test(url);
if (useLocal && !process.env.BS_TUNNEL_READY) process.exit(3);
const localIdentifier = process.env.BS_TUNNEL_ID ?? path.basename(projectDir);

const capsData = await fetchCapsData(creds, path.join(os.homedir(), '.cache/browserstack'));
const { targets, gaps } = buildMatrix(manifest, capsData, projectDir);
for (const g of gaps) console.error(`gap: ${g.entry}: ${g.reason}`);
if (targets.length === 0) { console.error('no runnable targets'); process.exit(2); }

const build = `check ${path.basename(projectDir)} ${new Date().toISOString().slice(0, 10)}`;
const results = await runPool(targets, parallel, async (t) => {
  // Caught locally, not left to runPool's generic catch: that catch has no
  // access to t.label, so an uncaught rejection here (auth failure, network
  // error, timeout) would reach formatMatrix as a labelless result and crash
  // it on r.label.length. Every path out of this function must carry a label.
  try {
    const opts = { name: t.label, build, local: useLocal, localIdentifier };
    const endpoint = t.driver === 'playwright' ? playwrightWss(t, creds, opts) : null;
    const payload = t.driver === 'webdriver' ? webdriverPayload(t, creds, opts) : null;
    const r = script
      ? await runScriptTarget(t, endpoint, url, script, payload)
      : t.driver === 'playwright'
        ? await smokePlaywright(t, endpoint, url)
        : await smokeWebdriver(t, payload, url);
    return { label: t.label, ...r };
  } catch (e) {
    return { label: t.label, status: 'error', detail: String(e?.message ?? e) };
  }
});

console.log(formatMatrix(results));
if (results.some((r) => r.status !== 'pass')) process.exit(1);

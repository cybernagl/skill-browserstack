import { loadManifest } from './manifest.mjs';
import { buildMatrix } from './matrix.mjs';
import { fetchCapsData, credsFromEnv } from './capsdata.mjs';
import path from 'node:path';
import os from 'node:os';

const projectDir = process.argv[2];
const json = process.argv.includes('--json');
const manifest = loadManifest(projectDir);
const capsData = await fetchCapsData(credsFromEnv(), path.join(os.homedir(), '.cache/browserstack'));
const { targets, gaps } = buildMatrix(manifest, capsData, projectDir);

if (json) {
  console.log(JSON.stringify({ targets, gaps, manifest }, null, 2));
} else {
  for (const w of manifest.warnings) console.error(`warning: ${w}`);
  console.log(`${targets.length} target(s):`);
  for (const t of targets) console.log(`  [${t.driver === 'playwright' ? 'pw' : 'wd'}] ${t.label}`);
  if (gaps.length) {
    console.log(`${gaps.length} gap(s):`);
    for (const g of gaps) console.log(`  ! ${g.entry}: ${g.reason}`);
    process.exitCode = 2;
  }
}

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export function parseOsRange(spec) {
  const m = String(spec).trim().match(/^(>=|<=|>|<|==)?\s*([\d.]+)$/);
  if (!m) throw new Error(`bad os range: ${spec}`);
  const [, op = '==', num] = m;
  const want = parseFloat(num);
  return (v) => {
    const got = parseFloat(v);
    return op === '>=' ? got >= want : op === '<=' ? got <= want
      : op === '>' ? got > want : op === '<' ? got < want : Math.floor(got) === Math.floor(want);
  };
}

export function pickAppDevices(section, appDevices, platform) {
  const ranges = section.os.length ? section.os.map(parseOsRange) : [() => true];
  const picked = [];
  for (const name of section.devices) {
    const rows = appDevices.filter((d) => d.device === name && d.os === platform
      && ranges.some((ok) => ok(d.os_version)));
    for (const r of rows) picked.push({ device: r.device, os_version: r.os_version });
  }
  return picked;
}

export async function cachedUpload(filePath, creds, cacheFile) {
  const hash = createHash('sha256').update(readFileSync(filePath)).digest('hex');
  let cache = {};
  try { cache = JSON.parse(readFileSync(cacheFile, 'utf8')); } catch {}
  if (cache[hash]) return cache[hash];
  const form = new FormData();
  form.append('file', new Blob([readFileSync(filePath)]), path.basename(filePath));
  const res = await fetch('https://api-cloud.browserstack.com/app-automate/upload', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${creds.user}:${creds.key}`).toString('base64') },
    body: form,
  });
  const data = await res.json();
  if (!res.ok || !data.app_url) throw new Error(`upload failed: HTTP ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
  cache[hash] = data.app_url;
  mkdirSync(path.dirname(cacheFile), { recursive: true });
  writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
  return data.app_url;
}

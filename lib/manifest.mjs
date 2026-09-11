import { parse } from 'smol-toml';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const KNOWN = {
  web: ['browserslist', 'devices', 'os', 'check'],
  'web.check': ['url', 'local'],
  app: ['app', 'devices', 'os'],
};

function warnUnknown(obj, allowed, prefix, warnings) {
  for (const k of Object.keys(obj ?? {})) {
    if (!allowed.includes(k)) warnings.push(`ignoring unknown key ${prefix}${k}`);
  }
}

export function loadManifest(projectDir) {
  const file = path.join(projectDir, 'platforms.toml');
  let raw;
  try {
    raw = parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`cannot read ${file}: ${e.message}`, { cause: e });
  }
  const warnings = [];
  warnUnknown(raw, ['web', 'app'], '', warnings);
  warnUnknown(raw.web, KNOWN.web, 'web.', warnings);
  warnUnknown(raw.web?.check, KNOWN['web.check'], 'web.check.', warnings);

  const bl = raw.web?.browserslist ?? 'project';
  const web = {
    browserslist: bl === 'project' ? null : [].concat(bl),
    devices: raw.web?.devices ?? [],
    os: raw.web?.os ?? [],
    check: { url: raw.web?.check?.url ?? null, local: raw.web?.check?.local ?? false },
  };

  const apps = {};
  for (const platform of ['ios', 'android']) {
    const sec = raw.app?.[platform];
    if (!sec) continue;
    warnUnknown(sec, KNOWN.app, `app.${platform}.`, warnings);
    if (!sec.app) throw new Error(`app.${platform}.app is required`);
    apps[platform] = { app: sec.app, devices: sec.devices ?? [], os: sec.os ?? [] };
  }
  return { web, apps, warnings };
}

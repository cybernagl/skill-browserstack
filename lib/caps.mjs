import { createRequire } from 'node:module';
export const PW_VERSION = createRequire(import.meta.url)('playwright-core/package.json').version;

export function playwrightWss(t, creds, opts) {
  const caps = {
    browser: t.kind === 'desktop' ? t.browser : (t.kind === 'ios' ? 'safari' : 'chrome'),
    ...(t.browser_version ? { browser_version: t.browser_version } : {}),
    os: t.os, os_version: t.os_version,
    ...(t.device ? { device: t.device, realMobile: 'true' } : {}),
    name: opts.name, build: opts.build,
    'browserstack.username': creds.user,
    'browserstack.accessKey': creds.key,
    'client.playwrightVersion': PW_VERSION,
    ...(opts.local ? { 'browserstack.local': 'true', 'browserstack.localIdentifier': opts.localIdentifier } : {}),
  };
  return `wss://cdp.browserstack.com/playwright?caps=${encodeURIComponent(JSON.stringify(caps))}`;
}

export function webdriverPayload(t, creds, opts) {
  return { capabilities: { alwaysMatch: {
    browserName: t.browser,
    ...(t.browser_version ? { browserVersion: t.browser_version } : {}),
    'bstack:options': {
      os: t.os, osVersion: t.os_version,
      ...(t.device ? { deviceName: t.device, realMobile: true } : {}),
      sessionName: opts.name, buildName: opts.build,
      userName: creds.user, accessKey: creds.key,
      ...(opts.local ? { local: true, localIdentifier: opts.localIdentifier } : {}),
    },
  } } };
}

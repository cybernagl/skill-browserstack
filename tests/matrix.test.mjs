import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildMatrix } from '../lib/matrix.mjs';
import { resolveQueries, mapEntries } from '../lib/families.mjs';

const automate = JSON.parse(readFileSync(new URL('./fixtures/browsers.json', import.meta.url)));
const appDevices = JSON.parse(readFileSync(new URL('./fixtures/app-devices.json', import.meta.url)));
const capsData = { automate, appDevices };

const manifest = (over = {}) => ({
  web: { browserslist: ['chrome 128', 'safari 16.6', 'ios_saf 17.5'],
         devices: ['iPhone 15'], os: [], check: { url: null, local: false }, ...over },
  apps: {}, warnings: [],
});

test('desktop targets resolve against availability', () => {
  const { targets } = buildMatrix(manifest(), capsData);
  const chrome = targets.find((t) => t.browser === 'chrome');
  assert.deepEqual(chrome, { label: 'chrome 128 on Windows 11', driver: 'playwright', kind: 'desktop',
    browser: 'chrome', browser_version: '128.0', os: 'Windows', os_version: '11' });
  const safari = targets.find((t) => t.browser === 'safari');
  assert.equal(safari.os_version, 'Ventura');
  assert.equal(safari.driver, 'webdriver');
});

test('ios versions bind to declared devices', () => {
  const { targets } = buildMatrix(manifest(), capsData);
  const ios = targets.find((t) => t.kind === 'ios');
  assert.equal(ios.device, 'iPhone 15');
  assert.equal(ios.os_version, '17');
  // A chromium CDP client cannot drive iOS Safari: the WebDriver tail is
  // the generic path, so ios web targets route through it. Android stays
  // playwright (Chrome on Android is chromium).
  assert.equal(ios.driver, 'webdriver');
});

test('android versions still route through playwright', () => {
  // and_chr has only one live major in caniuse-lite at a time, so derive it
  // here instead of hardcoding a version that will go stale.
  const androidMajor = mapEntries(resolveQueries(['and_chr 128'], process.cwd())).android[0];
  const localCapsData = { automate: [...automate,
    { os: 'android', os_version: `${androidMajor}.0`, browser: 'android', browser_version: null,
      device: 'Samsung Galaxy S24', real_mobile: true }],
    appDevices };
  const { targets } = buildMatrix(
    manifest({ browserslist: ['chrome 128', 'and_chr 128'], devices: ['iPhone 15', 'Samsung Galaxy S24'] }),
    localCapsData,
  );
  const android = targets.find((t) => t.kind === 'android');
  assert.ok(android, 'expected an android target to resolve');
  assert.equal(android.driver, 'playwright');
});

test('unavailable version is a gap, not a silent drop', () => {
  const { targets, gaps } = buildMatrix(manifest({ browserslist: ['chrome 42'] }), capsData);
  assert.equal(targets.length, 0);
  assert.match(gaps[0].reason, /not available/);
});

test('mobile family without declared device is a gap', () => {
  const { gaps } = buildMatrix(manifest({ devices: [] }), capsData);
  assert.ok(gaps.some((g) => g.reason.includes('declare a device')));
});

test('declared device unused by any mobile browserslist family is a gap', () => {
  const { gaps } = buildMatrix(
    manifest({ browserslist: ['safari 16.6', 'firefox 130'], devices: ['Samsung Galaxy S24'] }),
    capsData,
  );
  assert.ok(gaps.some((g) => g.entry === 'device Samsung Galaxy S24'
    && /no mobile browserslist family/.test(g.reason)));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildMatrix } from '../lib/matrix.mjs';

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
  assert.equal(ios.driver, 'playwright');
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

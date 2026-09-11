import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveQueries, mapEntries } from '../lib/families.mjs';

test('explicit queries resolve to entries', () => {
  const entries = resolveQueries(['chrome 128', 'safari 16.6'], process.cwd());
  assert.ok(entries.includes('chrome 128'));
  assert.ok(entries.some((e) => e.startsWith('safari 16.6')));
});

test('null queries read project config', () => {
  const dir = new URL('./fixtures/inherit/', import.meta.url).pathname;
  assert.deepEqual(resolveQueries(null, dir), ['chrome 128']);
});

test('chrome maps to playwright, firefox and safari to webdriver', () => {
  const m = mapEntries(['chrome 128', 'firefox 130', 'safari 16.6', 'edge 128']);
  assert.deepEqual(m.desktop.find((d) => d.family === 'chrome'),
    { family: 'chrome', browser: 'chrome', major: 128, driver: 'playwright' });
  assert.equal(m.desktop.find((d) => d.family === 'firefox').driver, 'webdriver');
  assert.equal(m.desktop.find((d) => d.family === 'safari').driver, 'webdriver');
  assert.equal(m.desktop.find((d) => d.family === 'edge').driver, 'playwright');
});

test('old chrome falls back to webdriver', () => {
  const m = mapEntries(['chrome 80']);
  assert.equal(m.desktop[0].driver, 'webdriver');
});

test('mobile families collect majors, ranges take the max', () => {
  const m = mapEntries(['ios_saf 17.0-17.4', 'ios_saf 16.6', 'and_chr 128', 'samsung 25']);
  assert.deepEqual(m.ios, [17, 16]);
  assert.deepEqual(m.android, [128, 25]);
});

test('unsupported families land in unresolved with a reason', () => {
  const m = mapEntries(['op_mini all', 'kaios 3.0-3.1']);
  assert.equal(m.unresolved.length, 2);
  assert.match(m.unresolved[0].reason, /not available/);
});

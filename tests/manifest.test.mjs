import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadManifest } from '../lib/manifest.mjs';

const fix = (name) => new URL(`./fixtures/${name}/`, import.meta.url).pathname;

test('full manifest parses', () => {
  const m = loadManifest(fix('full'));
  assert.deepEqual(m.web.browserslist, ['chrome 128', 'safari 16.6']);
  assert.deepEqual(m.web.devices, ['iPhone 15']);
  assert.equal(m.web.check.url, 'https://example.com');
  assert.equal(m.web.check.local, false);
  assert.equal(m.apps.android.app, 'dist/app.apk');
  assert.deepEqual(m.apps.android.os, ['>= 13']);
  assert.equal(m.apps.ios, undefined);
});

test('unknown keys warn but do not fail', () => {
  const m = loadManifest(fix('full'));
  assert.ok(m.warnings.some((w) => w.includes('future_key')));
});

test('"project" yields null queries', () => {
  const m = loadManifest(fix('inherit'));
  assert.equal(m.web.browserslist, null);
});

test('missing file throws with path', () => {
  assert.throws(() => loadManifest('/nonexistent'), /platforms\.toml/);
});

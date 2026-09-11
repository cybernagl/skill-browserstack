import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScriptTarget } from '../lib/drivers.mjs';

test('script gets the target env contract', async () => {
  const target = { label: 'chrome 128 on Windows 11', driver: 'playwright' };
  const r = await runScriptTarget(target, 'wss://example/pw', 'https://example.com',
    new URL('./fixtures/echo-env.mjs', import.meta.url).pathname);
  assert.equal(r.status, 'pass');
  const env = JSON.parse(r.detail);
  assert.equal(JSON.parse(env.BS_TARGET).label, target.label);
  assert.equal(env.BS_WSS_URL, 'wss://example/pw');
  assert.equal(env.BS_CHECK_URL, 'https://example.com');
});

test('script gets the webdriver env contract', async () => {
  const target = { label: 'safari 16.6 on OS X Ventura', driver: 'webdriver' };
  const payload = { capabilities: { alwaysMatch: { browserName: 'safari' } } };
  const r = await runScriptTarget(target, null, 'https://example.com',
    new URL('./fixtures/echo-env.mjs', import.meta.url).pathname, payload);
  assert.equal(r.status, 'pass');
  const env = JSON.parse(r.detail);
  assert.equal(JSON.parse(env.BS_TARGET).label, target.label);
  assert.equal(env.BS_WEBDRIVER_URL, 'https://hub-cloud.browserstack.com/wd/hub');
  assert.deepEqual(JSON.parse(env.BS_WD_PAYLOAD), payload);
  assert.equal(env.BS_CHECK_URL, 'https://example.com');
});

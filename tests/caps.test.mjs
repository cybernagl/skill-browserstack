import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playwrightWss, webdriverPayload, PW_VERSION } from '../lib/caps.mjs';

const creds = { user: 'u', key: 'k' };
const desktop = { label: 'chrome 128 on Windows 11', driver: 'playwright', kind: 'desktop',
  browser: 'chrome', browser_version: '128.0', os: 'Windows', os_version: '11' };

test('playwright wss embeds caps', () => {
  const wss = playwrightWss(desktop, creds, { name: 'n', build: 'b', local: false });
  assert.ok(wss.startsWith('wss://cdp.browserstack.com/playwright?caps='));
  const caps = JSON.parse(decodeURIComponent(wss.split('caps=')[1]));
  assert.equal(caps.browser, 'chrome');
  assert.equal(caps['browserstack.username'], 'u');
  assert.equal(caps['client.playwrightVersion'], PW_VERSION);
  assert.equal(caps['browserstack.local'], undefined);
});

test('webdriver payload uses bstack:options', () => {
  const p = webdriverPayload({ ...desktop, browser: 'safari', browser_version: '16.6', os: 'OS X', os_version: 'Ventura' },
    creds, { name: 'n', build: 'b', local: true, localIdentifier: 'id1' });
  const am = p.capabilities.alwaysMatch;
  assert.equal(am.browserName, 'safari');
  assert.equal(am['bstack:options'].osVersion, 'Ventura');
  assert.equal(am['bstack:options'].local, true);
  assert.equal(am['bstack:options'].localIdentifier, 'id1');
  assert.equal(am['bstack:options'].userName, 'u');
});

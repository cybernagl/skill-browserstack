import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickShotBrowsers } from '../lib/shots.mjs';

const shotBrowsers = [
  { os: 'Windows', os_version: '11', browser: 'chrome', browser_version: '128.0', device: null },
  { os: 'OS X', os_version: 'Ventura', browser: 'safari', browser_version: '16.6', device: null },
  { os: 'ios', os_version: '17', browser: 'Mobile Safari', browser_version: null, device: 'iPhone 15' },
];

test('targets map to screenshot descriptors by browser+major+os', () => {
  const targets = [
    { kind: 'desktop', browser: 'chrome', browser_version: '128.0', os: 'Windows', os_version: '11' },
    { kind: 'ios', device: 'iPhone 15', os: 'ios', os_version: '17' },
  ];
  const picked = pickShotBrowsers(targets, shotBrowsers);
  assert.equal(picked.length, 2);
  assert.equal(picked[0].browser, 'chrome');
  assert.equal(picked[1].device, 'iPhone 15');
});

test('unmatchable targets are dropped with a note', () => {
  const targets = [{ kind: 'desktop', browser: 'chrome', browser_version: '42.0', os: 'Windows', os_version: '11' }];
  const picked = pickShotBrowsers(targets, shotBrowsers);
  assert.equal(picked.length, 0);
});

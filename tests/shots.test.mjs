import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickShotBrowsers, summarizeShots } from '../lib/shots.mjs';

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

test('summarizeShots marks done screenshots with an image as ok, and names them', () => {
  const screenshots = [
    { os: 'Windows', os_version: '11', browser: 'chrome', browser_version: '128.0', state: 'done', image_url: 'https://x/1.png' },
  ];
  const summary = summarizeShots(screenshots);
  assert.equal(summary.length, 1);
  assert.equal(summary[0].ok, true);
  assert.equal(summary[0].name, 'Windows-11-chrome-128.0.png');
  assert.equal(summary.filter((s) => s.ok).length, 1);
});

test('summarizeShots marks a timed-out or errored entry as not ok, so a zero-yield job is detectable', () => {
  const screenshots = [
    { os: 'OS X', os_version: 'Ventura', browser: 'safari', browser_version: '16.5', state: 'timed-out', image_url: null },
    { os: 'Windows', os_version: '11', browser: 'chrome', browser_version: '128.0', state: 'error', image_url: null },
  ];
  const summary = summarizeShots(screenshots);
  assert.equal(summary.every((s) => s.ok === false), true);
  assert.equal(summary.filter((s) => s.ok).length, 0);
});

test('summarizeShots handles an empty or missing screenshots array', () => {
  assert.deepEqual(summarizeShots([]), []);
  assert.deepEqual(summarizeShots(undefined), []);
});

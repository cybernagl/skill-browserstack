import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMatrix } from '../lib/report.mjs';

test('matrix lines up and summarizes', () => {
  const s = formatMatrix([
    { label: 'chrome 128 on Windows 11', status: 'pass', detail: '' },
    { label: 'safari 16.6 on OS X Ventura', status: 'fail', detail: 'console errors: 2' },
  ]);
  assert.match(s, /PASS +chrome 128 on Windows 11/);
  assert.match(s, /FAIL +safari 16.6 on OS X Ventura +console errors: 2/);
  assert.match(s, /1\/2 passed/);
});

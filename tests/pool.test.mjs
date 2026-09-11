import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPool } from '../lib/pool.mjs';

test('bounded concurrency, order preserved', async () => {
  let live = 0, peak = 0;
  const items = [...Array(6).keys()];
  const out = await runPool(items, 2, async (i) => {
    live++; peak = Math.max(peak, live);
    await new Promise((r) => setTimeout(r, 10));
    live--; return i * 2;
  });
  assert.deepEqual(out, [0, 2, 4, 6, 8, 10]);
  assert.ok(peak <= 2);
});

test('a rejection becomes an error result, not a crash', async () => {
  const out = await runPool([1], 1, async () => { throw new Error('boom'); });
  assert.equal(out[0].status, 'error');
  assert.match(out[0].detail, /boom/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePositiveInt } from '../lib/cli-util.mjs';

test('parsePositiveInt accepts positive integers, trimming whitespace', () => {
  assert.equal(parsePositiveInt('1'), 1);
  assert.equal(parsePositiveInt('12'), 12);
  assert.equal(parsePositiveInt(' 4 '), 4);
});

test('parsePositiveInt rejects zero, negatives, non-integers, and garbage', () => {
  assert.equal(parsePositiveInt('0'), null);
  assert.equal(parsePositiveInt('-1'), null);
  assert.equal(parsePositiveInt('1.5'), null);
  assert.equal(parsePositiveInt('abc'), null);
  assert.equal(parsePositiveInt(''), null);
  assert.equal(parsePositiveInt('NaN'), null);
  assert.equal(parsePositiveInt('2, 3'), null);
});

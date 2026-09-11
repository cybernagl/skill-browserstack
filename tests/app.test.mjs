import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOsRange, pickAppDevices } from '../lib/app.mjs';

test('os ranges parse', () => {
  assert.ok(parseOsRange('>= 13')('13.0'));
  assert.ok(parseOsRange('>= 13')('14.0'));
  assert.ok(!parseOsRange('>= 13')('12.0'));
  assert.ok(parseOsRange('< 17')('16.6'));
  assert.ok(parseOsRange('17')('17.0'));
});

test('devices intersect with declared os ranges', () => {
  const appDevices = [
    { device: 'Samsung Galaxy S23', os: 'android', os_version: '13.0' },
    { device: 'Samsung Galaxy S23', os: 'android', os_version: '12.0' },
    { device: 'iPhone 15', os: 'ios', os_version: '17' },
  ];
  const picked = pickAppDevices({ app: 'x.apk', devices: ['Samsung Galaxy S23'], os: ['>= 13'] }, appDevices, 'android');
  assert.deepEqual(picked, [{ device: 'Samsung Galaxy S23', os_version: '13.0' }]);
});

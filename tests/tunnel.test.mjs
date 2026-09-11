import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BS = new URL('../bs.sh', import.meta.url).pathname;

function run(args, env = {}) {
  try {
    return { out: execFileSync(BS, args, { env: { ...process.env, ...env }, encoding: 'utf8' }), code: 0 };
  } catch (e) {
    return { out: `${e.stdout ?? ''}${e.stderr ?? ''}`, code: e.status };
  }
}

test('tunnel status reports not running', () => {
  const r = run(['tunnel', 'status', '--id', 'no-such-tunnel-xyz'],
    { BROWSERSTACK_USERNAME: 'u', BROWSERSTACK_ACCESS_KEY: 'k' });
  assert.equal(r.code, 0);
  assert.match(r.out, /not running/);
});

test('--id with no value dies with usage, not an unbound-variable crash', () => {
  const r = run(['tunnel', 'start', '--id'],
    { BROWSERSTACK_USERNAME: 'u', BROWSERSTACK_ACCESS_KEY: 'k' });
  assert.equal(r.code, 1);
  assert.match(r.out, /--id/);
  assert.doesNotMatch(r.out, /unbound variable/);
});

test('tunnel start without cached binary explains the download', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'bs-'));
  // fake HOME so no binary is cached; BS_TUNNEL_NO_DOWNLOAD makes this testable offline
  const r = run(['tunnel', 'start', '--id', 't1'],
    { HOME: home, BROWSERSTACK_USERNAME: 'u', BROWSERSTACK_ACCESS_KEY: 'k', BS_TUNNEL_NO_DOWNLOAD: '1' });
  assert.equal(r.code, 1);
  assert.match(r.out, /BrowserStackLocal/);
});

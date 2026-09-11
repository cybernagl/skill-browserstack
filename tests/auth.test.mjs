import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BS = new URL('../bs.sh', import.meta.url).pathname;

function run(env, args = ['auth-source']) {
  try {
    return { out: execFileSync(BS, args, { env: { ...process.env, ...env }, encoding: 'utf8' }), code: 0 };
  } catch (e) {
    return { out: `${e.stdout ?? ''}${e.stderr ?? ''}`, code: e.status };
  }
}

test('env credentials win', () => {
  const r = run({ BROWSERSTACK_USERNAME: 'u', BROWSERSTACK_ACCESS_KEY: 'k' });
  assert.equal(r.code, 0);
  assert.match(r.out, /^env$/m);
});

test('credentials file is the fallback', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'bs-'));
  mkdirSync(path.join(home, '.config/browserstack'), { recursive: true });
  writeFileSync(path.join(home, '.config/browserstack/credentials'), 'username=u\naccess_key=k\n');
  const r = run({ HOME: home, BROWSERSTACK_USERNAME: '', BROWSERSTACK_ACCESS_KEY: '' });
  assert.equal(r.code, 0);
  assert.match(r.out, /^file$/m);
});

test('no credentials is a clear error', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'bs-'));
  const r = run({ HOME: home, BROWSERSTACK_USERNAME: '', BROWSERSTACK_ACCESS_KEY: '' });
  assert.equal(r.code, 1);
  assert.match(r.out, /BROWSERSTACK_USERNAME/);
});

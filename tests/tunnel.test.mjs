import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, existsSync, statSync } from 'node:fs';
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

// A fake HOME with a stub BrowserStackLocal at the exact cache path
// tunnel_ensure looks for, so no live binary or network is needed.
function fakeHomeWithStub(script) {
  const home = mkdtempSync(path.join(tmpdir(), 'bs-'));
  const cacheDir = path.join(home, '.cache/browserstack');
  mkdirSync(cacheDir, { recursive: true });
  const stub = path.join(cacheDir, 'BrowserStackLocal');
  writeFileSync(stub, `#!/bin/sh
${script}
`);
  chmodSync(stub, 0o755);
  return { home, cacheDir };
}

test('a crashing tunnel binary does not leave the key config file behind', () => {
  const { home, cacheDir } = fakeHomeWithStub('exit 1');
  const r = run(['tunnel', 'start', '--id', 'crashtest'],
    { HOME: home, BROWSERSTACK_USERNAME: 'u', BROWSERSTACK_ACCESS_KEY: 'k' });
  assert.equal(r.code, 1);
  assert.equal(existsSync(path.join(cacheDir, 'local-crashtest.yml')), false);
});

test('a successful tunnel start also leaves no key config file behind, and cache artifacts are owner-only', () => {
  const { home, cacheDir } = fakeHomeWithStub('echo \'{"state":"connected","pid":1}\'');
  const r = run(['tunnel', 'start', '--id', 'oktest'],
    { HOME: home, BROWSERSTACK_USERNAME: 'u', BROWSERSTACK_ACCESS_KEY: 'k' });
  assert.equal(r.code, 0);
  assert.equal(existsSync(path.join(cacheDir, 'local-oktest.yml')), false);
  const outFile = path.join(cacheDir, 'tunnel-start-oktest.json');
  assert.equal(existsSync(outFile), true);
  assert.equal(statSync(outFile).mode & 0o777, 0o600);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const CLI = new URL('../lib/cli-check.mjs', import.meta.url).pathname;

function run(args) {
  try {
    return { out: execFileSync(process.execPath, [CLI, '/nonexistent-project', ...args], { encoding: 'utf8' }), code: 0 };
  } catch (e) {
    return { out: `${e.stdout ?? ''}${e.stderr ?? ''}`, code: e.status };
  }
}

// A bad --parallel must die before any target logic runs: no credentials
// and no platforms.toml are needed to reach this failure, since runPool
// with n=0/NaN leaves a sparse results array whose holes make `.some()`
// return false, so 0 targets ran yet exit was 0. Guard first.
test('--parallel 0 dies with a clear message before touching creds or the manifest', () => {
  const r = run(['--parallel', '0']);
  assert.equal(r.code, 1);
  assert.match(r.out, /--parallel/);
  assert.doesNotMatch(r.out, /BROWSERSTACK_USERNAME/);
});

test('--parallel not-a-number dies with a clear message', () => {
  const r = run(['--parallel', 'nope']);
  assert.equal(r.code, 1);
  assert.match(r.out, /--parallel/);
});

test('--parallel -1 dies with a clear message', () => {
  const r = run(['--parallel', '-1']);
  assert.equal(r.code, 1);
  assert.match(r.out, /--parallel/);
});

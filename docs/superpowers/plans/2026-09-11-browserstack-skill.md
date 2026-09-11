# BrowserStack Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A global Claude Code skill that checks apps and websites on the browsers, versions, and real devices each project declares in a `platforms.toml` manifest, using BrowserStack Automate, App Automate, Screenshots, and Local Testing.

**Architecture:** `bs.sh` is the single entry point (credentials, REST helper, tunnel, dispatch). Node ESM modules in `lib/` do everything needing parsing or orchestration: manifest loading, Browserslist resolution, capability bucketing, the check runner, screenshots, app smoke. Pure functions are separated from CLI wrappers so unit tests never touch the network; every task also carries a live smoke against the real account.

**Tech Stack:** bash + curl + jq; Node 24 ESM with `node --test` (no test framework); pinned deps `smol-toml`, `browserslist`, `caniuse-lite`, `playwright-core`.

**Spec:** `docs/superpowers/specs/2026-09-11-browserstack-skill-design.md`

## Global Constraints

- Repo root is `/Users/martin/dev/skill-browserstack`; all paths below are relative to it. Git is initialized with the spec committed
- Node >= 24, `"type": "module"`, tests run with `npm test` (`node --test tests/`)
- Dependencies pinned exact in `package.json`; `package-lock.json` committed; `node_modules/` gitignored; `bs.sh` runs `npm ci` automatically when `node_modules` is missing
- Endpoints: Automate REST `https://api.browserstack.com/automate` (basic auth user:key); Playwright `wss://cdp.browserstack.com/playwright?caps=<urlencoded JSON>`; WebDriver hub `https://hub-cloud.browserstack.com/wd/hub`; App Automate `https://api-cloud.browserstack.com/app-automate`; Screenshots `https://www.browserstack.com/screenshots`; Local binary `https://www.browserstack.com/browserstack-local/BrowserStackLocal-<os>-<arch>.zip`
- Cache directory `~/.cache/browserstack/` for the tunnel binary, capability lists (24 h), and `apps.json` upload cache
- Secrets: username and access key are never printed, logged, or committed; they reach child processes through the environment only
- Live smokes run on Martin's paid account: keep sessions short, always release them, prefer `example.com` or `whoslive.today` as targets
- Docs style (SKILL.md, README, reference files): no em-dashes anywhere; headings short, MLA title case; bullets use colon lead-ins, no bold lead-ins, no trailing periods on list items; Simplified Technical English
- Commit messages: imperative summary, no Claude session links
- If a documented BrowserStack endpoint or capability name turns out different in a live smoke, fix the constant, note it in the task's commit message, and continue

---

### Task 1: Scaffold, Credentials, Auth Check

**Files:**
- Create: `.editorconfig`, `.gitignore`, `LICENSE`, `README.md` (stub), `bs.sh`
- Test: `tests/auth.test.mjs`

**Interfaces:**
- Consumes: nothing
- Produces: `bs.sh` with `creds()` setting `BS_USER`, `BS_KEY`, `BS_AUTH_SOURCE`; `api()` for authenticated REST; subcommands `auth-source`, `auth-check`; later tasks add subcommands to its dispatch `case`

- [ ] **Step 1: Boilerplate files**

`.editorconfig`, `.gitignore`, `LICENSE` copied from `/Users/martin/dev/skill-browserbase` (same content; MIT, Martin Silbernagl, 2026). Append to `.gitignore`:

```
node_modules/
*.tgz
```

`README.md` stub:

```markdown
# skill-browserstack

A Claude Code skill that checks apps and websites on the browsers and
real devices each project declares in a `platforms.toml` manifest,
via BrowserStack. Work in progress; see docs/superpowers/specs/.
```

Rename the branch: `git branch -m main`

- [ ] **Step 2: Write the failing test**

`tests/auth.test.mjs`:

```js
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test tests/` (from repo root). Expected: 3 failures (bs.sh missing).

- [ ] **Step 4: Write bs.sh**

```bash
#!/usr/bin/env bash
# bs.sh - BrowserStack helper. Dependencies: curl, jq, node.
set -euo pipefail

SKILL_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
API="https://api.browserstack.com/automate"
CACHE="$HOME/.cache/browserstack"

die() { echo "bs: $*" >&2; exit 1; }

creds() {
  if [[ -n "${BROWSERSTACK_USERNAME:-}" && -n "${BROWSERSTACK_ACCESS_KEY:-}" ]]; then
    BS_USER=$BROWSERSTACK_USERNAME BS_KEY=$BROWSERSTACK_ACCESS_KEY BS_AUTH_SOURCE=env
    return
  fi
  local f="$HOME/.config/browserstack/credentials"
  if [[ -f $f ]]; then
    BS_USER=$(sed -n 's/^username=//p' "$f")
    BS_KEY=$(sed -n 's/^access_key=//p' "$f")
    BS_AUTH_SOURCE=file
    [[ -n $BS_USER && -n $BS_KEY ]] && return
  fi
  die "no credentials: set BROWSERSTACK_USERNAME and BROWSERSTACK_ACCESS_KEY, or write $f (lines: username=..., access_key=..., chmod 600)"
}

# api METHOD URL [CURL_ARGS...] -> body on stdout, dies on HTTP error
api() {
  local method=$1 url=$2; shift 2
  local out code
  out=$(curl -sS -u "$BS_USER:$BS_KEY" -X "$method" "$url" "$@" -w $'\n%{http_code}')
  code=${out##*$'\n'}; out=${out%$'\n'*}
  [[ "$code" == 2* ]] || { echo "bs: HTTP $code from $method $url: $out" >&2; return 22; }
  printf '%s' "$out"
}

bootstrap() { [[ -d "$SKILL_DIR/node_modules" ]] || npm ci --prefix "$SKILL_DIR" --silent; }

cmd_auth_source() { creds; echo "$BS_AUTH_SOURCE"; }

cmd_auth_check() {
  creds
  api GET "$API/plan.json" | jq -r '"plan ok: \(.parallel_sessions_max_allowed) parallels (\(.parallel_sessions_running) running)"'
}

usage() {
  cat <<'USAGE'
bs.sh - check apps and websites on declared platforms via BrowserStack

  bs.sh auth-check                 verify credentials and show plan limits
  bs.sh auth-source                where credentials come from (env|file)
USAGE
}

case "${1:-}" in
  auth-source) shift; cmd_auth_source "$@" ;;
  auth-check)  shift; cmd_auth_check "$@" ;;
  *) usage; exit 1 ;;
esac
```

`chmod +x bs.sh`

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/`. Expected: 3 pass.

- [ ] **Step 6: Live credentials setup (needs Martin once)**

Ask Martin for the 1Password item holding BrowserStack credentials (this is the planned single read). Then:

```bash
umask 077 && mkdir -p ~/.config/browserstack
op item get "<ITEM NAME>" --format json --reveal |
  jq -r '"username=" + (.fields[] | select(.label=="username").value),
         "access_key=" + (.fields[] | select(.label=="access key" or .label=="password" or .id=="password").value)' \
  > ~/.config/browserstack/credentials
chmod 600 ~/.config/browserstack/credentials
```

Adjust the field selectors to the item's real field labels (inspect labels first with `jq '.fields[].label'`; never print values). Then run `./bs.sh auth-check`. Expected: `plan ok: N parallels (0 running)`.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "bs.sh core: credentials, REST helper, auth-check"
```

---

### Task 2: Dependencies and Manifest Loader

**Files:**
- Create: `package.json`, `lib/manifest.mjs`, `tests/fixtures/full/platforms.toml`, `tests/fixtures/inherit/platforms.toml`, `tests/fixtures/inherit/.browserslistrc`
- Test: `tests/manifest.test.mjs`

**Interfaces:**
- Consumes: nothing
- Produces: `loadManifest(projectDir: string) -> { web: { browserslist: string[]|null, devices: string[], os: string[], check: { url: string|null, local: boolean } }, apps: { ios?: AppSection, android?: AppSection }, warnings: string[] }` where `AppSection = { app: string, devices: string[], os: string[] }`. `browserslist: null` means inherit project config

- [ ] **Step 1: package.json**

```json
{
  "name": "skill-browserstack",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test tests/" },
  "dependencies": {
    "browserslist": "4.24.4",
    "caniuse-lite": "1.0.30001695",
    "playwright-core": "1.62.0",
    "smol-toml": "1.3.1"
  }
}
```

Run `npm install`. If a pinned version does not exist, run `npm view <pkg> versions --json`, choose the closest published version (for playwright-core: the newest version BrowserStack supports per https://www.browserstack.com/docs/automate/playwright/browsers-and-os), update the pin, rerun. Commit `package-lock.json` too.

- [ ] **Step 2: Fixtures**

`tests/fixtures/full/platforms.toml`:

```toml
[web]
browserslist = ["chrome 128", "safari 16.6"]
devices = ["iPhone 15"]
future_key = true

[web.check]
url = "https://example.com"
local = false

[app.android]
app = "dist/app.apk"
devices = ["Samsung Galaxy S23"]
os = [">= 13"]
```

`tests/fixtures/inherit/platforms.toml`:

```toml
[web]
browserslist = "project"
```

`tests/fixtures/inherit/.browserslistrc`:

```
chrome 128
```

- [ ] **Step 3: Write the failing test**

`tests/manifest.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadManifest } from '../lib/manifest.mjs';

const fix = (name) => new URL(`./fixtures/${name}/`, import.meta.url).pathname;

test('full manifest parses', () => {
  const m = loadManifest(fix('full'));
  assert.deepEqual(m.web.browserslist, ['chrome 128', 'safari 16.6']);
  assert.deepEqual(m.web.devices, ['iPhone 15']);
  assert.equal(m.web.check.url, 'https://example.com');
  assert.equal(m.web.check.local, false);
  assert.equal(m.apps.android.app, 'dist/app.apk');
  assert.deepEqual(m.apps.android.os, ['>= 13']);
  assert.equal(m.apps.ios, undefined);
});

test('unknown keys warn but do not fail', () => {
  const m = loadManifest(fix('full'));
  assert.ok(m.warnings.some((w) => w.includes('future_key')));
});

test('"project" yields null queries', () => {
  const m = loadManifest(fix('inherit'));
  assert.equal(m.web.browserslist, null);
});

test('missing file throws with path', () => {
  assert.throws(() => loadManifest('/nonexistent'), /platforms\.toml/);
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test`. Expected: manifest tests fail (module missing).

- [ ] **Step 5: Implement lib/manifest.mjs**

```js
import { parse } from 'smol-toml';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const KNOWN = {
  web: ['browserslist', 'devices', 'os', 'check'],
  'web.check': ['url', 'local'],
  app: ['app', 'devices', 'os'],
};

function warnUnknown(obj, allowed, prefix, warnings) {
  for (const k of Object.keys(obj ?? {})) {
    if (!allowed.includes(k)) warnings.push(`ignoring unknown key ${prefix}${k}`);
  }
}

export function loadManifest(projectDir) {
  const file = path.join(projectDir, 'platforms.toml');
  let raw;
  try {
    raw = parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`cannot read ${file}: ${e.message}`, { cause: e });
  }
  const warnings = [];
  warnUnknown(raw, ['web', 'app'], '', warnings);
  warnUnknown(raw.web, KNOWN.web, 'web.', warnings);
  warnUnknown(raw.web?.check, KNOWN['web.check'], 'web.check.', warnings);

  const bl = raw.web?.browserslist ?? 'project';
  const web = {
    browserslist: bl === 'project' ? null : [].concat(bl),
    devices: raw.web?.devices ?? [],
    os: raw.web?.os ?? [],
    check: { url: raw.web?.check?.url ?? null, local: raw.web?.check?.local ?? false },
  };

  const apps = {};
  for (const platform of ['ios', 'android']) {
    const sec = raw.app?.[platform];
    if (!sec) continue;
    warnUnknown(sec, KNOWN.app, `app.${platform}.`, warnings);
    if (!sec.app) throw new Error(`app.${platform}.app is required`);
    apps[platform] = { app: sec.app, devices: sec.devices ?? [], os: sec.os ?? [] };
  }
  return { web, apps, warnings };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test`. Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "manifest loader with inherit and warn-on-unknown"
```

---

### Task 3: Query Resolution and Family Mapping

**Files:**
- Create: `lib/families.mjs`
- Test: `tests/families.test.mjs`

**Interfaces:**
- Consumes: nothing (pure)
- Produces: `resolveQueries(queries: string[]|null, projectDir: string) -> string[]` (Browserslist entries like `"chrome 128"`, `"ios_saf 17.0-17.4"`); `mapEntries(entries: string[]) -> { desktop: {family,browser,major,driver}[], ios: number[], android: number[], unresolved: {entry,reason}[] }` with `driver` in `'playwright'|'webdriver'`

- [ ] **Step 1: Write the failing test**

`tests/families.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveQueries, mapEntries } from '../lib/families.mjs';

test('explicit queries resolve to entries', () => {
  const entries = resolveQueries(['chrome 128', 'safari 16.6'], process.cwd());
  assert.ok(entries.includes('chrome 128'));
  assert.ok(entries.some((e) => e.startsWith('safari 16.6')));
});

test('null queries read project config', () => {
  const dir = new URL('./fixtures/inherit/', import.meta.url).pathname;
  assert.deepEqual(resolveQueries(null, dir), ['chrome 128']);
});

test('chrome maps to playwright, firefox and safari to webdriver', () => {
  const m = mapEntries(['chrome 128', 'firefox 130', 'safari 16.6', 'edge 128']);
  assert.deepEqual(m.desktop.find((d) => d.family === 'chrome'),
    { family: 'chrome', browser: 'chrome', major: 128, driver: 'playwright' });
  assert.equal(m.desktop.find((d) => d.family === 'firefox').driver, 'webdriver');
  assert.equal(m.desktop.find((d) => d.family === 'safari').driver, 'webdriver');
  assert.equal(m.desktop.find((d) => d.family === 'edge').driver, 'playwright');
});

test('old chrome falls back to webdriver', () => {
  const m = mapEntries(['chrome 80']);
  assert.equal(m.desktop[0].driver, 'webdriver');
});

test('mobile families collect majors, ranges take the max', () => {
  const m = mapEntries(['ios_saf 17.0-17.4', 'ios_saf 16.6', 'and_chr 128', 'samsung 25']);
  assert.deepEqual(m.ios, [17, 16]);
  assert.deepEqual(m.android, [128, 25]);
});

test('unsupported families land in unresolved with a reason', () => {
  const m = mapEntries(['op_mini all', 'kaios 3.0-3.1']);
  assert.equal(m.unresolved.length, 2);
  assert.match(m.unresolved[0].reason, /not available/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`. Expected: families tests fail.

- [ ] **Step 3: Implement lib/families.mjs**

```js
import browserslist from 'browserslist';

export function resolveQueries(queries, projectDir) {
  return browserslist(queries ?? undefined, { path: projectDir });
}

// Highest version in a browserslist range string ("17.0-17.4" -> 17.4)
function maxOfRange(v) {
  const parts = v.split('-');
  return parts[parts.length - 1];
}
const major = (v) => parseInt(maxOfRange(v), 10);

// driver: how BrowserStack runs this family.
// chrome/edge >= 83 run branded via Playwright; safari and firefox need
// real versions, which only Selenium/WebDriver sessions provide.
const DESKTOP = {
  chrome: { browser: 'chrome', playwrightMin: 83 },
  edge: { browser: 'edge', playwrightMin: 83 },
  firefox: { browser: 'firefox', playwrightMin: Infinity },
  safari: { browser: 'safari', playwrightMin: Infinity },
  opera: { browser: 'opera', playwrightMin: Infinity },
  ie: { browser: 'ie', playwrightMin: Infinity },
};
const IOS = new Set(['ios_saf']);
const ANDROID = new Set(['and_chr', 'samsung', 'android']);
const UNSUPPORTED = new Set(['op_mini', 'op_mob', 'and_uc', 'and_qq', 'and_ff', 'kaios', 'baidu', 'bb', 'ie_mob']);

export function mapEntries(entries) {
  const out = { desktop: [], ios: [], android: [], unresolved: [] };
  for (const entry of entries) {
    const [family, version] = entry.split(' ');
    if (DESKTOP[family]) {
      const m = major(version);
      out.desktop.push({
        family, browser: DESKTOP[family].browser, major: m,
        driver: m >= DESKTOP[family].playwrightMin ? 'playwright' : 'webdriver',
      });
    } else if (IOS.has(family)) {
      if (!out.ios.includes(major(version))) out.ios.push(major(version));
    } else if (ANDROID.has(family)) {
      if (!out.android.includes(major(version))) out.android.push(major(version));
    } else if (UNSUPPORTED.has(family)) {
      out.unresolved.push({ entry, reason: `${family} is not available on BrowserStack` });
    } else {
      out.unresolved.push({ entry, reason: `unknown browserslist family ${family}` });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`. Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "browserslist resolution and family mapping"
```

---

### Task 4: Bucketing, Capabilities, Resolve CLI

**Files:**
- Create: `lib/matrix.mjs`, `lib/caps.mjs`, `lib/capsdata.mjs`, `lib/cli-resolve.mjs`, `tests/fixtures/browsers.json`, `tests/fixtures/app-devices.json`
- Modify: `bs.sh` (add `resolve` to dispatch; add `PROJECT_DIR=${BS_PROJECT_DIR:-$PWD}`)
- Test: `tests/matrix.test.mjs`, `tests/caps.test.mjs`

**Interfaces:**
- Consumes: `loadManifest`, `resolveQueries`, `mapEntries`
- Produces: `buildMatrix(manifest, capsData) -> { targets: Target[], gaps: {entry,reason}[] }` with `Target = { label, driver: 'playwright'|'webdriver', kind: 'desktop'|'ios'|'android', browser, browser_version?, os, os_version, device?, real_mobile? }`; `capsData = { automate: Entry[], appDevices: Device[] }`; `playwrightWss(target, creds, opts) -> string`; `webdriverPayload(target, creds, opts) -> object`; `fetchCapsData(creds, cacheDir) -> Promise<capsData>` (24 h file cache); `opts = { name, build, local, localIdentifier }`

- [ ] **Step 1: Fixtures**

`tests/fixtures/browsers.json` (shape of Automate `GET /browsers.json`, hand-made subset):

```json
[
  { "os": "Windows", "os_version": "11", "browser": "chrome", "browser_version": "128.0", "device": null, "real_mobile": null },
  { "os": "Windows", "os_version": "11", "browser": "firefox", "browser_version": "130.0", "device": null, "real_mobile": null },
  { "os": "OS X", "os_version": "Sonoma", "browser": "safari", "browser_version": "17.3", "device": null, "real_mobile": null },
  { "os": "OS X", "os_version": "Ventura", "browser": "safari", "browser_version": "16.6", "device": null, "real_mobile": null },
  { "os": "ios", "os_version": "17", "browser": "iphone", "browser_version": null, "device": "iPhone 15", "real_mobile": true },
  { "os": "ios", "os_version": "16", "browser": "iphone", "browser_version": null, "device": "iPhone 14", "real_mobile": true },
  { "os": "android", "os_version": "14.0", "browser": "android", "browser_version": null, "device": "Samsung Galaxy S24", "real_mobile": true }
]
```

`tests/fixtures/app-devices.json` (shape of App Automate `GET /devices.json`):

```json
[
  { "device": "Samsung Galaxy S23", "os": "android", "os_version": "13.0", "real_mobile": true },
  { "device": "iPhone 15", "os": "ios", "os_version": "17", "real_mobile": true }
]
```

- [ ] **Step 2: Write the failing tests**

`tests/matrix.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildMatrix } from '../lib/matrix.mjs';

const automate = JSON.parse(readFileSync(new URL('./fixtures/browsers.json', import.meta.url)));
const appDevices = JSON.parse(readFileSync(new URL('./fixtures/app-devices.json', import.meta.url)));
const capsData = { automate, appDevices };

const manifest = (over = {}) => ({
  web: { browserslist: ['chrome 128', 'safari 16.6', 'ios_saf 17.5'],
         devices: ['iPhone 15'], os: [], check: { url: null, local: false }, ...over },
  apps: {}, warnings: [],
});

test('desktop targets resolve against availability', () => {
  const { targets } = buildMatrix(manifest(), capsData);
  const chrome = targets.find((t) => t.browser === 'chrome');
  assert.deepEqual(chrome, { label: 'chrome 128 on Windows 11', driver: 'playwright', kind: 'desktop',
    browser: 'chrome', browser_version: '128.0', os: 'Windows', os_version: '11' });
  const safari = targets.find((t) => t.browser === 'safari');
  assert.equal(safari.os_version, 'Ventura');
  assert.equal(safari.driver, 'webdriver');
});

test('ios versions bind to declared devices', () => {
  const { targets } = buildMatrix(manifest(), capsData);
  const ios = targets.find((t) => t.kind === 'ios');
  assert.equal(ios.device, 'iPhone 15');
  assert.equal(ios.os_version, '17');
  assert.equal(ios.driver, 'playwright');
});

test('unavailable version is a gap, not a silent drop', () => {
  const { targets, gaps } = buildMatrix(manifest({ browserslist: ['chrome 42'] }), capsData);
  assert.equal(targets.length, 0);
  assert.match(gaps[0].reason, /not available/);
});

test('mobile family without declared device is a gap', () => {
  const { gaps } = buildMatrix(manifest({ devices: [] }), capsData);
  assert.ok(gaps.some((g) => g.reason.includes('declare a device')));
});
```

`tests/caps.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playwrightWss, webdriverPayload, PW_VERSION } from '../lib/caps.mjs';

const creds = { user: 'u', key: 'k' };
const desktop = { label: 'chrome 128 on Windows 11', driver: 'playwright', kind: 'desktop',
  browser: 'chrome', browser_version: '128.0', os: 'Windows', os_version: '11' };

test('playwright wss embeds caps', () => {
  const wss = playwrightWss(desktop, creds, { name: 'n', build: 'b', local: false });
  assert.ok(wss.startsWith('wss://cdp.browserstack.com/playwright?caps='));
  const caps = JSON.parse(decodeURIComponent(wss.split('caps=')[1]));
  assert.equal(caps.browser, 'chrome');
  assert.equal(caps['browserstack.username'], 'u');
  assert.equal(caps['client.playwrightVersion'], PW_VERSION);
  assert.equal(caps['browserstack.local'], undefined);
});

test('webdriver payload uses bstack:options', () => {
  const p = webdriverPayload({ ...desktop, browser: 'safari', browser_version: '16.6', os: 'OS X', os_version: 'Ventura' },
    creds, { name: 'n', build: 'b', local: true, localIdentifier: 'id1' });
  const am = p.capabilities.alwaysMatch;
  assert.equal(am.browserName, 'safari');
  assert.equal(am['bstack:options'].osVersion, 'Ventura');
  assert.equal(am['bstack:options'].local, true);
  assert.equal(am['bstack:options'].localIdentifier, 'id1');
  assert.equal(am['bstack:options'].userName, 'u');
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`. Expected: matrix and caps tests fail.

- [ ] **Step 4: Implement lib/matrix.mjs**

```js
import { resolveQueries, mapEntries } from './families.mjs';

const vMajor = (v) => parseInt(v, 10);

function findDesktop(automate, browser, majorWanted, osPin) {
  const rows = automate.filter((e) => e.browser === browser && e.browser_version
    && vMajor(e.browser_version) === majorWanted
    && (osPin.length === 0 || osPin.includes(`${e.os === 'OS X' ? 'macOS' : e.os} ${e.os_version}`)
        || osPin.includes(`${e.os} ${e.os_version}`)));
  // prefer Windows 11 when unpinned, else first hit
  return rows.find((e) => e.os === 'Windows' && e.os_version === '11') ?? rows[0] ?? null;
}

const isIphone = (name) => /iphone|ipad/i.test(name);

export function buildMatrix(manifest, capsData, projectDir = process.cwd()) {
  const entries = resolveQueries(manifest.web.browserslist, projectDir);
  const mapped = mapEntries(entries);
  const targets = [];
  const gaps = mapped.unresolved.map((u) => ({ entry: u.entry, reason: u.reason }));

  for (const d of mapped.desktop) {
    const hit = findDesktop(capsData.automate, d.browser, d.major, manifest.web.os);
    if (!hit) { gaps.push({ entry: `${d.family} ${d.major}`, reason: `${d.browser} ${d.major} not available on BrowserStack` }); continue; }
    targets.push({ label: `${d.browser} ${d.major} on ${hit.os} ${hit.os_version}`, driver: d.driver,
      kind: 'desktop', browser: hit.browser, browser_version: hit.browser_version,
      os: hit.os, os_version: hit.os_version });
  }

  const mobile = [
    { majors: mapped.ios, want: isIphone, kind: 'ios', family: 'ios_saf', driver: 'playwright' },
    { majors: mapped.android, want: (n) => !isIphone(n), kind: 'android', family: 'and_chr/samsung', driver: 'playwright' },
  ];
  for (const { majors, want, kind, family, driver } of mobile) {
    if (majors.length === 0) continue;
    const declared = manifest.web.devices.filter(want);
    if (declared.length === 0) { gaps.push({ entry: family, reason: `declare a device for ${family} in [web].devices` }); continue; }
    for (const m of majors) {
      let placed = false;
      for (const dev of declared) {
        const hit = capsData.automate.find((e) => e.real_mobile && e.device === dev
          && (kind === 'ios' ? e.os === 'ios' : e.os === 'android') && vMajor(e.os_version) === m);
        if (hit) {
          targets.push({ label: `${dev} (${hit.os} ${hit.os_version})`, driver, kind,
            browser: hit.browser, os: hit.os, os_version: hit.os_version, device: dev, real_mobile: true });
          placed = true; break;
        }
      }
      if (!placed) gaps.push({ entry: `${family} ${m}`, reason: `no declared device offers ${kind} ${m}` });
    }
  }
  return { targets, gaps };
}
```

- [ ] **Step 5: Implement lib/caps.mjs and lib/capsdata.mjs**

`lib/caps.mjs`:

```js
import { createRequire } from 'node:module';
export const PW_VERSION = createRequire(import.meta.url)('playwright-core/package.json').version;

export function playwrightWss(t, creds, opts) {
  const caps = {
    browser: t.kind === 'desktop' ? t.browser : (t.kind === 'ios' ? 'safari' : 'chrome'),
    ...(t.browser_version ? { browser_version: t.browser_version } : {}),
    os: t.os, os_version: t.os_version,
    ...(t.device ? { device: t.device, realMobile: 'true' } : {}),
    name: opts.name, build: opts.build,
    'browserstack.username': creds.user,
    'browserstack.accessKey': creds.key,
    'client.playwrightVersion': PW_VERSION,
    ...(opts.local ? { 'browserstack.local': 'true', 'browserstack.localIdentifier': opts.localIdentifier } : {}),
  };
  return `wss://cdp.browserstack.com/playwright?caps=${encodeURIComponent(JSON.stringify(caps))}`;
}

export function webdriverPayload(t, creds, opts) {
  return { capabilities: { alwaysMatch: {
    browserName: t.browser,
    ...(t.browser_version ? { browserVersion: t.browser_version } : {}),
    'bstack:options': {
      os: t.os, osVersion: t.os_version,
      ...(t.device ? { deviceName: t.device, realMobile: true } : {}),
      sessionName: opts.name, buildName: opts.build,
      userName: creds.user, accessKey: creds.key,
      ...(opts.local ? { local: true, localIdentifier: opts.localIdentifier } : {}),
    },
  } } };
}
```

`lib/capsdata.mjs`:

```js
import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';

const DAY = 24 * 60 * 60 * 1000;

async function cached(file, fetcher) {
  try { if (Date.now() - statSync(file).mtimeMs < DAY) return JSON.parse(readFileSync(file, 'utf8')); } catch {}
  const data = await fetcher();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data));
  return data;
}

async function getJson(url, creds) {
  const res = await fetch(url, { headers: { Authorization: 'Basic ' + Buffer.from(`${creds.user}:${creds.key}`).toString('base64') } });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

export function credsFromEnv() {
  const user = process.env.BROWSERSTACK_USERNAME, key = process.env.BROWSERSTACK_ACCESS_KEY;
  if (!user || !key) throw new Error('bs.sh must export BROWSERSTACK_USERNAME/BROWSERSTACK_ACCESS_KEY');
  return { user, key };
}

export async function fetchCapsData(creds, cacheDir) {
  const [automate, appDevices] = await Promise.all([
    cached(path.join(cacheDir, 'browsers.json'), () => getJson('https://api.browserstack.com/automate/browsers.json', creds)),
    cached(path.join(cacheDir, 'app-devices.json'), () => getJson('https://api-cloud.browserstack.com/app-automate/devices.json', creds)),
  ]);
  return { automate, appDevices };
}
```

- [ ] **Step 6: Implement lib/cli-resolve.mjs and wire bs.sh**

`lib/cli-resolve.mjs`:

```js
import { loadManifest } from './manifest.mjs';
import { buildMatrix } from './matrix.mjs';
import { fetchCapsData, credsFromEnv } from './capsdata.mjs';
import path from 'node:path';
import os from 'node:os';

const projectDir = process.argv[2];
const json = process.argv.includes('--json');
const manifest = loadManifest(projectDir);
const capsData = await fetchCapsData(credsFromEnv(), path.join(os.homedir(), '.cache/browserstack'));
const { targets, gaps } = buildMatrix(manifest, capsData, projectDir);

if (json) {
  console.log(JSON.stringify({ targets, gaps, manifest }, null, 2));
} else {
  for (const w of manifest.warnings) console.error(`warning: ${w}`);
  console.log(`${targets.length} target(s):`);
  for (const t of targets) console.log(`  [${t.driver === 'playwright' ? 'pw' : 'wd'}] ${t.label}`);
  if (gaps.length) {
    console.log(`${gaps.length} gap(s):`);
    for (const g of gaps) console.log(`  ! ${g.entry}: ${g.reason}`);
    process.exitCode = 2;
  }
}
```

In `bs.sh`, add near the top: `PROJECT_DIR=${BS_PROJECT_DIR:-$PWD}` and this subcommand plus a dispatch line `resolve) shift; cmd_resolve "$@" ;;`:

```bash
cmd_resolve() {
  creds; bootstrap
  BROWSERSTACK_USERNAME=$BS_USER BROWSERSTACK_ACCESS_KEY=$BS_KEY \
    node "$SKILL_DIR/lib/cli-resolve.mjs" "$PROJECT_DIR" "$@"
}
```

Add to `usage`: `bs.sh resolve [--json]              manifest -> concrete target matrix`

- [ ] **Step 7: Run tests, then live smoke**

Run: `npm test`. Expected: all pass.

Live: `cd tests/fixtures/full && ../../../bs.sh resolve`. Expected: real matrix printed; `chrome 128` and `safari 16.6` resolve or appear as explicit gaps (BrowserStack rotates old versions; a gap with a reason is a correct outcome). Then `bs.sh resolve --json | jq .targets` sanity-check shapes.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "resolve: bucketing, capabilities, CLI with cached caps data"
```

---

### Task 5: Tunnel Management

**Files:**
- Modify: `bs.sh` (add `tunnel` subcommand and `tunnel_ensure` helper)
- Test: `tests/tunnel.test.mjs`

**Interfaces:**
- Consumes: `creds()`, `die()`
- Produces: `bs.sh tunnel start|stop|status [--id IDENT]`; `tunnel_ensure IDENT` (starts if not running, used by `check` in Task 6); default identifier is `basename "$PROJECT_DIR"`

- [ ] **Step 1: Write the failing test**

`tests/tunnel.test.mjs` (no network; asserts UX contracts):

```js
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

test('tunnel start without cached binary explains the download', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'bs-'));
  // fake HOME so no binary is cached; BS_TUNNEL_NO_DOWNLOAD makes this testable offline
  const r = run(['tunnel', 'start', '--id', 't1'],
    { HOME: home, BROWSERSTACK_USERNAME: 'u', BROWSERSTACK_ACCESS_KEY: 'k', BS_TUNNEL_NO_DOWNLOAD: '1' });
  assert.equal(r.code, 1);
  assert.match(r.out, /BrowserStackLocal/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`. Expected: tunnel tests fail (subcommand unknown).

- [ ] **Step 3: Implement in bs.sh**

```bash
TUNNEL_BIN="$CACHE/BrowserStackLocal"

tunnel_download() {
  [[ -z "${BS_TUNNEL_NO_DOWNLOAD:-}" ]] || die "BrowserStackLocal binary missing at $TUNNEL_BIN and download disabled"
  local os arch
  case "$(uname -s)" in Darwin) os=darwin ;; Linux) os=linux ;; *) die "unsupported OS" ;; esac
  case "$(uname -m)" in arm64|aarch64) arch=arm64 ;; x86_64) arch=x64 ;; *) die "unsupported arch" ;; esac
  mkdir -p "$CACHE"
  echo "downloading BrowserStackLocal ($os-$arch)..." >&2
  curl -sSL "https://www.browserstack.com/browserstack-local/BrowserStackLocal-$os-$arch.zip" -o "$CACHE/bsl.zip"
  unzip -oq "$CACHE/bsl.zip" -d "$CACHE" && rm "$CACHE/bsl.zip"
  chmod +x "$TUNNEL_BIN"
}

tunnel_id_arg() {  # parse optional --id, default to project basename
  TUNNEL_ID=$(basename "$PROJECT_DIR")
  if [[ "${1:-}" == "--id" ]]; then TUNNEL_ID=$2; fi
}

tunnel_running() { pgrep -f "BrowserStackLocal.*--local-identifier $TUNNEL_ID" >/dev/null; }

tunnel_ensure() {
  TUNNEL_ID=$1
  tunnel_running && return
  [[ -x "$TUNNEL_BIN" ]] || tunnel_download
  "$TUNNEL_BIN" --key "$BS_KEY" --daemon start --local-identifier "$TUNNEL_ID" >/dev/null
  echo "tunnel $TUNNEL_ID started" >&2
}

cmd_tunnel() {
  creds
  local action=${1:?usage: bs.sh tunnel start|stop|status [--id IDENT]}; shift
  tunnel_id_arg "$@"
  case $action in
    start)  tunnel_ensure "$TUNNEL_ID"; echo "tunnel $TUNNEL_ID running" ;;
    stop)   [[ -x "$TUNNEL_BIN" ]] && "$TUNNEL_BIN" --key "$BS_KEY" --daemon stop --local-identifier "$TUNNEL_ID" >/dev/null || true
            echo "tunnel $TUNNEL_ID stopped" ;;
    status) if tunnel_running; then echo "tunnel $TUNNEL_ID running"; else echo "tunnel $TUNNEL_ID not running"; fi ;;
    *) die "unknown tunnel action: $action" ;;
  esac
}
```

Dispatch line: `tunnel) shift; cmd_tunnel "$@" ;;`. Usage line: `bs.sh tunnel start|stop|status [--id I]  local tunnel for localhost targets`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`. Expected: all pass.

- [ ] **Step 5: Live smoke**

```bash
./bs.sh tunnel start --id plan-smoke && ./bs.sh tunnel status --id plan-smoke && ./bs.sh tunnel stop --id plan-smoke
```

Expected: download on first run, then `running`, then `stopped`. Verify no process remains: `pgrep -f BrowserStackLocal || echo clean`.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "tunnel: managed BrowserStackLocal daemon per project"
```

---

### Task 6: The Check Runner

**Files:**
- Create: `lib/pool.mjs`, `lib/report.mjs`, `lib/drivers.mjs`, `lib/cli-check.mjs`
- Modify: `bs.sh` (add `check`)
- Test: `tests/pool.test.mjs`, `tests/report.test.mjs`, `tests/check-contract.test.mjs`

**Interfaces:**
- Consumes: `buildMatrix`, `fetchCapsData`, `credsFromEnv`, `playwrightWss`, `webdriverPayload`, `tunnel_ensure`
- Produces: `runPool(items, n, fn) -> Promise<Result[]>`; `formatMatrix(results: {label,status,detail}[]) -> string` (status `'pass'|'fail'|'error'`); built-in drivers `smokePlaywright(target, wss, url)` and `smokeWebdriver(target, payload, url)` each returning `{ status, detail }`; `bs.sh check [SCRIPT.mjs] [--url URL] [--local] [--parallel N]`; script mode env contract: `BS_TARGET` (JSON), `BS_WSS_URL` or `BS_WEBDRIVER_URL`, `BS_CHECK_URL`; script exit 0 = pass

- [ ] **Step 1: Write the failing unit tests**

`tests/pool.test.mjs`:

```js
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
```

`tests/report.test.mjs`:

```js
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
```

`tests/check-contract.test.mjs` (script mode env contract with an injected fake driver):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScriptTarget } from '../lib/drivers.mjs';

test('script gets the target env contract', async () => {
  const target = { label: 'chrome 128 on Windows 11', driver: 'playwright' };
  const r = await runScriptTarget(target, 'wss://example/pw', 'https://example.com',
    new URL('./fixtures/echo-env.mjs', import.meta.url).pathname);
  assert.equal(r.status, 'pass');
  const env = JSON.parse(r.detail);
  assert.equal(JSON.parse(env.BS_TARGET).label, target.label);
  assert.equal(env.BS_WSS_URL, 'wss://example/pw');
  assert.equal(env.BS_CHECK_URL, 'https://example.com');
});
```

`tests/fixtures/echo-env.mjs`:

```js
const { BS_TARGET, BS_WSS_URL, BS_WEBDRIVER_URL, BS_CHECK_URL } = process.env;
console.log(JSON.stringify({ BS_TARGET, BS_WSS_URL, BS_WEBDRIVER_URL, BS_CHECK_URL }));
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`. Expected: new tests fail.

- [ ] **Step 3: Implement lib/pool.mjs and lib/report.mjs**

`lib/pool.mjs`:

```js
export async function runPool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]).catch((e) => ({ status: 'error', detail: String(e?.message ?? e) }));
    }
  }));
  return out;
}
```

`lib/report.mjs`:

```js
export function formatMatrix(results) {
  const width = Math.max(...results.map((r) => r.label.length));
  const lines = results.map((r) =>
    `${r.status === 'pass' ? 'PASS' : r.status === 'fail' ? 'FAIL' : 'ERR '}  ${r.label.padEnd(width)}  ${r.detail}`.trimEnd());
  const passed = results.filter((r) => r.status === 'pass').length;
  lines.push(`${passed}/${results.length} passed`);
  return lines.join('\n');
}
```

- [ ] **Step 4: Implement lib/drivers.mjs**

```js
import { spawn } from 'node:child_process';

// Built-in smoke: load, HTTP success, nonempty title, no console errors.
export async function smokePlaywright(target, wss, url) {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.connect(wss, { timeout: 90_000 });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    const resp = await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
    const title = await page.title();
    if (!resp || resp.status() >= 400) return { status: 'fail', detail: `HTTP ${resp?.status()}` };
    if (!title) return { status: 'fail', detail: 'empty title' };
    if (errors.length) return { status: 'fail', detail: `console errors: ${errors.length} (${errors[0].slice(0, 80)})` };
    return { status: 'pass', detail: `title "${title.slice(0, 40)}"` };
  } finally {
    await browser.close();
  }
}

// Tail driver over plain WebDriver REST. Console errors are not
// uniformly available here; the smoke asserts load and title only.
const HUB = 'https://hub-cloud.browserstack.com/wd/hub';

async function wd(method, path, body) {
  const res = await fetch(`${HUB}${path}`, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`webdriver HTTP ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return data.value;
}

export async function smokeWebdriver(target, payload, url) {
  const session = await wd('POST', '/session', payload);
  const id = session.sessionId;
  try {
    await wd('POST', `/session/${id}/url`, { url });
    const title = await wd('GET', `/session/${id}/title`);
    if (!title) return { status: 'fail', detail: 'empty title' };
    return { status: 'pass', detail: `title "${String(title).slice(0, 40)}"` };
  } finally {
    await wd('DELETE', `/session/${id}`).catch(() => {});
  }
}

export function runScriptTarget(target, endpoint, url, script, payload = null) {
  const env = {
    ...process.env,
    BS_TARGET: JSON.stringify(target),
    BS_CHECK_URL: url,
    ...(target.driver === 'playwright'
      ? { BS_WSS_URL: endpoint }
      : { BS_WEBDRIVER_URL: 'https://hub-cloud.browserstack.com/wd/hub',
          BS_WD_PAYLOAD: JSON.stringify(payload) }),
  };
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { env });
    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) =>
      resolve(code === 0 ? { status: 'pass', detail: out.trim().slice(0, 400) }
                         : { status: 'fail', detail: (err || out).trim().slice(0, 400) }));
  });
}
```

- [ ] **Step 5: Implement lib/cli-check.mjs and wire bs.sh**

`lib/cli-check.mjs`:

```js
import path from 'node:path';
import os from 'node:os';
import { loadManifest } from './manifest.mjs';
import { buildMatrix } from './matrix.mjs';
import { fetchCapsData, credsFromEnv } from './capsdata.mjs';
import { playwrightWss, webdriverPayload } from './caps.mjs';
import { smokePlaywright, smokeWebdriver, runScriptTarget } from './drivers.mjs';
import { runPool } from './pool.mjs';
import { formatMatrix } from './report.mjs';

const args = process.argv.slice(2);
const projectDir = args.shift();
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 1)[0] : null; };
const flagVal = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : null; };
const local = Boolean(flag('--local'));
const parallel = parseInt(flagVal('--parallel') ?? '2', 10);
const urlOverride = flagVal('--url');
const script = args[0] ?? null;

const creds = credsFromEnv();
const manifest = loadManifest(projectDir);
const url = urlOverride ?? manifest.web.check.url;
if (!url) { console.error('no target URL: set [web.check].url or pass --url'); process.exit(1); }
const useLocal = local || manifest.web.check.local || /localhost|127\.0\.0\.1/.test(url);
const localIdentifier = process.env.BS_TUNNEL_ID ?? path.basename(projectDir);

const capsData = await fetchCapsData(creds, path.join(os.homedir(), '.cache/browserstack'));
const { targets, gaps } = buildMatrix(manifest, capsData, projectDir);
for (const g of gaps) console.error(`gap: ${g.entry}: ${g.reason}`);
if (targets.length === 0) { console.error('no runnable targets'); process.exit(2); }

const build = `check ${path.basename(projectDir)} ${new Date().toISOString().slice(0, 10)}`;
const results = await runPool(targets, parallel, async (t) => {
  const opts = { name: t.label, build, local: useLocal, localIdentifier };
  const endpoint = t.driver === 'playwright' ? playwrightWss(t, creds, opts) : null;
  const payload = t.driver === 'webdriver' ? webdriverPayload(t, creds, opts) : null;
  const r = script
    ? await runScriptTarget(t, endpoint, url, script, payload)
    : t.driver === 'playwright'
      ? await smokePlaywright(t, endpoint, url)
      : await smokeWebdriver(t, payload, url);
  return { label: t.label, ...r };
});

console.log(formatMatrix(results));
if (results.some((r) => r.status !== 'pass')) process.exit(1);
```

Script-mode contract for tail targets: `BS_WEBDRIVER_URL` is always the hub URL and `BS_WD_PAYLOAD` is the ready-to-POST session payload JSON, as implemented in `runScriptTarget` above. Playwright targets get `BS_WSS_URL` instead. Both variants carry `BS_TARGET` and `BS_CHECK_URL`.

In `bs.sh`:

```bash
cmd_check() {
  creds; bootstrap
  local rc=0
  BROWSERSTACK_USERNAME=$BS_USER BROWSERSTACK_ACCESS_KEY=$BS_KEY \
    node "$SKILL_DIR/lib/cli-check.mjs" "$PROJECT_DIR" "$@" || rc=$?
  if [[ $rc -eq 3 ]]; then           # runner asked for the tunnel
    tunnel_ensure "$(basename "$PROJECT_DIR")"
    BROWSERSTACK_USERNAME=$BS_USER BROWSERSTACK_ACCESS_KEY=$BS_KEY BS_TUNNEL_READY=1 \
      node "$SKILL_DIR/lib/cli-check.mjs" "$PROJECT_DIR" "$@"
  else
    return $rc
  fi
}
```

Tunnel handshake: `cli-check.mjs` exits 3 (before running any target) when `useLocal` is true and `BS_TUNNEL_READY` is unset; add that check right after `useLocal` is computed (`if (useLocal && !process.env.BS_TUNNEL_READY) process.exit(3);`). `cmd_check` catches exit 3, starts the tunnel, and reruns. This keeps TOML parsing in one place. Dispatch line: `check) shift; cmd_check "$@" ;;`. Usage line: `bs.sh check [SCRIPT.mjs] [--url U] [--local] [--parallel N]   pass/fail matrix`

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`. Expected: all pass.

- [ ] **Step 7: Live smoke**

```bash
cd tests/fixtures/full && ../../../bs.sh check --url https://example.com --parallel 2
```

Expected: a matrix with at least the chrome target PASS via Playwright and, if `safari 16.6` still exists on BrowserStack, a webdriver PASS; otherwise the gap is listed and the run still exits by remaining results. Verify on the BrowserStack dashboard that the sessions closed. If the Playwright connect fails on a protocol/version error, check the pinned `playwright-core` against the supported list and adjust the pin (Global Constraints rule).

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "check: pooled smoke runner with playwright and webdriver drivers"
```

---

### Task 7: Screenshots Sweep

**Files:**
- Create: `lib/shots.mjs`, `lib/cli-shots.mjs`
- Modify: `bs.sh` (add `shots`)
- Test: `tests/shots.test.mjs`

**Interfaces:**
- Consumes: `buildMatrix`, `credsFromEnv`, `loadManifest`, `fetchCapsData`
- Produces: `pickShotBrowsers(targets, shotBrowsers) -> object[]` (Screenshots-API browser descriptors); `bs.sh shots [URL] [--out DIR]` writing PNGs to DIR (default `./browserstack-shots/`)

- [ ] **Step 1: Write the failing test**

`tests/shots.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`. Expected: shots test fails.

- [ ] **Step 3: Implement lib/shots.mjs and lib/cli-shots.mjs**

`lib/shots.mjs`:

```js
const major = (v) => v ? parseInt(v, 10) : null;

export function pickShotBrowsers(targets, shotBrowsers) {
  const picked = [];
  for (const t of targets) {
    const hit = shotBrowsers.find((b) => t.kind === 'desktop'
      ? b.browser === t.browser && major(b.browser_version) === major(t.browser_version)
        && b.os === t.os && b.os_version === t.os_version
      : b.device === t.device && b.os_version === t.os_version);
    if (hit) picked.push(hit);
  }
  return picked;
}
```

`lib/cli-shots.mjs`:

```js
import path from 'node:path';
import os from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadManifest } from './manifest.mjs';
import { buildMatrix } from './matrix.mjs';
import { fetchCapsData, credsFromEnv } from './capsdata.mjs';
import { pickShotBrowsers } from './shots.mjs';

const BASE = 'https://www.browserstack.com/screenshots';
const [projectDir, ...rest] = process.argv.slice(2);
const outIdx = rest.indexOf('--out');
const outDir = outIdx >= 0 ? rest.splice(outIdx, 2)[1] : 'browserstack-shots';
const creds = credsFromEnv();
const auth = { Authorization: 'Basic ' + Buffer.from(`${creds.user}:${creds.key}`).toString('base64') };

const manifest = loadManifest(projectDir);
const url = rest[0] ?? manifest.web.check.url;
if (!url) { console.error('no URL: pass one or set [web.check].url'); process.exit(1); }

const capsData = await fetchCapsData(creds, path.join(os.homedir(), '.cache/browserstack'));
const { targets } = buildMatrix(manifest, capsData, projectDir);

const list = await fetch(`${BASE}/browsers.json`, { headers: auth });
if (list.status === 403) { console.error('Screenshots API not enabled on this plan (HTTP 403)'); process.exit(3); }
const shotBrowsers = await list.json();
const browsers = pickShotBrowsers(targets, shotBrowsers);
if (browsers.length === 0) { console.error('no matrix target maps to a Screenshots browser'); process.exit(2); }

const job = await fetch(BASE, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
  body: JSON.stringify({ url, browsers, wait_time: 5 }) }).then((r) => r.json());
console.log(`job ${job.job_id}: ${browsers.length} screenshot(s)`);

let done;
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 10_000));
  done = await fetch(`${BASE}/${job.job_id}.json`, { headers: auth }).then((r) => r.json());
  if (done.state === 'done') break;
  console.error(`  ${done.state}...`);
}
mkdirSync(outDir, { recursive: true });
for (const s of done.screenshots ?? []) {
  if (s.state !== 'done' || !s.image_url) { console.error(`  skip ${s.browser ?? s.device}: ${s.state}`); continue; }
  const name = `${s.os}-${s.os_version}-${s.browser ?? s.device}-${s.browser_version ?? ''}.png`.replace(/[^\w.-]+/g, '_');
  const buf = Buffer.from(await (await fetch(s.image_url)).arrayBuffer());
  writeFileSync(path.join(outDir, name), buf);
  console.log(`  ${path.join(outDir, name)}`);
}
```

`bs.sh`: `cmd_shots() { creds; bootstrap; BROWSERSTACK_USERNAME=$BS_USER BROWSERSTACK_ACCESS_KEY=$BS_KEY node "$SKILL_DIR/lib/cli-shots.mjs" "$PROJECT_DIR" "$@"; }` plus dispatch `shots) shift; cmd_shots "$@" ;;` and usage line `bs.sh shots [URL] [--out DIR]        render sweep across the matrix`

- [ ] **Step 4: Run tests, then live smoke**

Run: `npm test`. Expected: all pass.

Live: `cd tests/fixtures/full && ../../../bs.sh shots https://example.com --out /tmp/shots-smoke`. Expected: job id printed, PNGs land in the directory, or a clear exit-3 message if the plan lacks Screenshots access (report that to Martin; the subcommand stays, gated).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "shots: screenshots-API sweep across the resolved matrix"
```

---

### Task 8: App Upload and Launch Smoke

**Files:**
- Create: `lib/app.mjs`, `lib/cli-app.mjs`
- Modify: `bs.sh` (add `app`)
- Test: `tests/app.test.mjs`

**Interfaces:**
- Consumes: `loadManifest`, `credsFromEnv`, `fetchCapsData` (for `appDevices`), `runPool`, `formatMatrix`
- Produces: `parseOsRange(spec: string) -> (version: string) => boolean`; `pickAppDevices(section, appDevices) -> {device, os_version}[]`; `cachedUpload(filePath, creds, cacheFile) -> Promise<string>` (returns `bs://` id); `bs.sh app ios|android [--fresh]`

- [ ] **Step 1: Write the failing test**

`tests/app.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`. Expected: app tests fail.

- [ ] **Step 3: Implement lib/app.mjs**

```js
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export function parseOsRange(spec) {
  const m = String(spec).trim().match(/^(>=|<=|>|<|==)?\s*([\d.]+)$/);
  if (!m) throw new Error(`bad os range: ${spec}`);
  const [, op = '==', num] = m;
  const want = parseFloat(num);
  return (v) => {
    const got = parseFloat(v);
    return op === '>=' ? got >= want : op === '<=' ? got <= want
      : op === '>' ? got > want : op === '<' ? got < want : Math.floor(got) === Math.floor(want);
  };
}

export function pickAppDevices(section, appDevices, platform) {
  const ranges = section.os.length ? section.os.map(parseOsRange) : [() => true];
  const picked = [];
  for (const name of section.devices) {
    const rows = appDevices.filter((d) => d.device === name && d.os === platform
      && ranges.some((ok) => ok(d.os_version)));
    for (const r of rows) picked.push({ device: r.device, os_version: r.os_version });
  }
  return picked;
}

export async function cachedUpload(filePath, creds, cacheFile) {
  const hash = createHash('sha256').update(readFileSync(filePath)).digest('hex');
  let cache = {};
  try { cache = JSON.parse(readFileSync(cacheFile, 'utf8')); } catch {}
  if (cache[hash]) return cache[hash];
  const form = new FormData();
  form.append('file', new Blob([readFileSync(filePath)]), path.basename(filePath));
  const res = await fetch('https://api-cloud.browserstack.com/app-automate/upload', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${creds.user}:${creds.key}`).toString('base64') },
    body: form,
  });
  const data = await res.json();
  if (!res.ok || !data.app_url) throw new Error(`upload failed: HTTP ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
  cache[hash] = data.app_url;
  mkdirSync(path.dirname(cacheFile), { recursive: true });
  writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
  return data.app_url;
}
```

- [ ] **Step 4: Implement lib/cli-app.mjs**

```js
import path from 'node:path';
import os from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadManifest } from './manifest.mjs';
import { fetchCapsData, credsFromEnv } from './capsdata.mjs';
import { pickAppDevices, cachedUpload } from './app.mjs';
import { runPool } from './pool.mjs';
import { formatMatrix } from './report.mjs';

const HUB = 'https://hub-cloud.browserstack.com/wd/hub';
const [projectDir, platform] = process.argv.slice(2);
if (!['ios', 'android'].includes(platform)) { console.error('usage: bs.sh app ios|android'); process.exit(1); }

const creds = credsFromEnv();
const manifest = loadManifest(projectDir);
const section = manifest.apps[platform];
if (!section) { console.error(`no [app.${platform}] in platforms.toml`); process.exit(1); }

const cacheDir = path.join(os.homedir(), '.cache/browserstack');
const { appDevices } = await fetchCapsData(creds, cacheDir);
const devices = pickAppDevices(section, appDevices, platform);
if (devices.length === 0) { console.error('no declared device matches the os ranges'); process.exit(2); }

const appUrl = section.app.startsWith('bs://') ? section.app
  : await cachedUpload(path.resolve(projectDir, section.app), creds, path.join(cacheDir, 'apps.json'));
console.error(`app: ${appUrl}`);

async function wd(method, p, body) {
  const res = await fetch(`${HUB}${p}`, { method, headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return data.value;
}

const shotsDir = path.join(projectDir, 'browserstack-shots', 'app');
mkdirSync(shotsDir, { recursive: true });

const results = await runPool(devices, 2, async (d) => {
  const label = `${d.device} (${platform} ${d.os_version})`;
  const caps = { capabilities: { alwaysMatch: {
    platformName: platform, 'appium:app': appUrl, 'appium:autoGrantPermissions': true,
    'bstack:options': { deviceName: d.device, osVersion: d.os_version,
      sessionName: `app smoke ${label}`, userName: creds.user, accessKey: creds.key },
  } } };
  const session = await wd('POST', '/session', caps);
  const id = session.sessionId;
  try {
    await new Promise((r) => setTimeout(r, 8000)); // let the app settle after autolaunch
    const png = await wd('GET', `/session/${id}/screenshot`);
    const file = path.join(shotsDir, `${label.replace(/[^\w.-]+/g, '_')}.png`);
    writeFileSync(file, Buffer.from(png, 'base64'));
    return { label, status: 'pass', detail: file };
  } finally {
    await wd('DELETE', `/session/${id}`).catch(() => {});
  }
});
console.log(formatMatrix(results));
if (results.some((r) => r.status !== 'pass')) process.exit(1);
```

`bs.sh`: `cmd_app() { creds; bootstrap; BROWSERSTACK_USERNAME=$BS_USER BROWSERSTACK_ACCESS_KEY=$BS_KEY node "$SKILL_DIR/lib/cli-app.mjs" "$PROJECT_DIR" "$@"; }` plus dispatch `app) shift; cmd_app "$@" ;;` and usage line `bs.sh app ios|android                launch smoke on declared devices`

- [ ] **Step 5: Run tests, then live smoke**

Run: `npm test`. Expected: all pass.

Live (Martin has no app binaries yet; use BrowserStack's public sample):

```bash
cd "$(mktemp -d)" && curl -sSLO https://www.browserstack.com/app-automate/sample-apps/android/WikipediaSample.apk
printf '[app.android]\napp = "WikipediaSample.apk"\ndevices = ["Samsung Galaxy S23"]\nos = [">= 13"]\n' > platforms.toml
/Users/martin/dev/skill-browserstack/bs.sh app android
```

Expected: upload once (second run hits the cache), one PASS row, a screenshot file. If the plan lacks App Automate, a clear HTTP 403 message; note it for Martin and keep the subcommand gated.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "app: cached upload and launch smoke on declared devices"
```

---

### Task 9: RED Baseline for the Skill Docs

**Files:**
- Create: `docs/superpowers/testing/2026-09-11-baseline.md`

**Interfaces:**
- Consumes: nothing (agents run without the skill)
- Produces: documented baseline failures that Task 10's SKILL.md must address

- [ ] **Step 1: Dispatch the baseline agent**

One general-purpose subagent, no mention of BrowserStack or the skill, budget ~12 tool calls:

> Task: verify that https://whoslive.today loads correctly on Safari 16 on macOS, Firefox latest on Windows, and a real Android phone. Provide per-browser evidence (title, screenshot, or rendering data). Your final text is a data report: methods attempted with exact commands, results per browser, honest assessment of coverage achieved.

- [ ] **Step 2: Document the baseline**

Write `docs/superpowers/testing/2026-09-11-baseline.md` recording verbatim: which tools the agent reached for, what coverage it actually achieved (expected: no Safari 16, no Windows, no Android available locally), and any workarounds it invented. These are the failures SKILL.md exists to fix.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "baseline: cross-browser check without the skill"
```

---

### Task 10: Skill Documents

**Files:**
- Create: `SKILL.md`, `webdriver-tail.md`, `app-smoke.md`
- Modify: `README.md` (full version), `/Users/martin/dev/skill-browserbase/SKILL.md` (cross-reference line)

**Interfaces:**
- Consumes: baseline findings from Task 9; every subcommand from Tasks 1-8
- Produces: the discoverable skill; description follows SDO rules (starts "Use when", triggering conditions only, no workflow summary)

- [ ] **Step 1: Write SKILL.md**

Frontmatter name `using-browserstack`. Description (adjust against baseline findings, keep triggers-only): "Use when functionality or rendering must be verified on browsers, browser versions, or real devices that are not on this machine: cross-browser compatibility checks, does-it-work-on Safari/Firefox/Android/iOS questions, a project's declared browser support matrix (platforms.toml), old browser versions, real-device app installs, or reaching localhost from a cloud browser through a tunnel. Wraps BrowserStack Automate, App Automate, Screenshots, and Local Testing."

Body sections, target under 500 words, Global Constraints style rules apply:

- Overview: manifest-driven; the project declares platforms in `platforms.toml`, `bs.sh` resolves and runs; core principle: check on what the project declares, not on what is convenient
- Routing (the cross-stack table from the spec, four rows: this skill, using-browserbase, Claude-in-Chrome, tunnel row)
- The Manifest: the full example from the spec (copy verbatim) plus one line on `"project"` inheritance
- Quick Reference: the `bs.sh` usage block (resolve, check, shots, app, tunnel, auth-check)
- Credentials: chain, never print, setup pointer
- Common Mistakes: rewritten from actual Task 9 baseline failures, plus: running checks when no `platforms.toml` exists (write one first with the user), forgetting that Screenshots/App Automate may be plan-gated, assuming the tunnel bypasses application-level password gates (it does not; it is network-level)

- [ ] **Step 2: Write webdriver-tail.md and app-smoke.md**

`webdriver-tail.md`: the WebDriver REST walkthrough for tail targets: hub URL, `webdriverPayload` shape, session create/navigate/title/screenshot/delete with curl examples, when scripts get `BS_WEBDRIVER_URL` + `BS_WD_PAYLOAD`. `app-smoke.md`: upload endpoint, `bs://` caching, Appium capabilities used, how to extend beyond the launch smoke (pointer to Appium docs, explicitly out of v1).

- [ ] **Step 3: Full README.md**

Same structure as skill-browserbase's README: what it is, install (clone + symlink `~/.claude/skills/using-browserstack`), credentials setup, contents list, license. Mention `platforms.toml` with a three-line example.

- [ ] **Step 4: Cross-reference in using-browserbase**

In `/Users/martin/dev/skill-browserbase/SKILL.md`, add one row to the routing table: `| Does it work on the browsers/devices we support | using-browserstack, not this skill |`. Commit and push that repo separately (its own commit message rules apply).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "skill docs: SKILL.md, tail and app references, README"
```

---

### Task 11: GREEN Verification and Refactor

**Files:**
- Create: `~/.claude/skills/using-browserstack` (symlink), `docs/superpowers/testing/2026-09-11-green.md`
- Modify: whatever the friction reports demand

**Interfaces:**
- Consumes: the complete skill; Task 9's scenario
- Produces: verified skill; documented GREEN results

- [ ] **Step 1: Symlink**

```bash
ln -sfn /Users/martin/dev/skill-browserstack ~/.claude/skills/using-browserstack
```

- [ ] **Step 2: Dispatch GREEN agents**

Two subagents, each given the skill listing entry (name + description + SKILL.md path) exactly as a real session would see it:

- Scenario 1 (Task 9 rerun): the whoslive.today three-browser verification, in a temp project seeded with a `platforms.toml` declaring `browserslist = ["safari 16.6", "firefox 130"]` and `devices = ["Samsung Galaxy S24"]`, `[web.check] url = "https://whoslive.today"`
- Scenario 2 (manifest authoring): "This project has no platforms.toml. Set up cross-browser checking for https://example.com supporting the last 2 Chrome versions and Safari 17." The agent must write a valid manifest and run `bs.sh resolve` and `bs.sh check`

Each reports: what it read, exact commands, results, friction. Pass criteria: routed through `bs.sh` (no local-browser workarounds), valid manifest, no credentials in output, sessions all closed.

- [ ] **Step 3: Refactor from friction**

Fix every documentation gap the agents hit (missing flag docs, unclear errors, wrong assumptions). Rerun a scenario only if a fix changes routing behavior; document results in `docs/superpowers/testing/2026-09-11-green.md`.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "green: verification results and doc fixes"
```

---

### Task 12: Publish

**Files:**
- Modify: none (publishing only)

**Interfaces:**
- Consumes: the finished repo
- Produces: public `cybernagl/skill-browserstack` on branch `main`

- [ ] **Step 1: Full test pass**

Run: `npm test` and `./bs.sh auth-check`. Expected: everything green.

- [ ] **Step 2: Leak scan**

```bash
cd /Users/martin/dev/skill-browserstack
U=$(sed -n 's/^username=//p' ~/.config/browserstack/credentials)
K=$(sed -n 's/^access_key=//p' ~/.config/browserstack/credentials)
git grep -I --cached -l -e "$K" -e "$U" && echo "LEAK, stop" || echo clean
git grep -I --cached -lE '[A-Za-z0-9]{20}' -- '*.json' '*.md' '*.sh' '*.mjs' | while read -r f; do echo "inspect: $f"; done
```

The first grep must print `clean`. Inspect any file the second one flags before pushing (lockfile integrity hashes are fine).

- [ ] **Step 3: Create repo and push**

```bash
gh repo create cybernagl/skill-browserstack --public --source=. --push \
  --description "Claude Code skill: check apps and websites on declared platforms via BrowserStack"
gh repo view cybernagl/skill-browserstack --json url,defaultBranchRef
open "https://github.com/cybernagl/skill-browserstack"
```

Branch is already `main` (Task 1). Expected: repo public, default branch `main`.

- [ ] **Step 4: Report**

Summarize to Martin: subcommand list, test evidence (RED/GREEN), any plan-gated features found (Screenshots, App Automate), and the follow-up (a `platforms.toml` PR for CrowdSurfer).

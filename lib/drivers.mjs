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

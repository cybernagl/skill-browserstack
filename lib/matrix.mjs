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
    // A chromium CDP client cannot drive iOS Safari, so ios web targets go
    // through the WebDriver tail (see webdriver-tail.md). Android stays on
    // Playwright: Chrome on Android is chromium.
    { majors: mapped.ios, want: isIphone, kind: 'ios', family: 'ios_saf', driver: 'webdriver' },
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

  // A device with no matching mobile family in browserslist never enters the
  // loop above at all, so it would otherwise vanish silently: neither a
  // target nor a gap. Surface it explicitly.
  for (const dev of manifest.web.devices) {
    const hasFamily = isIphone(dev) ? mapped.ios.length > 0 : mapped.android.length > 0;
    if (!hasFamily) {
      gaps.push({ entry: `device ${dev}`,
        reason: "declared in [web].devices but no mobile browserslist family (add e.g. 'ios_saf >= 17' or "
          + "'last 2 and_chr versions')" });
    }
  }
  return { targets, gaps };
}

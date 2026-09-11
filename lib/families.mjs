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

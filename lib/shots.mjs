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

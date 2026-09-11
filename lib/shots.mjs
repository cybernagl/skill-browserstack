const major = (v) => v ? parseInt(v, 10) : null;

// Returns { picked, unmatched }: unmatched carries the original targets so
// the caller can name each one it dropped, rather than reporting only a
// count.
export function pickShotBrowsers(targets, shotBrowsers) {
  const picked = [];
  const unmatched = [];
  for (const t of targets) {
    const hit = shotBrowsers.find((b) => t.kind === 'desktop'
      ? b.browser === t.browser && major(b.browser_version) === major(t.browser_version)
        && b.os === t.os && b.os_version === t.os_version
      : b.device === t.device && b.os_version === t.os_version);
    if (hit) picked.push(hit); else unmatched.push(t);
  }
  return { picked, unmatched };
}

// summarizeShots turns a Screenshots-API job's `screenshots` array into a
// pure, testable decision per entry: whether it is ready to download (`ok`)
// and, if so, the filename it should be saved under. Kept side-effect-free
// so the zero-yield decision (no entry has ok:true) is unit-testable
// without a network call.
export function summarizeShots(screenshots) {
  return (screenshots ?? []).map((s) => {
    const label = s.browser ?? s.device;
    const ok = s.state === 'done' && Boolean(s.image_url);
    const name = `${s.os}-${s.os_version}-${label}-${s.browser_version ?? ''}.png`.replace(/[^\w.-]+/g, '_');
    return { ok, label, state: s.state, image_url: s.image_url ?? null, name };
  });
}

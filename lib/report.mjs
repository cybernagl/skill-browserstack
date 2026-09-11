export function formatMatrix(results) {
  const width = Math.max(...results.map((r) => r.label.length));
  const lines = results.map((r) =>
    `${r.status === 'pass' ? 'PASS' : r.status === 'fail' ? 'FAIL' : 'ERR '}  ${r.label.padEnd(width)}  ${r.detail}`.trimEnd());
  const passed = results.filter((r) => r.status === 'pass').length;
  lines.push(`${passed}/${results.length} passed`);
  return lines.join('\n');
}

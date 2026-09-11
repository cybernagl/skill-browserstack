// parsePositiveInt validates a CLI flag value as a positive integer (>= 1).
// Kept pure and side-effect-free so the validation decision is unit-testable
// without spawning a process: returns the parsed integer on success, or
// null for anything that is not a plain positive integer (zero, negative,
// fractional, or non-numeric input all return null; the caller decides how
// to report that).
export function parsePositiveInt(raw) {
  const s = String(raw).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}

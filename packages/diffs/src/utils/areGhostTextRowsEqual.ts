/**
 * Whether two ghost text row maps (zero-based line -> row count) show the
 * same rows under the same lines. The editor replaces its map on every
 * change, so a different map is not by itself a change in height.
 */
export function areGhostTextRowsEqual(
  a: ReadonlyMap<number, number>,
  b: ReadonlyMap<number, number>
): boolean {
  if (a === b) {
    return true;
  }
  if (a.size !== b.size) {
    return false;
  }
  for (const [line, rows] of a) {
    if (b.get(line) !== rows) {
      return false;
    }
  }
  return true;
}

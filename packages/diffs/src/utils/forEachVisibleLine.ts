import type { LineRange } from '../types';

/**
 * Calls `visit` for each line in [startLine, endLine) outside the ordered
 * `hiddenRanges`, jumping over each hidden body in one step instead of testing
 * every line. Stops early when `visit` returns false. Layout scans and
 * windowed renders share this so they agree on which rows exist.
 */
export function forEachVisibleLine(
  hiddenRanges: readonly LineRange[],
  startLine: number,
  endLine: number,
  visit: (line: number) => boolean | void
): void {
  let rangeIndex = firstRangeEndingAtOrAfter(hiddenRanges, startLine);
  let line = startLine;
  while (line < endLine) {
    const range = hiddenRanges[rangeIndex];
    if (range != null && line >= range.startLine) {
      line = Math.max(line, range.endLine + 1);
      rangeIndex++;
      continue;
    }
    if (visit(line) === false) {
      return;
    }
    line++;
  }
}

// Binary search for the first ordered range that contains or follows `line`.
function firstRangeEndingAtOrAfter(
  ranges: readonly LineRange[],
  line: number
): number {
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const middle = low + ((high - low) >> 1);
    if (ranges[middle].endLine < line) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

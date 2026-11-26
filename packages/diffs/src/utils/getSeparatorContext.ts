import type { FileDiffMetadata, Hunk } from '../types';

/**
 * Returns the function/class name to show in the separator above the first
 * visible line of a hunk's leading gap.
 *
 * The `@@` header names the scope of the hunk's first line, as git computed
 * it. Revealing the lines just above the hunk moves the separator above them,
 * so the header's name stays correct only while the line it was taken from is
 * still collapsed. Once that line is visible, this falls back to git's default rule
 * on the file contents: the nearest line above that starts with a letter, `_`
 * or `$`.
 *
 * `side` and `firstVisibleIndex` locate the first line below the separator,
 * as a zero-based index into that side's line array.
 */
export function getSeparatorContext(
  diff: FileDiffMetadata,
  hunk: Hunk | undefined,
  side: 'deletions' | 'additions',
  firstVisibleIndex: number
): string | undefined {
  const headerContext = hunk?.hunkContext;
  if (hunk == null || headerContext == null || headerContext === '') {
    return undefined;
  }
  const hunkStart =
    side === 'deletions' ? hunk.deletionLineIndex : hunk.additionLineIndex;
  if (firstVisibleIndex >= hunkStart || diff.isPartial) {
    return headerContext;
  }
  const lines = side === 'deletions' ? diff.deletionLines : diff.additionLines;
  // git truncates the name it writes, so the source line only has to start
  // with it.
  for (let i = hunkStart - 1; i >= firstVisibleIndex; i--) {
    if (lines[i]?.startsWith(headerContext) === true) {
      return findDefaultContext(lines, firstVisibleIndex);
    }
  }
  return headerContext;
}

// The same rule as git's default funcname (xdiff's def_ff), searching up from
// the line above `beforeIndex`.
function findDefaultContext(
  lines: string[],
  beforeIndex: number
): string | undefined {
  for (let i = beforeIndex - 1; i >= 0; i--) {
    const line = lines[i];
    if (line != null && /^[A-Za-z_$]/.test(line)) {
      return line.trimEnd();
    }
  }
  return undefined;
}

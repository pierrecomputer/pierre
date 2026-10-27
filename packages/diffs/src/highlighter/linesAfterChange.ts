import type { TextDocumentChange } from '../editor/textDocument';

// Where a line of the document before `change` sits after it, or undefined
// when the edits rewrote it.
export function lineAfterChange(
  line: number,
  change: TextDocumentChange
): number | undefined {
  const ranges = lineRangesAfterChange([[line, line]], change);
  return ranges.length === 0 ? undefined : ranges[0][0];
}

// The lines of `ranges`, numbered as they are after `change`. Lines the
// edits rewrote are left out, so a range they cut through comes back in
// pieces. `ranges` are sorted and do not overlap. The edits come in the order
// and the coordinates of the document before them, and each one's effect on
// the line count is the document's own, which counts a line break that an
// edit completes or splits across its boundary correctly.
export function lineRangesAfterChange(
  ranges: readonly (readonly [number, number])[],
  change: TextDocumentChange
): [number, number][] {
  const { changes, changedLineChanges } = change;
  if (changedLineChanges == null && changes.length > 0) {
    throw new Error('lineRangesAfterChange: change has no line deltas');
  }
  const result: [number, number][] = [];
  for (const [first, last] of ranges) {
    let next = first;
    let shift = 0;
    for (const [index, { range }] of changes.entries()) {
      const delta = changedLineChanges?.[index][2] ?? 0;
      if (range.end.line < next) {
        shift += delta;
        continue;
      }
      if (range.start.line > last) {
        break;
      }
      if (next < range.start.line) {
        result.push([next + shift, range.start.line - 1 + shift]);
      }
      next = range.end.line + 1;
      shift += delta;
    }
    if (next <= last) {
      result.push([next + shift, last + shift]);
    }
  }
  return result;
}

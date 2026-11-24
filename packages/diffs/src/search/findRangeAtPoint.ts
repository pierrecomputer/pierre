// Finds which of a row's painted ranges is under a point, by measuring them.
// Used only where the browser lacks `CSS.highlights.highlightsFromPoint`
// (currently only Safari before 27.3).
//
// `entries` holds each row's ranges together and in reading order, so a binary
// search measures only a few of them, even in a row that holds thousands.
export function findRangeAtPoint<
  TEntry extends { range: Range; row: HTMLElement },
>(
  entries: readonly TEntry[],
  row: HTMLElement,
  clientX: number,
  clientY: number
): TEntry | undefined {
  let start = entries.findIndex((entry) => entry.row === row);
  if (start < 0) return undefined;
  let end = entries.length;
  while (start < end) {
    const middle = Math.floor((start + end) / 2);
    const entry = entries[middle];
    if (entry.row !== row) {
      end = middle;
      continue;
    }
    const rects = entry.range.getClientRects();
    if (rects.length === 0) return undefined;
    const first = rects[0];
    const last = rects[rects.length - 1];
    if (
      clientY >= last.bottom ||
      (clientY >= last.top && clientX >= last.right)
    ) {
      start = middle + 1;
    } else if (
      clientY < first.top ||
      (clientY < first.bottom && clientX < first.left)
    ) {
      end = middle;
    } else {
      // A match that wraps has a piece on each visual line. A point in the
      // empty space beside one of them is not on the match.
      for (const rect of rects) {
        if (
          clientX >= rect.left &&
          clientX < rect.right &&
          clientY >= rect.top &&
          clientY < rect.bottom
        ) {
          return entry;
        }
      }
      return undefined;
    }
  }
  return undefined;
}

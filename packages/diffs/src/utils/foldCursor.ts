import type { FileDiffMetadata, Hunk, SemanticDiffFold } from '../types';
import { getHunkSideStartBoundary } from './getHunkSideBoundaries';

// A place in a diff's list of semantic folds, for code that goes through the
// diff's hunks in order. The folds are in old-line order, so each hunk's
// folds follow the folds of the hunk before it. A fold is closed unless its
// first old line is in `openSemanticFolds`.
export interface FoldCursor {
  folds: readonly SemanticDiffFold[];
  openSemanticFolds: ReadonlySet<number>;
  /** Index of the first fold that is not in a hunk already gone past. */
  index: number;
  /**
   * Whether a closed fold hides the last old line of the hunk last gone
   * past. That line's "No newline at end of file" marker is then not shown.
   */
  hidesLastOldLine: boolean;
}

// A cursor at the diff's first fold, or undefined when the diff has no folds
// or `openSemanticFolds` was left out, which shows every line.
export function createFoldCursor(
  { semanticFolds }: FileDiffMetadata,
  openSemanticFolds: ReadonlySet<number> | undefined
): FoldCursor | undefined {
  return semanticFolds != null && openSemanticFolds != null
    ? {
        folds: semanticFolds,
        openSemanticFolds,
        index: 0,
        hidesLastOldLine: false,
      }
    : undefined;
}

// Counts the rows the hunk's closed folds hide, and moves the cursor past the
// hunk's folds. A closed fold shows one row for all of its old lines, so
// every line after its first is hidden, in the split and the unified view
// alike.
export function takeHiddenRows(cursor: FoldCursor, hunk: Hunk): number {
  const { folds, openSemanticFolds } = cursor;
  cursor.hidesLastOldLine = false;
  if (cursor.index >= folds.length) {
    return 0;
  }
  const lastOldLine =
    getHunkSideStartBoundary(hunk.deletionStart, hunk.deletionCount) +
    hunk.deletionCount;
  let hiddenRows = 0;
  for (
    let fold = folds[cursor.index];
    fold != null && fold.old.start <= lastOldLine;
    fold = folds[++cursor.index]
  ) {
    if (!openSemanticFolds.has(fold.old.start)) {
      hiddenRows += fold.old.end - fold.old.start;
      cursor.hidesLastOldLine = fold.old.end === lastOldLine;
    }
  }
  return hiddenRows;
}

import type { Hunk } from '../types';
import { getHunkSideEndBoundary } from './getHunkSideBoundaries';

export function getTotalLineCountFromHunks(hunks: Hunk[]): number {
  const lastHunk = hunks.at(-1);
  if (lastHunk == null) {
    return 0;
  }
  return Math.max(
    getHunkSideEndBoundary(lastHunk.additionStart, lastHunk.additionCount),
    getHunkSideEndBoundary(lastHunk.deletionStart, lastHunk.deletionCount)
  );
}

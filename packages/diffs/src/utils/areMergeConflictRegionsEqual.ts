import type { MergeConflictRegion } from '../types';

export function areMergeConflictRegionsEqual(
  a: MergeConflictRegion,
  b: MergeConflictRegion
): boolean {
  return (
    a.conflictIndex === b.conflictIndex &&
    a.startLineIndex === b.startLineIndex &&
    a.separatorLineIndex === b.separatorLineIndex &&
    a.endLineIndex === b.endLineIndex &&
    a.baseMarkerLineIndex === b.baseMarkerLineIndex
  );
}

import type { MergeConflictRegion } from '../types';
import type { MergeConflictDiffAction } from './parseMergeConflictDiffFromFile';

export function areMergeConflictActionsEqual(
  a: MergeConflictDiffAction,
  b: MergeConflictDiffAction
): boolean {
  return (
    a.actionOriginalLineIndex === b.actionOriginalLineIndex &&
    a.actionOriginalLineNumber === b.actionOriginalLineNumber &&
    a.currentLineNumber === b.currentLineNumber &&
    a.incomingLineNumber === b.incomingLineNumber &&
    a.conflictIndex === b.conflictIndex &&
    areConflictsEqual(a.conflict, b.conflict)
  );
}

function areConflictsEqual(a: MergeConflictRegion, b: MergeConflictRegion) {
  return (
    a.conflictIndex === b.conflictIndex &&
    a.startLineIndex === b.startLineIndex &&
    a.startLineNumber === b.startLineNumber &&
    a.separatorLineIndex === b.separatorLineIndex &&
    a.separatorLineNumber === b.separatorLineNumber &&
    a.endLineIndex === b.endLineIndex &&
    a.endLineNumber === b.endLineNumber &&
    a.baseMarkerLineIndex === b.baseMarkerLineIndex &&
    a.baseMarkerLineNumber === b.baseMarkerLineNumber
  );
}

import type { MergeConflictRegion } from '../types';
import type { MergeConflictDiffAction } from './parseMergeConflictDiffFromFile';

export function areMergeConflictActionsEqual(
  a: MergeConflictDiffAction,
  b: MergeConflictDiffAction
): boolean {
  return (
    a.hunkIndex === b.hunkIndex &&
    a.startContextIndex === b.startContextIndex &&
    a.currentChangeIndex === b.currentChangeIndex &&
    a.baseMarkerContextIndex === b.baseMarkerContextIndex &&
    a.baseChangeIndex === b.baseChangeIndex &&
    a.separatorContextIndex === b.separatorContextIndex &&
    a.incomingChangeIndex === b.incomingChangeIndex &&
    a.endContextIndex === b.endContextIndex &&
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

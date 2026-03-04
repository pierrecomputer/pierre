import type { AnnotationSide } from '../types';

interface MergeConflictActionSlotInput {
  side: AnnotationSide;
  lineNumber: number;
  conflictIndex: number;
}

export function getMergeConflictActionSlotName({
  side,
  lineNumber,
  conflictIndex,
}: MergeConflictActionSlotInput): string {
  return `merge-conflict-action-${side}-${lineNumber}-${conflictIndex}`;
}

interface MergeConflictActionSlotInput {
  hunkIndex: number;
  lineIndex: number;
  conflictIndex: number;
}

export function getMergeConflictActionSlotName({
  hunkIndex,
  lineIndex,
  conflictIndex,
}: MergeConflictActionSlotInput): string {
  return `merge-conflict-action-${hunkIndex}-${lineIndex}-${conflictIndex}`;
}

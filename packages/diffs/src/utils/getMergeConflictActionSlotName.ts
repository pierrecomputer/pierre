import type { MergeConflictRegion } from '../types';

export function getMergeConflictActionSlotName(
  conflict: Pick<MergeConflictRegion, 'conflictIndex'>
): string {
  return `merge-conflict-action-${conflict.conflictIndex}`;
}

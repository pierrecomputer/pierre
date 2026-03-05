import type { MergeConflictMetadata } from '../types';

export function areMergeConflictActionMetadataEqual(
  a: MergeConflictMetadata,
  b: MergeConflictMetadata
): boolean {
  return (
    a.type === b.type &&
    a.side === b.side &&
    a.lineNumber === b.lineNumber &&
    a.lineIndex === b.lineIndex &&
    a.conflict === b.conflict
  );
}

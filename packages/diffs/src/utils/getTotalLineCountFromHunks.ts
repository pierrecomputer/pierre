import type { Hunk } from '../types';

export function getTotalLineCountFromHunks(hunks: Hunk[]): number {
  const lastHunk = hunks.at(-1);
  if (lastHunk == null) {
    return 0;
  }
  return Math.max(
    lastHunk.additionStart + lastHunk.additionCount,
    lastHunk.deletionStart + lastHunk.deletionCount
  );
}

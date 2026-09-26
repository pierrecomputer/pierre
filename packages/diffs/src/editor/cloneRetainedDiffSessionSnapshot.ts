import { cloneHunks } from '../utils/cloneFileDiffMetadata';
import type { RetainedDiffSessionSnapshot } from './types';

export function cloneRetainedDiffSessionSnapshot(
  snapshot: RetainedDiffSessionSnapshot
): RetainedDiffSessionSnapshot {
  return {
    ...snapshot,
    oldFile:
      snapshot.oldFile != null
        ? { ...snapshot.oldFile, lines: [...snapshot.oldFile.lines] }
        : null,
    hunks: cloneHunks(snapshot.hunks),
  };
}

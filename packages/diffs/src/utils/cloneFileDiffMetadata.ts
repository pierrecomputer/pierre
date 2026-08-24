import type {
  FileDiffMetadata,
  Hunk,
  RetainedDiffSessionSnapshot,
} from '../types';

export function cloneHunks(hunks: Hunk[]): Hunk[] {
  return hunks.map((hunk) => ({
    ...hunk,
    hunkContent: hunk.hunkContent.map((content) => ({ ...content })),
  }));
}

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

export function cloneFileDiffMetadata(
  fileDiff: FileDiffMetadata
): FileDiffMetadata {
  return {
    ...fileDiff,
    hunks: cloneHunks(fileDiff.hunks),
    deletionLines: [...fileDiff.deletionLines],
    additionLines: [...fileDiff.additionLines],
  };
}

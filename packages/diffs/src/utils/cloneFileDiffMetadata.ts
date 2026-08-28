import type {
  FileDiffMetadata,
  Hunk,
} from '../types';

export function cloneHunks(hunks: Hunk[]): Hunk[] {
  return hunks.map((hunk) => ({
    ...hunk,
    hunkContent: hunk.hunkContent.map((content) => ({ ...content })),
  }));
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

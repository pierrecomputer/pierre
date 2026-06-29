import type { FileDiffMetadata } from '../types';

export function cloneFileDiffMetadata(
  fileDiff: FileDiffMetadata
): FileDiffMetadata {
  return {
    ...fileDiff,
    hunks: fileDiff.hunks.map((hunk) => ({
      ...hunk,
      hunkContent: hunk.hunkContent.map((content) => ({ ...content })),
    })),
    deletionLines: [...fileDiff.deletionLines],
    additionLines: [...fileDiff.additionLines],
  };
}

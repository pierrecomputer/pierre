import type { FileDiffMetadata } from '../types';
import { cloneLines } from './diffLines';

export function cloneFileDiffMetadata(
  fileDiff: FileDiffMetadata
): FileDiffMetadata {
  return {
    ...fileDiff,
    hunks: fileDiff.hunks.map((hunk) => ({
      ...hunk,
      hunkContent: hunk.hunkContent.map((content) => ({ ...content })),
    })),
    deletionLines: cloneLines(fileDiff.deletionLines),
    additionLines: cloneLines(fileDiff.additionLines),
  };
}

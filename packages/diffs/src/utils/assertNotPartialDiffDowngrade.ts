import type { FileDiffMetadata } from '../types';

export function assertNotPartialDiffDowngrade(
  currentFileDiff: FileDiffMetadata | undefined,
  nextFileDiff: FileDiffMetadata | undefined,
  context: string
): void {
  if (
    currentFileDiff?.isPartial === false &&
    nextFileDiff?.isPartial === true
  ) {
    throw new Error(
      `${context}: Cannot replace a full diff with a partial diff on the same instance.`
    );
  }
}

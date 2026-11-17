import type { FileDiffMetadata } from '../types';

// Whether one side's last line ends with a newline, so an empty line follows
// it. A partial diff only knows that from its patch's "\ No newline at end of
// file" marker on the last hunk; a full diff has the file's real last line.
export function endsWithNewline(
  diff: FileDiffMetadata,
  side: 'additions' | 'deletions'
): boolean {
  const lines = side === 'additions' ? diff.additionLines : diff.deletionLines;
  if (lines.length === 0) {
    return false;
  }
  if (diff.isPartial) {
    const lastHunk = diff.hunks.at(-1);
    return (
      lastHunk != null &&
      !(side === 'additions'
        ? lastHunk.noEOFCRAdditions
        : lastHunk.noEOFCRDeletions)
    );
  }
  return lines.at(-1)?.endsWith('\n') === true;
}

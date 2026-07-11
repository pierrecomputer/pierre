import type { ChangeContent, ContextContent, FileDiffMetadata } from '../types';

// The diff library emits one change block per replaced run, ordering every
// deleted line before every added line. Renderers pair a block's lines
// positionally (deletion[i] across from addition[i] in split view), so a
// block like { deletions: 1, additions: 2 } pairs the deleted line with
// whichever addition happens to come first — even when a later addition is
// the edited version of it (e.g. pressing Enter above a changed line pushes
// a blank line in front of it). These helpers re-split such blocks so the
// most similar lines pair up and the surplus renders as pure insert/delete
// rows at the block's edges.

// Skip realignment when a block would need more than this many line
// comparisons; pathological blocks keep the library's positional pairing.
const MAX_ALIGNMENT_COMPARISONS = 4096;

// A shifted pairing must beat the positional one by this much per paired
// line before the block is re-split. Near-ties (e.g. lines that merely share
// an import-statement shape) keep the library's canonical order; the
// realignment is meant for decisive wins like a blank or unrelated inserted
// line displacing an edited one, where the gap approaches 1.
const MIN_IMPROVEMENT_PER_PAIR = 0.5;

/**
 * Re-split count-mismatched change blocks in every hunk so paired lines are
 * chosen by content similarity instead of position. Mutates `hunks` in
 * place; rendered row counts are unchanged (a split block covers the same
 * split/unified rows as the original).
 */
export function realignChangeContentBySimilarity(
  diff: Pick<FileDiffMetadata, 'hunks' | 'additionLines' | 'deletionLines'>
): void {
  for (const hunk of diff.hunks) {
    for (let index = 0; index < hunk.hunkContent.length; index++) {
      const content = hunk.hunkContent[index];
      if (content.type !== 'change') {
        continue;
      }
      const replacement = realignChangeBlock(diff, content);
      if (replacement != null) {
        hunk.hunkContent.splice(index, 1, ...replacement);
        index += replacement.length - 1;
      }
    }
  }
}

// Returns the split blocks for one change block, or null when the block is
// balanced, too large to scan, or already best paired positionally.
function realignChangeBlock(
  diff: Pick<FileDiffMetadata, 'additionLines' | 'deletionLines'>,
  content: ChangeContent
): (ContextContent | ChangeContent)[] | null {
  const { deletions, additions, deletionLineIndex, additionLineIndex } =
    content;
  const pairCount = Math.min(deletions, additions);
  const surplus = Math.abs(additions - deletions);
  if (
    pairCount === 0 ||
    surplus === 0 ||
    pairCount * (surplus + 1) > MAX_ALIGNMENT_COMPARISONS
  ) {
    return null;
  }

  // Whitespace (indentation, formatter churn, trailing spaces, the line
  // break itself) is noise for deciding which lines pair — the rendered diff
  // still shows every whitespace change on the paired row. Strip it once per
  // line here rather than per comparison.
  const strippedDeletions: string[] = [];
  for (let line = 0; line < deletions; line++) {
    strippedDeletions.push(
      stripWhitespace(diff.deletionLines[deletionLineIndex + line] ?? '')
    );
  }
  const strippedAdditions: string[] = [];
  for (let line = 0; line < additions; line++) {
    strippedAdditions.push(
      stripWhitespace(diff.additionLines[additionLineIndex + line] ?? '')
    );
  }

  // Score every offset of the shorter side along the longer side and keep
  // the best one only when it decisively beats the positional pairing.
  const additionsAreLonger = additions > deletions;
  let bestOffset = 0;
  let bestScore = -1;
  for (let offset = 0; offset <= surplus; offset++) {
    let score = 0;
    for (let pair = 0; pair < pairCount; pair++) {
      score += lineSimilarity(
        strippedDeletions[pair + (additionsAreLonger ? 0 : offset)],
        strippedAdditions[pair + (additionsAreLonger ? offset : 0)]
      );
    }
    if (offset === 0) {
      bestScore = score + pairCount * MIN_IMPROVEMENT_PER_PAIR;
    } else if (score > bestScore) {
      bestScore = score;
      bestOffset = offset;
    }
  }
  if (bestOffset === 0) {
    return null;
  }

  const blocks: ChangeContent[] = [];
  const pushBlock = (
    blockDeletions: number,
    blockAdditions: number,
    blockDeletionIndex: number,
    blockAdditionIndex: number
  ) => {
    if (blockDeletions > 0 || blockAdditions > 0) {
      blocks.push({
        type: 'change',
        deletions: blockDeletions,
        additions: blockAdditions,
        deletionLineIndex: blockDeletionIndex,
        additionLineIndex: blockAdditionIndex,
      });
    }
  };
  if (additionsAreLonger) {
    pushBlock(0, bestOffset, deletionLineIndex, additionLineIndex);
    pushBlock(
      pairCount,
      pairCount,
      deletionLineIndex,
      additionLineIndex + bestOffset
    );
    pushBlock(
      0,
      additions - pairCount - bestOffset,
      deletionLineIndex + pairCount,
      additionLineIndex + bestOffset + pairCount
    );
  } else {
    pushBlock(bestOffset, 0, deletionLineIndex, additionLineIndex);
    pushBlock(
      pairCount,
      pairCount,
      deletionLineIndex + bestOffset,
      additionLineIndex
    );
    pushBlock(
      deletions - pairCount - bestOffset,
      0,
      deletionLineIndex + bestOffset + pairCount,
      additionLineIndex + pairCount
    );
  }
  return blocks;
}

const WHITESPACE = /\s+/g;

function stripWhitespace(line: string): string {
  return line.replace(WHITESPACE, '');
}

// Cheap 0..1 similarity over whitespace-stripped lines: shared prefix plus
// shared suffix over the longer length. Exact for lines that differ only in
// whitespace, 0 for a blank against content — enough to steer pairing
// without a real edit-distance pass.
function lineSimilarity(a: string, b: string): number {
  if (a === b) {
    return 1;
  }
  const maxLength = Math.max(a.length, b.length);
  const minLength = Math.min(a.length, b.length);
  if (minLength === 0) {
    return 0;
  }
  let prefix = 0;
  while (prefix < minLength && a[prefix] === b[prefix]) {
    prefix++;
  }
  let suffix = 0;
  while (
    suffix < minLength - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++;
  }
  return (prefix + suffix) / maxLength;
}

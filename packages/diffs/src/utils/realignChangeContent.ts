import type {
  ChangeContent,
  ContextContent,
  FileDiffMetadata,
  Hunk,
} from '../types';

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
 * chosen by content similarity instead of position, then slide blank-line
 * insert/delete blocks to the top of their blank run. Mutates `hunks` in
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
    slideBlankBoundaryBlocksUp(hunk, diff);
  }
}

/**
 * Slide pure insert/delete blocks made entirely of blank lines to the top of
 * the blank run they sit in. Adding or removing a blank line next to
 * existing blanks is ambiguous, and the diff library reports the change at
 * the run's bottom — so pressing Enter at the end of a line marks a blank
 * *below* the caret as inserted while the caret's own new line renders as
 * context. Sliding up anchors the change to the content above it (the caret
 * line after an Enter) instead. Non-blank blocks never slide, so code that
 * merely ends like its neighbor (an added function before an identical `}`)
 * keeps the library's canonical position. Runs on final assembled
 * hunkContent: from the parse post-pass above and from the edit session's
 * region re-diff, so mid-session and exit renderings agree.
 */
export function slideBlankBoundaryBlocksUp(
  hunk: Hunk,
  diff: Pick<FileDiffMetadata, 'additionLines' | 'deletionLines'>
): void {
  const { hunkContent } = hunk;
  for (let index = 1; index < hunkContent.length; index++) {
    const block = hunkContent[index];
    const previous = hunkContent[index - 1];
    if (
      block.type !== 'change' ||
      (block.additions > 0 && block.deletions > 0) ||
      previous.type !== 'context'
    ) {
      continue;
    }
    const isInsert = block.additions > 0;
    const lines = isInsert ? diff.additionLines : diff.deletionLines;
    const blockStart = isInsert
      ? block.additionLineIndex
      : block.deletionLineIndex;
    const blockLength = isInsert ? block.additions : block.deletions;

    // Sliding through identical lines is only well-defined when the block is
    // a uniform run; require every block line to equal the first one, and
    // that line to be blank.
    const unit = lines[blockStart] ?? '';
    if (unit.trim() !== '') {
      continue;
    }
    let uniform = true;
    for (let offset = 1; offset < blockLength; offset++) {
      if (lines[blockStart + offset] !== unit) {
        uniform = false;
        break;
      }
    }
    if (!uniform) {
      continue;
    }

    // Slide distance: how many trailing context lines match the block's line
    // exactly (context lines are identical on both sides by definition).
    let slide = 0;
    while (
      slide < previous.lines &&
      diff.additionLines[
        previous.additionLineIndex + previous.lines - 1 - slide
      ] === unit
    ) {
      slide++;
    }
    if (slide === 0) {
      continue;
    }

    block.additionLineIndex -= slide;
    block.deletionLineIndex -= slide;
    const blockAdditionEnd = block.additionLineIndex + block.additions;
    const blockDeletionEnd = block.deletionLineIndex + block.deletions;
    const next = hunkContent[index + 1];
    if (next?.type === 'context') {
      next.lines += slide;
      next.additionLineIndex = blockAdditionEnd;
      next.deletionLineIndex = blockDeletionEnd;
    } else {
      hunkContent.splice(index + 1, 0, {
        type: 'context',
        lines: slide,
        additionLineIndex: blockAdditionEnd,
        deletionLineIndex: blockDeletionEnd,
      });
    }
    previous.lines -= slide;
    if (previous.lines === 0) {
      hunkContent.splice(index - 1, 1);
      index--;
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

import { type ChangeObject, diffChars, diffWordsWithSpace } from 'diff';

import type { LineDiffTypes } from '../types';
import { cleanLastNewline } from './cleanLastNewline';
import { pushOrJoinSpan } from './parseDiffDecorations';

/** Start and end column of changed text in a line. The end is exclusive. */
export type LineDiffRange = readonly [start: number, end: number];

export interface LineDiffRanges {
  readonly deletion: readonly LineDiffRange[];
  readonly addition: readonly LineDiffRange[];
}

// Returned whenever a line pair has nothing to highlight.
const NO_RANGES: LineDiffRanges = Object.freeze({
  deletion: Object.freeze([]),
  addition: Object.freeze([]),
});

/**
 * Compares an old line with its new version and returns which parts of each
 * one changed, as column ranges. Returns no ranges when `lineDiffType` is
 * 'none' or when either line is longer than `maxLineDiffLength`.
 */
export function computeLineDiffRanges(
  deletionLine: string,
  additionLine: string,
  lineDiffType: LineDiffTypes,
  maxLineDiffLength: number
): LineDiffRanges {
  if (lineDiffType === 'none') {
    return NO_RANGES;
  }
  // Lines are shown without their trailing newline, so leave it out of the
  // comparison.
  deletionLine = cleanLastNewline(deletionLine);
  additionLine = cleanLastNewline(additionLine);
  // Skip very long lines, because comparing them is slow.
  if (
    deletionLine.length > maxLineDiffLength ||
    additionLine.length > maxLineDiffLength
  ) {
    return NO_RANGES;
  }
  const lineDiff =
    lineDiffType === 'char'
      ? diffChars(deletionLine, additionLine)
      : diffWordsWithSpace(deletionLine, additionLine);
  if (lineDiffType === 'word-line') {
    return getWordLineRanges(lineDiff);
  }
  const deletionSpans: [0 | 1, string][] = [];
  const additionSpans: [0 | 1, string][] = [];
  const enableJoin = lineDiffType === 'word-alt';
  const lastItem = lineDiff.at(-1);
  for (const item of lineDiff) {
    const isLastItem = item === lastItem;
    if (!item.added && !item.removed) {
      pushOrJoinSpan({
        item,
        arr: deletionSpans,
        enableJoin,
        isNeutral: true,
        isLastItem,
      });
      pushOrJoinSpan({
        item,
        arr: additionSpans,
        enableJoin,
        isNeutral: true,
        isLastItem,
      });
    } else if (item.removed) {
      pushOrJoinSpan({ item, arr: deletionSpans, enableJoin, isLastItem });
    } else {
      pushOrJoinSpan({ item, arr: additionSpans, enableJoin, isLastItem });
    }
  }
  return {
    deletion: getSpanRanges(deletionSpans),
    addition: getSpanRanges(additionSpans),
  };
}

// Turns a list of changed (1) and unchanged (0) text pieces into ranges for
// the changed ones.
function getSpanRanges(spans: [0 | 1, string][]): LineDiffRange[] {
  const ranges: LineDiffRange[] = [];
  let spanIndex = 0;
  for (const [changed, value] of spans) {
    if (changed === 1) {
      ranges.push([spanIndex, spanIndex + value.length]);
    }
    spanIndex += value.length;
  }
  return ranges;
}

// For 'word-line': returns one range per side, from the first change to the
// last, so each line gets a single highlight.
function getWordLineRanges(lineDiff: ChangeObject<string>[]): LineDiffRanges {
  let deletionOffset = 0;
  let additionOffset = 0;
  let deletionStart = -1;
  let deletionEnd = 0;
  let additionStart = -1;
  let additionEnd = 0;
  for (const { value, added, removed } of lineDiff) {
    if (removed) {
      if (deletionStart === -1) deletionStart = deletionOffset;
      deletionOffset += value.length;
      deletionEnd = deletionOffset;
    } else if (added) {
      if (additionStart === -1) additionStart = additionOffset;
      additionOffset += value.length;
      additionEnd = additionOffset;
    } else {
      deletionOffset += value.length;
      additionOffset += value.length;
    }
  }
  return {
    deletion: deletionStart !== -1 ? [[deletionStart, deletionEnd]] : [],
    addition: additionStart !== -1 ? [[additionStart, additionEnd]] : [],
  };
}

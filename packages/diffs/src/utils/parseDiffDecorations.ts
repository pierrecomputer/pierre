import { type ChangeObject, diffChars, diffWordsWithSpace } from 'diff';

import type { DecorationItem, LineDiffTypes } from '../types';
import { cleanLastNewline } from './cleanLastNewline';

interface CreateDiffSpanDecorationProps {
  line: number;
  spanStart: number;
  spanLength: number;
}

export function createDiffSpanDecoration({
  line,
  spanStart,
  spanLength,
}: CreateDiffSpanDecorationProps): DecorationItem {
  return {
    start: { line, character: spanStart },
    end: { line, character: spanStart + spanLength },
    properties: { 'data-diff-span': '' },
    alwaysWrap: true,
  };
}

interface PushOrJoinSpanProps {
  item: ChangeObject<string>;
  arr: [0 | 1, string][];
  enableJoin: boolean;
  isNeutral?: boolean;
  isLastItem?: boolean;
}

// For diff decoration spans, we want to be sure that if there is a single
// white-space gap between diffs that we join them together into a longer diff span.
// Spans are basically just a tuple - 1 means the content should be
// highlighted, 0 means it should not, we still need to the span data to figure
// out span positions
export function pushOrJoinSpan({
  item,
  arr,
  enableJoin,
  isNeutral = false,
  isLastItem = false,
}: PushOrJoinSpanProps): void {
  const lastItem = arr[arr.length - 1];
  if (lastItem == null || isLastItem || !enableJoin) {
    arr.push([isNeutral ? 0 : 1, item.value]);
    return;
  }
  const isLastItemNeutral = lastItem[0] === 0;
  if (
    isNeutral === isLastItemNeutral ||
    // If we have a single space neutral item, lets join it to a previous
    // space non-neutral item to avoid single space gaps
    (isNeutral && item.value.length === 1 && !isLastItemNeutral)
  ) {
    lastItem[1] += item.value;
    return;
  }
  arr.push([isNeutral ? 0 : 1, item.value]);
}

interface ProcessLineDiffProps {
  deletionLine: string | undefined;
  additionLine: string | undefined;
  deletionLineIndex: number;
  additionLineIndex: number;
  deletionDecorations: DecorationItem[];
  additionDecorations: DecorationItem[];
  lineDiffType: LineDiffTypes;
  maxLineDiffLength: number;
}

/** Calculate changed UTF-16 ranges for a paired deletion and addition line. */
export function computeLineDiffDecorations({
  deletionLine,
  additionLine,
  deletionLineIndex,
  additionLineIndex,
  deletionDecorations,
  additionDecorations,
  lineDiffType,
  maxLineDiffLength,
}: ProcessLineDiffProps): void {
  if (deletionLine == null || additionLine == null || lineDiffType === 'none') {
    return;
  }
  deletionLine = cleanLastNewline(deletionLine);
  additionLine = cleanLastNewline(additionLine);
  // If we have really long lines, we probably shouldn't compute diffs on them.
  if (
    deletionLine.length > maxLineDiffLength ||
    additionLine.length > maxLineDiffLength
  ) {
    return;
  }
  // NOTE(amadeus): Because we visually trim trailing newlines when rendering,
  // we also gotta make sure the diff parsing doesn't include the newline
  // character that could be there...
  const lineDiff =
    lineDiffType === 'char'
      ? diffChars(deletionLine, additionLine)
      : diffWordsWithSpace(deletionLine, additionLine);
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
  let spanIndex = 0;
  for (const span of deletionSpans) {
    if (span[0] === 1) {
      deletionDecorations.push(
        createDiffSpanDecoration({
          line: deletionLineIndex,
          spanStart: spanIndex,
          spanLength: span[1].length,
        })
      );
    }
    spanIndex += span[1].length;
  }
  spanIndex = 0;
  for (const span of additionSpans) {
    if (span[0] === 1) {
      additionDecorations.push(
        createDiffSpanDecoration({
          line: additionLineIndex,
          spanStart: spanIndex,
          spanLength: span[1].length,
        })
      );
    }
    spanIndex += span[1].length;
  }
}

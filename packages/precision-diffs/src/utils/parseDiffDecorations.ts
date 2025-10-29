import { type ChangeObject, diffChars, diffWordsWithSpace } from 'diff';

import type { ChangeHunk, DecorationItem, LineDifftypes } from '../types';

interface ParseDecorationsProps {
  diffGroups: ChangeHunk[];
  disableDecorations?: boolean;
  lineDiffType: LineDifftypes;
  maxLineDiffLength: number;
  diffStyle: 'unified' | 'split';
}

interface ParseDecorationsReturn {
  unifiedDecorations: DecorationItem[];
  deletionDecorations: DecorationItem[];
  additionDecorations: DecorationItem[];
}

export function parseDecorations({
  diffGroups,
  disableDecorations = false,
  lineDiffType,
  maxLineDiffLength,
  diffStyle,
}: ParseDecorationsProps): ParseDecorationsReturn {
  const unified = diffStyle === 'unified';
  const unifiedDecorations: DecorationItem[] = [];
  const additionDecorations: DecorationItem[] = [];
  const deletionDecorations: DecorationItem[] = [];
  if (disableDecorations || lineDiffType === 'none') {
    return { unifiedDecorations, deletionDecorations, additionDecorations };
  }
  for (const group of diffGroups) {
    const len = Math.min(
      group.additionLines.length,
      group.deletionLines.length
    );
    for (let i = 0; i < len; i++) {
      const deletionLine = group.deletionLines[i];
      const additionLine = group.additionLines[i];
      if (deletionLine == null || additionLine == null) {
        break;
      }
      // Lets skep running diffs on super long lines because it's probably
      // expensive and hard to follow
      if (
        deletionLine.length > maxLineDiffLength ||
        additionLine.length > maxLineDiffLength
      ) {
        continue;
      }
      const lineDiff =
        lineDiffType === 'char'
          ? diffChars(deletionLine, additionLine)
          : diffWordsWithSpace(deletionLine, additionLine);
      const deletionSpans: [0 | 1, string][] = [];
      const additionSpans: [0 | 1, string][] = [];
      const enableJoin = lineDiffType === 'word-alt';
      for (const item of lineDiff) {
        if (!item.added && !item.removed) {
          pushOrJoinSpan({
            item,
            arr: deletionSpans,
            enableJoin,
            isNeutral: true,
          });
          pushOrJoinSpan({
            item,
            arr: additionSpans,
            enableJoin,
            isNeutral: true,
          });
        } else if (item.removed) {
          pushOrJoinSpan({ item, arr: deletionSpans, enableJoin });
        } else {
          pushOrJoinSpan({ item, arr: additionSpans, enableJoin });
        }
      }
      let spanIndex = 0;
      for (const span of additionSpans) {
        if (span[0] === 1) {
          (unified ? unifiedDecorations : additionDecorations).push(
            createDiffSpanDecoration({
              line: group.additionStartIndex + i,
              spanStart: spanIndex,
              spanLength: span[1].length,
            })
          );
        }
        spanIndex += span[1].length;
      }
      spanIndex = 0;
      for (const span of deletionSpans) {
        if (span[0] === 1) {
          (unified ? unifiedDecorations : deletionDecorations).push(
            createDiffSpanDecoration({
              line: group.deletionStartIndex + i,
              spanStart: spanIndex,
              spanLength: span[1].length,
            })
          );
        }
        spanIndex += span[1].length;
      }
    }
  }
  return { unifiedDecorations, deletionDecorations, additionDecorations };
}

interface CreateDiffSpanDecorationProps {
  line: number;
  spanStart: number;
  spanLength: number;
}

function createDiffSpanDecoration({
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
}

// For diff decoration spans, we want to be sure that if there is a single
// white-space gap between diffs that we join them together into a longer diff span.
// Spans are basically just a tuple - 1 means the content should be
// highlighted, 0 means it should not, we still need to the span data to figure
// out span positions
function pushOrJoinSpan({
  item,
  arr,
  enableJoin,
  isNeutral = false,
}: PushOrJoinSpanProps) {
  const lastItem = arr[arr.length - 1];
  if (lastItem == null || item.value === '\n' || !enableJoin) {
    arr.push([isNeutral ? 0 : 1, item.value]);
    return;
  }
  const isLastItemNeutral = lastItem[0] === 0;
  if (
    isNeutral === isLastItemNeutral ||
    // If we have a single space neutral item, lets join it to a previously
    // space non-neutral item to avoid single space gaps
    (isNeutral && item.value.length === 1 && !isLastItemNeutral)
  ) {
    lastItem[1] += item.value;
    return;
  }
  arr.push([isNeutral ? 0 : 1, item.value]);
}

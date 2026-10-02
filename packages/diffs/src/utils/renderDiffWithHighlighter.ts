import { type ChangeObject, diffChars, diffWordsWithSpace } from 'diff';

import { DEFAULT_COLLAPSED_CONTEXT_THRESHOLD } from '../constants';
import type {
  DecorationItem,
  DiffsHighlighter,
  FileContents,
  FileDiffMetadata,
  ForceDiffPlainTextOptions,
  LineDiffTypes,
  LineInfo,
  RenderDiffFilesResult,
  RenderDiffOptions,
  SupportedLanguages,
  ThemedDiffResult,
} from '../types';
import { appendItems } from './appendItems';
import { cleanLastNewline } from './cleanLastNewline';
import { formatCSSVariablePrefix } from './formatCSSVariablePrefix';
import { getFiletypeFromFileName } from './getFiletypeFromFileName';
import { getHighlighterThemeStyles } from './getHighlighterThemeStyles';
import { iterateOverDiff } from './iterateOverDiff';
import {
  createDiffSpanDecoration,
  pushOrJoinSpan,
} from './parseDiffDecorations';
import { renderTokenLines } from './renderTokenLines';
import { setDeferredArrayItem } from './setDeferredArrayItem';

const DEFAULT_PLAIN_TEXT_OPTIONS: ForceDiffPlainTextOptions = {
  forcePlainText: false,
};

export function renderDiffWithHighlighter(
  diff: FileDiffMetadata,
  highlighter: DiffsHighlighter,
  options: RenderDiffOptions,
  {
    forcePlainText,
    deferLineRendering = false,
    startingLine,
    totalLines,
    expandedHunks,
    collapsedContextThreshold = DEFAULT_COLLAPSED_CONTEXT_THRESHOLD,
  }: ForceDiffPlainTextOptions = DEFAULT_PLAIN_TEXT_OPTIONS
): ThemedDiffResult {
  if (forcePlainText) {
    startingLine ??= 0;
    totalLines ??= Infinity;
  } else {
    // Tokenization must include preceding lines to preserve lexical state.
    startingLine = 0;
    totalLines = Infinity;
  }
  const isWindowedHighlight = startingLine > 0 || totalLines < Infinity;
  deferLineRendering &&= !forcePlainText && !options.useTokenTransformer;
  const baseThemeType =
    typeof options.theme === 'string'
      ? highlighter.getTheme(options.theme).type
      : undefined;
  const themeStyles = getHighlighterThemeStyles({
    theme: options.theme,
    highlighter,
  });

  // If we have a large file and we are rendering the WHOLE plain diff ast,
  // then we should remove the lineDiffType to make sure things render quickly.
  // For highlighted ASTs or windowed highlights, we should just inherit the
  // setting
  const lineDiffType =
    forcePlainText &&
    !isWindowedHighlight &&
    (diff.unifiedLineCount > 1000 || diff.splitLineCount > 1000)
      ? 'none'
      : options.lineDiffType;

  const code: RenderDiffFilesResult = {
    deletionLines: [],
    additionLines: [],
  };

  const { maxLineDiffLength } = options;
  const shouldGroupAll = !forcePlainText && !diff.isPartial;
  const expandedHunksForIteration = forcePlainText ? expandedHunks : undefined;
  const buckets = new Map<number, RenderBucket>();
  function getBucketForHunk(hunkIndex: number) {
    const index = shouldGroupAll ? 0 : hunkIndex;
    const bucket = buckets.get(index) ?? createBucket();
    buckets.set(index, bucket);
    return bucket;
  }

  function appendContent(
    lineContent: string,
    lineIndex: number,
    segments: HighlightSegment[],
    contentWrapper: FakeArrayType
  ) {
    if (isWindowedHighlight) {
      let segment = segments.at(-1);
      if (
        segment == null ||
        segment.targetIndex + segment.count !== lineIndex
      ) {
        segment = {
          targetIndex: lineIndex,
          originalOffset: contentWrapper.length,
          count: 0,
        };
        segments.push(segment);
      }
      segment.count++;
    }
    contentWrapper.push(lineContent);
  }

  iterateOverDiff({
    diff,
    diffStyle: 'both',
    startingLine,
    totalLines,
    expandedHunks: isWindowedHighlight ? expandedHunksForIteration : true,
    collapsedContextThreshold,
    callback: ({ hunkIndex, additionLine, deletionLine, type }) => {
      const bucket = getBucketForHunk(hunkIndex);
      const splitLineIndex =
        additionLine != null
          ? additionLine.splitLineIndex
          : deletionLine.splitLineIndex;

      if (type === 'change' && additionLine != null && deletionLine != null) {
        computeLineDiffDecorations({
          additionLine: diff.additionLines[additionLine.lineIndex],
          deletionLine: diff.deletionLines[deletionLine.lineIndex],
          deletionLineIndex: bucket.deletionContent.length,
          additionLineIndex: bucket.additionContent.length,
          deletionDecorations: bucket.deletionDecorations,
          additionDecorations: bucket.additionDecorations,
          lineDiffType,
          maxLineDiffLength,
        });
      }

      if (deletionLine != null) {
        appendContent(
          diff.deletionLines[deletionLine.lineIndex],
          deletionLine.lineIndex,
          bucket.deletionSegments,
          bucket.deletionContent
        );
        bucket.deletionInfo.push({
          type: type === 'change' ? 'change-deletion' : type,
          lineNumber: deletionLine.lineNumber,
          altLineNumber:
            type === 'change'
              ? undefined
              : (additionLine.lineNumber ?? undefined),
          lineIndex: `${deletionLine.unifiedLineIndex},${splitLineIndex}`,
        });
      }

      if (additionLine != null) {
        appendContent(
          diff.additionLines[additionLine.lineIndex],
          additionLine.lineIndex,
          bucket.additionSegments,
          bucket.additionContent
        );
        bucket.additionInfo.push({
          type: type === 'change' ? 'change-addition' : type,
          lineNumber: additionLine.lineNumber,
          altLineNumber:
            type === 'change'
              ? undefined
              : (deletionLine.lineNumber ?? undefined),
          lineIndex: `${additionLine.unifiedLineIndex},${splitLineIndex}`,
        });
      }
    },
  });

  for (const bucket of buckets.values()) {
    if (
      bucket.deletionContent.length === 0 &&
      bucket.additionContent.length === 0
    ) {
      continue;
    }

    const deletionFile = {
      name: diff.prevName ?? diff.name,
      contents: bucket.deletionContent.value,
    };
    const additionFile = {
      name: diff.name,
      contents: bucket.additionContent.value,
    };
    const { deletionLines, additionLines } = renderTwoFiles({
      deletionFile,
      deletionInfo: bucket.deletionInfo,
      deletionDecorations: bucket.deletionDecorations,

      additionFile,
      additionInfo: bucket.additionInfo,
      additionDecorations: bucket.additionDecorations,

      highlighter,
      options,
      languageOverride: forcePlainText ? 'text' : diff.lang,
      deferLineRendering,
    });

    if (shouldGroupAll) {
      code.deletionLines = deletionLines;
      code.additionLines = additionLines;
      continue;
    }

    for (const [target, lines, segments] of [
      [code.deletionLines, deletionLines, bucket.deletionSegments],
      [code.additionLines, additionLines, bucket.additionSegments],
    ] as const) {
      if (segments.length > 0) {
        for (const segment of segments) {
          for (let index = 0; index < segment.count; index++) {
            target[segment.targetIndex + index] =
              lines[segment.originalOffset + index];
          }
        }
      } else if (deferLineRendering) {
        const offset = target.length;
        for (let index = 0; index < lines.length; index++) {
          setDeferredArrayItem(target, offset + index, () => lines[index]);
        }
      } else {
        appendItems(target, lines);
      }
    }
  }

  return { code, themeStyles, baseThemeType };
}

// The line indexes and decoration arrays a line diff writes its highlights to
interface LineDiffDecorationTargets {
  deletionLineIndex: number;
  additionLineIndex: number;
  deletionDecorations: DecorationItem[];
  additionDecorations: DecorationItem[];
}

interface ProcessLineDiffProps extends LineDiffDecorationTargets {
  deletionLine: string | undefined;
  additionLine: string | undefined;
  lineDiffType: LineDiffTypes;
  maxLineDiffLength: number;
}

// Push one decoration per side covering the first through last changed
// token, so each line only has one highlight. Offsets come straight from the
// diff items, skipping the span arrays the other word modes build.
function pushWordLineDecorations(
  lineDiff: ChangeObject<string>[],
  {
    deletionLineIndex,
    additionLineIndex,
    deletionDecorations,
    additionDecorations,
  }: LineDiffDecorationTargets
): void {
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
  if (deletionStart !== -1) {
    deletionDecorations.push(
      createDiffSpanDecoration({
        line: deletionLineIndex,
        spanStart: deletionStart,
        spanLength: deletionEnd - deletionStart,
      })
    );
  }
  if (additionStart !== -1) {
    additionDecorations.push(
      createDiffSpanDecoration({
        line: additionLineIndex,
        spanStart: additionStart,
        spanLength: additionEnd - additionStart,
      })
    );
  }
}

function computeLineDiffDecorations({
  deletionLine,
  additionLine,
  deletionLineIndex,
  additionLineIndex,
  deletionDecorations,
  additionDecorations,
  lineDiffType,
  maxLineDiffLength,
}: ProcessLineDiffProps) {
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
  if (lineDiffType === 'word-line') {
    pushWordLineDecorations(lineDiff, {
      deletionLineIndex,
      additionLineIndex,
      deletionDecorations,
      additionDecorations,
    });
    return;
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

interface HighlightSegment {
  // The where the highlighted region starts
  originalOffset: number;
  // Where to place the highlighted line in RenderDiffFilesResult
  targetIndex: number;
  // Number of highlighted lines
  count: number;
}

interface FakeArrayType {
  push(value: string): void;
  value: string;
  length: number;
}

interface RenderBucket {
  deletionContent: FakeArrayType;
  additionContent: FakeArrayType;
  deletionInfo: (LineInfo | undefined)[];
  additionInfo: (LineInfo | undefined)[];
  deletionDecorations: DecorationItem[];
  additionDecorations: DecorationItem[];
  deletionSegments: HighlightSegment[];
  additionSegments: HighlightSegment[];
}

function createBucket(): RenderBucket {
  return {
    deletionContent: {
      push(value: string) {
        this.value += value;
        this.length++;
      },
      value: '',
      length: 0,
    },
    additionContent: {
      push(value: string) {
        this.value += value;
        this.length++;
      },
      value: '',
      length: 0,
    },
    deletionInfo: [],
    additionInfo: [],
    deletionDecorations: [],
    additionDecorations: [],
    deletionSegments: [],
    additionSegments: [],
  };
}

interface RenderTwoFilesProps {
  deferLineRendering: boolean;
  deletionFile: FileContents;
  additionFile: FileContents;
  deletionInfo: (LineInfo | undefined)[];
  additionInfo: (LineInfo | undefined)[];
  deletionDecorations: DecorationItem[];
  additionDecorations: DecorationItem[];
  options: RenderDiffOptions;
  highlighter: DiffsHighlighter;
  languageOverride: SupportedLanguages | undefined;
}

function renderTwoFiles({
  deferLineRendering,
  deletionFile,
  additionFile,
  deletionInfo,
  additionInfo,
  highlighter,
  deletionDecorations,
  additionDecorations,
  languageOverride,
  options: { theme, useTokenTransformer, tokenizeMaxLineLength },
}: RenderTwoFilesProps): RenderDiffFilesResult {
  const renderFile = (
    file: FileContents,
    lineInfo: (LineInfo | undefined)[],
    decorations: DecorationItem[]
  ): RenderDiffFilesResult['additionLines'] => {
    if (file.contents === '') return [];
    return renderTokenLines(
      highlighter.codeToTokens(cleanLastNewline(file.contents), {
        lang: languageOverride ?? getFiletypeFromFileName(file.name),
        ...(typeof theme === 'string' ? { theme } : { themes: theme }),
        defaultColor: false,
        cssVariablePrefix: formatCSSVariablePrefix('token'),
        tokenizeMaxLineLength,
        // Timed aborts can leave incomplete tokens; limit line length instead.
        tokenizeTimeLimit: 0,
      }).tokens,
      {
        state: { lineInfo },
        useTokenTransformer,
        decorations,
        deferLineRendering,
      }
    );
  };

  return {
    deletionLines: renderFile(deletionFile, deletionInfo, deletionDecorations),
    additionLines: renderFile(additionFile, additionInfo, additionDecorations),
  };
}

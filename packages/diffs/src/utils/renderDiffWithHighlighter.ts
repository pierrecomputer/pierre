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
import {
  computeLineDiffRanges,
  type LineDiffRange,
} from './computeLineDiffRanges';
import { getFiletypeFromFileName } from './getFiletypeFromFileName';
import { getHighlighterThemeStyles } from './getHighlighterThemeStyles';
import { getTokenOptions } from './getTokenOptions';
import { iterateOverDiff } from './iterateOverDiff';
import { createDiffSpanDecoration } from './parseDiffDecorations';
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
    lazyLineAST = false,
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
  lazyLineAST &&= !forcePlainText && !options.useTokenTransformer;
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
      lazyLineAST,
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
      } else if (lazyLineAST) {
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
  if (deletionLine == null || additionLine == null) {
    return;
  }
  const ranges = computeLineDiffRanges(
    deletionLine,
    additionLine,
    lineDiffType,
    maxLineDiffLength
  );
  pushDiffSpanDecorations(
    ranges.deletion,
    deletionLineIndex,
    deletionDecorations
  );
  pushDiffSpanDecorations(
    ranges.addition,
    additionLineIndex,
    additionDecorations
  );
}

function pushDiffSpanDecorations(
  ranges: readonly LineDiffRange[],
  line: number,
  decorations: DecorationItem[]
): void {
  for (let index = 0; index < ranges.length; index++) {
    const range = ranges[index];
    decorations.push(
      createDiffSpanDecoration({
        line,
        spanStart: range[0],
        spanLength: range[1] - range[0],
      })
    );
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
  lazyLineAST: boolean;
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
  lazyLineAST,
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
      highlighter.codeToTokens(
        cleanLastNewline(file.contents),
        getTokenOptions(
          languageOverride ?? getFiletypeFromFileName(file.name),
          theme,
          tokenizeMaxLineLength
        )
      ).tokens,
      {
        state: { lineInfo },
        useTokenTransformer,
        decorations,
        lazyLineAST,
        cacheHtmlStyles: highlighter.name === 'highlights',
      }
    );
  };

  return {
    deletionLines: renderFile(deletionFile, deletionInfo, deletionDecorations),
    additionLines: renderFile(additionFile, additionInfo, additionDecorations),
  };
}

import { diffChars, diffWordsWithSpace } from 'diff';

import {
  DEFAULT_COLLAPSED_CONTEXT_THRESHOLD,
  DEFAULT_THEMES,
} from '../constants';
import type {
  CodeToHastOptions,
  DecorationItem,
  DiffsHighlighter,
  DiffsThemeNames,
  FileContents,
  FileDiffMetadata,
  ForcePlainTextOptions,
  LineDiffTypes,
  LineInfo,
  RenderDiffFilesResult,
  RenderDiffOptions,
  SupportedLanguages,
  ThemedDiffResult,
} from '../types';
import { cleanLastNewline } from './cleanLastNewline';
import { createTransformerWithState } from './createTransformerWithState';
import { formatCSSVariablePrefix } from './formatCSSVariablePrefix';
import { getFiletypeFromFileName } from './getFiletypeFromFileName';
import { getHighlighterThemeStyles } from './getHighlighterThemeStyles';
import { getLineNodes } from './getLineNodes';
import { iterateOverDiff } from './iterateOverDiff';
import {
  createDiffSpanDecoration,
  pushOrJoinSpan,
} from './parseDiffDecorations';

const DEFAULT_PLAIN_TEXT_OPTIONS: ForcePlainTextOptions = {
  forcePlainText: false,
};

export function renderDiffWithHighlighter(
  diff: FileDiffMetadata,
  highlighter: DiffsHighlighter,
  options: RenderDiffOptions,
  {
    forcePlainText,
    startingLine,
    totalLines,
    expandedHunks,
    collapsedContextThreshold = DEFAULT_COLLAPSED_CONTEXT_THRESHOLD,
  }: ForcePlainTextOptions = DEFAULT_PLAIN_TEXT_OPTIONS
): ThemedDiffResult {
  if (forcePlainText) {
    startingLine ??= 0;
    totalLines ??= Infinity;
  } else {
    // If we aren't forcing plain text, then we intentionally do not support
    // ranges for highlighting as that could break the syntax highlighting, we
    // we override any values that may have been passed in.  Maybe one day we
    // warn about this?
    startingLine = 0;
    totalLines = Infinity;
  }
  const isWindowedHighlight = startingLine > 0 || totalLines < Infinity;
  const baseThemeType = (() => {
    const theme = options.theme ?? DEFAULT_THEMES;
    if (typeof theme === 'string') {
      return highlighter.getTheme(theme).type;
    }
    return undefined;
  })();
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
    callback: ({
      hunkIndex,
      additionLineIndex,
      deletionLineIndex,
      additionLineNumber,
      deletionLineNumber,
      unifiedAdditionLineIndex,
      unifiedDeletionLineIndex,
      splitLineIndex,
      type,
    }) => {
      const bucket = getBucketForHunk(hunkIndex);

      if (
        type === 'change' &&
        lineDiffType !== 'none' &&
        additionLineIndex != null &&
        deletionLineIndex != null
      ) {
        computeLineDiffDecorations({
          additionLine: diff.additionLines[additionLineIndex],
          deletionLine: diff.deletionLines[deletionLineIndex],
          deletionLineIndex: bucket.deletionContent.length,
          additionLineIndex: bucket.additionContent.length,
          deletionDecorations: bucket.deletionDecorations,
          additionDecorations: bucket.additionDecorations,
          lineDiffType,
        });
      }

      if (
        deletionLineIndex != null &&
        deletionLineNumber != null &&
        unifiedDeletionLineIndex != null
      ) {
        appendContent(
          diff.deletionLines[deletionLineIndex],
          deletionLineIndex,
          bucket.deletionSegments,
          bucket.deletionContent
        );
        bucket.deletionInfo.push({
          type: type === 'change' ? 'change-deletion' : type,
          lineNumber: deletionLineNumber,
          altLineNumber:
            type === 'change' ? undefined : (additionLineNumber ?? undefined),
          lineIndex: `${unifiedDeletionLineIndex},${splitLineIndex}`,
        });
      }

      if (
        additionLineIndex != null &&
        additionLineNumber != null &&
        unifiedAdditionLineIndex != null
      ) {
        appendContent(
          diff.additionLines[additionLineIndex],
          additionLineIndex,
          bucket.additionSegments,
          bucket.additionContent
        );
        bucket.additionInfo.push({
          type: type === 'change' ? 'change-addition' : type,
          lineNumber: additionLineNumber,
          altLineNumber:
            type === 'change' ? undefined : (deletionLineNumber ?? undefined),
          lineIndex: `${unifiedAdditionLineIndex},${splitLineIndex}`,
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
    });

    if (shouldGroupAll) {
      code.deletionLines = deletionLines;
      code.additionLines = additionLines;
      continue;
    }

    if (bucket.deletionSegments.length > 0) {
      for (const seg of bucket.deletionSegments) {
        for (let i = 0; i < seg.count; i++) {
          code.deletionLines[seg.targetIndex + i] =
            deletionLines[seg.originalOffset + i];
        }
      }
    } else {
      code.deletionLines.push(...deletionLines);
    }
    if (bucket.additionSegments.length > 0) {
      for (const seg of bucket.additionSegments) {
        for (let i = 0; i < seg.count; i++) {
          code.additionLines[seg.targetIndex + i] =
            additionLines[seg.originalOffset + i];
        }
      }
    } else {
      code.additionLines.push(...additionLines);
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
}

function computeLineDiffDecorations({
  deletionLine,
  additionLine,
  deletionLineIndex,
  additionLineIndex,
  deletionDecorations,
  additionDecorations,
  lineDiffType,
}: ProcessLineDiffProps) {
  if (deletionLine == null || additionLine == null || lineDiffType === 'none') {
    return;
  }
  deletionLine = cleanLastNewline(deletionLine);
  additionLine = cleanLastNewline(additionLine);
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
  deletionFile,
  additionFile,
  deletionInfo,
  additionInfo,
  highlighter,
  deletionDecorations,
  additionDecorations,
  languageOverride,
  options: { theme: themeOrThemes = DEFAULT_THEMES, ...options },
}: RenderTwoFilesProps): RenderDiffFilesResult {
  const deletionLang =
    languageOverride ?? getFiletypeFromFileName(deletionFile.name);
  const additionLang =
    languageOverride ?? getFiletypeFromFileName(additionFile.name);
  const { state, transformers } = createTransformerWithState();
  const hastConfig: CodeToHastOptions<DiffsThemeNames> = (() => {
    return typeof themeOrThemes === 'string'
      ? {
          ...options,
          // language will be overwritten for each highlight
          lang: 'text',
          theme: themeOrThemes,
          transformers,
          decorations: undefined,
          defaultColor: false,
          cssVariablePrefix: formatCSSVariablePrefix('token'),
        }
      : {
          ...options,
          // language will be overwritten for each highlight
          lang: 'text',
          themes: themeOrThemes,
          transformers,
          decorations: undefined,
          defaultColor: false,
          cssVariablePrefix: formatCSSVariablePrefix('token'),
        };
  })();

  const deletionLines = (() => {
    if (deletionFile.contents === '') {
      return [];
    }
    hastConfig.lang = deletionLang;
    state.lineInfo = deletionInfo;
    hastConfig.decorations = deletionDecorations;
    return getLineNodes(
      highlighter.codeToHast(
        cleanLastNewline(deletionFile.contents),
        hastConfig
      )
    );
  })();
  const additionLines = (() => {
    if (additionFile.contents === '') {
      return [];
    }
    hastConfig.lang = additionLang;
    hastConfig.decorations = additionDecorations;
    state.lineInfo = additionInfo;
    return getLineNodes(
      highlighter.codeToHast(
        cleanLastNewline(additionFile.contents),
        hastConfig
      )
    );
  })();

  return { deletionLines, additionLines };
}

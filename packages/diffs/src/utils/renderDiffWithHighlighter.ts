import type { CodeToTokensOptions } from 'shiki/core';

import { DEFAULT_COLLAPSED_CONTEXT_THRESHOLD } from '../constants';
import type { RenderersHighlighter } from '../highlighter/resolve_highlighter';
import type {
  FileContents,
  FileDiffMetadata,
  ForceDiffPlainTextOptions,
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
import { updateTokenOffsets } from './updateTokenOffsets';

const DEFAULT_PLAIN_TEXT_OPTIONS: ForceDiffPlainTextOptions = {
  forcePlainText: false,
};

export function renderDiffWithHighlighter(
  diff: FileDiffMetadata,
  highlighter: RenderersHighlighter,
  options: RenderDiffOptions,
  {
    forcePlainText,
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
    // If we aren't forcing plain text, then we intentionally do not support
    // ranges for highlighting as that could break the syntax highlighting, we
    // we override any values that may have been passed in.  Maybe one day we
    // warn about this?
    startingLine = 0;
    totalLines = Infinity;
  }
  const isWindowedHighlight = startingLine > 0 || totalLines < Infinity;
  const baseThemeType =
    typeof options.theme === 'string'
      ? highlighter.getTheme(options.theme).type
      : undefined;
  const themeStyles = getHighlighterThemeStyles({
    theme: options.theme,
    highlighter,
  });

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
    callback: ({ hunkIndex, additionLine, deletionLine }) => {
      const bucket = getBucketForHunk(hunkIndex);
      if (deletionLine != null) {
        appendContent(
          diff.deletionLines[deletionLine.lineIndex],
          deletionLine.lineIndex,
          bucket.deletionSegments,
          bucket.deletionContent
        );
      }

      if (additionLine != null) {
        appendContent(
          diff.additionLines[additionLine.lineIndex],
          additionLine.lineIndex,
          bucket.additionSegments,
          bucket.additionContent
        );
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

      additionFile,

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
      appendItems(code.deletionLines, deletionLines);
    }
    if (bucket.additionSegments.length > 0) {
      for (const seg of bucket.additionSegments) {
        for (let i = 0; i < seg.count; i++) {
          code.additionLines[seg.targetIndex + i] =
            additionLines[seg.originalOffset + i];
        }
      }
    } else {
      appendItems(code.additionLines, additionLines);
    }
  }

  updateTokenOffsets(code.deletionLines, diff.deletionLines);
  updateTokenOffsets(code.additionLines, diff.additionLines);
  return { code, themeStyles, baseThemeType };
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
    deletionSegments: [],
    additionSegments: [],
  };
}

interface RenderTwoFilesProps {
  deletionFile: FileContents;
  additionFile: FileContents;
  options: RenderDiffOptions;
  highlighter: RenderersHighlighter;
  languageOverride: SupportedLanguages | undefined;
}

function renderTwoFiles({
  deletionFile,
  additionFile,
  highlighter,
  languageOverride,
  options: { theme: themeOrThemes, ...options },
}: RenderTwoFilesProps): RenderDiffFilesResult {
  const deletionLang =
    languageOverride ?? getFiletypeFromFileName(deletionFile.name);
  const additionLang =
    languageOverride ?? getFiletypeFromFileName(additionFile.name);
  // tokenizeTimeLimit: 0 — never trade silently-wrong token colors for
  // latency; see renderFileWithHighlighter for the full rationale.
  const tokenConfig: CodeToTokensOptions<string, string> = (() => {
    return typeof themeOrThemes === 'string'
      ? {
          ...options,
          // language will be overwritten for each highlight
          lang: 'text',
          theme: themeOrThemes,
          defaultColor: false,
          cssVariablePrefix: formatCSSVariablePrefix('token'),
          tokenizeTimeLimit: 0,
        }
      : {
          ...options,
          // language will be overwritten for each highlight
          lang: 'text',
          themes: themeOrThemes,
          defaultColor: false,
          cssVariablePrefix: formatCSSVariablePrefix('token'),
          tokenizeTimeLimit: 0,
        };
  })();

  const deletionLines = (() => {
    if (deletionFile.contents === '') {
      return [];
    }
    tokenConfig.lang = deletionLang;

    return highlighter.codeToTokens(
      cleanLastNewline(deletionFile.contents),
      tokenConfig
    ).tokens;
  })();
  const additionLines = (() => {
    if (additionFile.contents === '') {
      return [];
    }
    tokenConfig.lang = additionLang;

    return highlighter.codeToTokens(
      cleanLastNewline(additionFile.contents),
      tokenConfig
    ).tokens;
  })();

  return { deletionLines, additionLines };
}

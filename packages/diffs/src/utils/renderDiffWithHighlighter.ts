import type { CodeToTokensOptions } from 'shiki/core';

import { DEFAULT_COLLAPSED_CONTEXT_THRESHOLD } from '../constants';
import type { RenderersHighlighter } from '../highlighter/resolve_highlighter';
import type {
  FileDiffMetadata,
  ForceDiffPlainTextOptions,
  RenderDiffFilesResult,
  RenderDiffOptions,
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
    // Syntax highlighting needs the complete file to preserve parser state.
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

  // Track where windowed token rows belong before joining their source text.
  function appendContent(
    lineContent: string,
    lineIndex: number,
    segments: HighlightSegment[],
    content: string[]
  ) {
    if (isWindowedHighlight) {
      let segment = segments.at(-1);
      if (
        segment == null ||
        segment.targetIndex + segment.count !== lineIndex
      ) {
        segment = {
          targetIndex: lineIndex,
          originalOffset: content.length,
          count: 0,
        };
        segments.push(segment);
      }
      segment.count++;
    }
    content.push(lineContent);
  }

  iterateOverDiff({
    diff,
    diffStyle: 'both',
    startingLine,
    totalLines,
    expandedHunks: isWindowedHighlight ? expandedHunksForIteration : true,
    collapsedContextThreshold,
    callback: ({ hunkIndex, additionLine, deletionLine }) => {
      const index = shouldGroupAll ? 0 : hunkIndex;
      let bucket = buckets.get(index);
      if (bucket == null) {
        bucket = {
          deletionContent: [],
          additionContent: [],
          deletionSegments: [],
          additionSegments: [],
        };
        buckets.set(index, bucket);
      }
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

  const languageOverride = forcePlainText ? 'text' : diff.lang;
  const deletionLang =
    languageOverride ?? getFiletypeFromFileName(diff.prevName ?? diff.name);
  const additionLang = languageOverride ?? getFiletypeFromFileName(diff.name);
  // Disable Shiki's silent tokenization timeout; see renderFileWithHighlighter.
  const tokenConfig: CodeToTokensOptions<string, string> = {
    lang: deletionLang,
    ...(typeof options.theme === 'string'
      ? { theme: options.theme }
      : { themes: options.theme }),
    defaultColor: false,
    cssVariablePrefix: formatCSSVariablePrefix('token'),
    tokenizeMaxLineLength: options.tokenizeMaxLineLength,
    tokenizeTimeLimit: 0,
  };
  for (const bucket of buckets.values()) {
    if (
      bucket.deletionContent.length === 0 &&
      bucket.additionContent.length === 0
    ) {
      continue;
    }

    const deletionContent = bucket.deletionContent.join('');
    const additionContent = bucket.additionContent.join('');
    tokenConfig.lang = deletionLang;
    const deletionLines =
      deletionContent === ''
        ? []
        : highlighter.codeToTokens(
            cleanLastNewline(deletionContent),
            tokenConfig
          ).tokens;
    tokenConfig.lang = additionLang;
    const additionLines =
      additionContent === ''
        ? []
        : highlighter.codeToTokens(
            cleanLastNewline(additionContent),
            tokenConfig
          ).tokens;

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
  // Where the highlighted region starts in the bucket's token rows.
  originalOffset: number;
  // Where to place the highlighted line in RenderDiffFilesResult
  targetIndex: number;
  // Number of highlighted lines
  count: number;
}

interface RenderBucket {
  deletionContent: string[];
  additionContent: string[];
  deletionSegments: HighlightSegment[];
  additionSegments: HighlightSegment[];
}

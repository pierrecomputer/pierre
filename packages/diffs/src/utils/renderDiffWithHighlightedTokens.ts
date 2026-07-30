import type { ElementContent } from 'hast';

import { DEFAULT_COLLAPSED_CONTEXT_THRESHOLD } from '../constants';
import type {
  ExternalHighlightedDiff,
  FileDiffMetadata,
  HunkExpansionRegion,
  LineInfo,
  RenderRange,
  ThemedDiffResult,
} from '../types';
import { iterateOverDiff } from './iterateOverDiff';
import {
  renderHighlightedLine,
  validateHighlightedLines,
} from './renderFileWithHighlightedTokens';
// Revalidates only when either source-line array changes.
const validatedHighlightedDiffs = new WeakMap<
  ExternalHighlightedDiff,
  {
    deletionLines: FileDiffMetadata['deletionLines'];
    additionLines: FileDiffMetadata['additionLines'];
  }
>();

/** Renders caller-provided tokens through the standard diff row mapping. */
export function renderDiffWithHighlightedTokens(
  diff: FileDiffMetadata,
  highlighted: ExternalHighlightedDiff,
  useTokenTransformer: boolean,
  renderRange: RenderRange | undefined,
  expandedHunks: Map<number, HunkExpansionRegion> | true,
  collapsedContextThreshold: number = DEFAULT_COLLAPSED_CONTEXT_THRESHOLD
): ThemedDiffResult {
  const validatedSource = validatedHighlightedDiffs.get(highlighted);
  if (
    validatedSource?.deletionLines !== diff.deletionLines ||
    validatedSource.additionLines !== diff.additionLines
  ) {
    validateHighlightedLines(
      diff.prevName ?? diff.name,
      diff.deletionLines,
      highlighted.deletions.lines
    );
    validateHighlightedLines(
      diff.name,
      diff.additionLines,
      highlighted.additions.lines
    );
    validatedHighlightedDiffs.set(highlighted, {
      deletionLines: diff.deletionLines,
      additionLines: diff.additionLines,
    });
  }

  const deletionLines: ElementContent[] = [];
  const additionLines: ElementContent[] = [];
  iterateOverDiff({
    diff,
    diffStyle: 'both',
    startingLine: renderRange?.startingLine ?? 0,
    totalLines: renderRange?.totalLines ?? Infinity,
    expandedHunks,
    collapsedContextThreshold,
    callback: ({ additionLine, deletionLine, type }) => {
      const splitLineIndex =
        additionLine?.splitLineIndex ?? deletionLine?.splitLineIndex;
      if (splitLineIndex == null) {
        return;
      }
      if (deletionLine != null) {
        deletionLines[deletionLine.lineIndex] = renderHighlightedLine(
          highlighted.deletions.lines[deletionLine.lineIndex],
          createLineInfo(
            type,
            'deletions',
            deletionLine,
            additionLine,
            splitLineIndex
          ),
          useTokenTransformer
        );
      }
      if (additionLine != null) {
        additionLines[additionLine.lineIndex] = renderHighlightedLine(
          highlighted.additions.lines[additionLine.lineIndex],
          createLineInfo(
            type,
            'additions',
            additionLine,
            deletionLine,
            splitLineIndex
          ),
          useTokenTransformer
        );
      }
    },
  });

  return {
    code: { deletionLines, additionLines },
    themeStyles: highlighted.themeStyles ?? '',
    baseThemeType: highlighted.baseThemeType,
  };
}

interface DiffLinePosition {
  lineIndex: number;
  lineNumber: number;
  unifiedLineIndex: number;
}

function createLineInfo(
  type: 'change' | 'context' | 'context-expanded',
  side: 'additions' | 'deletions',
  line: DiffLinePosition,
  counterpart: DiffLinePosition | null | undefined,
  splitLineIndex: number
): LineInfo {
  return {
    type:
      type === 'change'
        ? side === 'additions'
          ? 'change-addition'
          : 'change-deletion'
        : type,
    lineNumber: line.lineNumber,
    altLineNumber:
      type === 'change' ? undefined : (counterpart?.lineNumber ?? undefined),
    lineIndex: `${line.unifiedLineIndex},${splitLineIndex}`,
  };
}

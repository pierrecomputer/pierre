import { type ChangeObject, diffChars, diffWordsWithSpace } from 'diff';
import type { GrammarState } from 'shiki/core';

import { DEFAULT_COLLAPSED_CONTEXT_THRESHOLD } from '../constants';
import type {
  CodeToTokensOptions,
  DecorationItem,
  DiffsHighlighter,
  FileDiffMetadata,
  ForceDiffPlainTextOptions,
  LineDiffTypes,
  LineInfo,
  RenderDiffFilesResult,
  RenderDiffOptions,
  ThemedDiffResult,
  TokensResult,
} from '../types';
import { appendItems } from './appendItems';
import { cleanLastNewline } from './cleanLastNewline';
import { getFiletypeFromFileName } from './getFiletypeFromFileName';
import { getHighlighterThemeStyles } from './getHighlighterThemeStyles';
import { getTokenOptions } from './getTokenOptions';
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

  const renderedBuckets = Array.from(buckets.values()).filter(
    (bucket) =>
      bucket.deletionContent.length > 0 || bucket.additionContent.length > 0
  );
  const languageOverride = forcePlainText ? 'text' : diff.lang;
  const deletionName = diff.prevName ?? diff.name;
  const deletionTokens = tokenizeHunks(
    highlighter,
    renderedBuckets.map((bucket) => bucket.deletionContent.value),
    getTokenOptions(
      languageOverride ?? getFiletypeFromFileName(deletionName),
      options.theme,
      options.tokenizeMaxLineLength
    ),
    !forcePlainText
  );
  const additionTokens = tokenizeHunks(
    highlighter,
    renderedBuckets.map((bucket) => bucket.additionContent.value),
    getTokenOptions(
      languageOverride ?? getFiletypeFromFileName(diff.name),
      options.theme,
      options.tokenizeMaxLineLength
    ),
    !forcePlainText
  );
  for (const [bucketIndex, bucket] of renderedBuckets.entries()) {
    const { deletionLines, additionLines } = renderTwoFiles({
      deletionTokens: deletionTokens[bucketIndex],
      deletionInfo: bucket.deletionInfo,
      deletionDecorations: bucket.deletionDecorations,

      additionTokens: additionTokens[bucketIndex],
      additionInfo: bucket.additionInfo,
      additionDecorations: bucket.additionDecorations,

      options,
      highlighter,
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
  lazyLineAST: boolean;
  deletionTokens: TokensResult | undefined;
  additionTokens: TokensResult | undefined;
  deletionInfo: (LineInfo | undefined)[];
  additionInfo: (LineInfo | undefined)[];
  deletionDecorations: DecorationItem[];
  additionDecorations: DecorationItem[];
  options: RenderDiffOptions;
  highlighter: DiffsHighlighter;
}

function renderTwoFiles({
  lazyLineAST,
  deletionTokens,
  additionTokens,
  deletionInfo,
  additionInfo,
  highlighter,
  deletionDecorations,
  additionDecorations,
  options: { useTokenTransformer },
}: RenderTwoFilesProps): RenderDiffFilesResult {
  const renderFile = (
    result: TokensResult | undefined,
    lineInfo: (LineInfo | undefined)[],
    decorations: DecorationItem[]
  ): RenderDiffFilesResult['additionLines'] => {
    if (result == null) return [];
    return renderTokenLines(result.tokens, {
      state: { lineInfo },
      useTokenTransformer,
      decorations,
      lazyLineAST,
      cacheHtmlStyles: highlighter.name === 'highlights',
    });
  };

  return {
    deletionLines: renderFile(
      deletionTokens,
      deletionInfo,
      deletionDecorations
    ),
    additionLines: renderFile(
      additionTokens,
      additionInfo,
      additionDecorations
    ),
  };
}

// The most start states tried per hunk. This sets an upper bound on cost for partial diffs with many hunks
const MAX_CANDIDATES_PER_HUNK = 3;

// One way of tokenizing a hunk: the result, and the candidate of the previous hunk
interface HunkCandidate {
  result: TokensResult;
  previous: HunkCandidate | undefined;
  // How many hunks on this path started from a state with scopes open, so a
  // path that keeps a construct open across hunks scores higher.
  carries: number;
}

// The number of open grammar scopes in a state, including the root
function getOpenDepth(grammarState: GrammarState | undefined): number {
  return grammarState?.getInternalStack()?.depth ?? Number.POSITIVE_INFINITY;
}

// Tokenizes the hunks of one side of a partial diff. The lines between hunks
// are unknown, so a hunk can start inside a comment or string that opened
// above it, or outside one that closed in the gap, and the right start state
// is often only clear from the hunks after it.
// Every hunk is tokenized from a fresh state and from each state the
// previous hunk could have ended in. The path that leaves the fewest scopes
// open at the end of the last hunk wins, and its choices are walked back to
// the first hunk.
// An empty hunk (no code) yields undefined and passes the state through.
// Without `carryState`, or for a backend that returns no grammar state, such
// as Highlights, each hunk tokenizes once.
function tokenizeHunks(
  highlighter: DiffsHighlighter,
  hunks: string[],
  tokenOptions: CodeToTokensOptions,
  carryState: boolean
): (TokensResult | undefined)[] {
  const results: (TokensResult | undefined)[] = hunks.map(() => undefined);
  let candidates: HunkCandidate[] = [];
  // The candidates of each non-empty hunk, in order, for walking back.
  const hunkIndexes: number[] = [];
  for (const [index, hunk] of hunks.entries()) {
    if (hunk === '') continue;
    const code = cleanLastNewline(hunk);
    const fresh = highlighter.codeToTokens(code, tokenOptions);
    const next: HunkCandidate[] = [];
    if (carryState && fresh.grammarState != null) {
      for (const previous of candidates) {
        if (previous.result.grammarState == null) continue;
        // A previous hunk that ended with no scope open leaves the same state
        // a fresh start does, so the fresh result is also the carried one.
        const endsAtRoot = getOpenDepth(previous.result.grammarState) <= 1;
        next.push({
          result: endsAtRoot
            ? fresh
            : highlighter.codeToTokens(code, {
                ...tokenOptions,
                grammarState: previous.result.grammarState,
              }),
          previous,
          carries: previous.carries + (endsAtRoot ? 0 : 1),
        });
      }
    }
    // Carried candidates come first so that, when a carried and a fresh
    // candidate end in the same state, the carried one is kept.
    const bestPrevious = pickBestCandidate(candidates);
    next.push({
      result: fresh,
      previous: bestPrevious,
      carries: bestPrevious?.carries ?? 0,
    });
    hunkIndexes.push(index);
    candidates = pruneCandidates(next);
  }
  let best = pickBestCandidate(candidates);
  for (let position = hunkIndexes.length - 1; position >= 0; position--) {
    const index = hunkIndexes[position];
    if (index == null || best == null) break;
    results[index] = best.result;
    best = best.previous;
  }
  return results;
}

// The candidate that leaves the fewest scopes open at the end of its hunk,
// preferring the path with more carried hunks on a tie.
function pickBestCandidate(
  candidates: HunkCandidate[]
): HunkCandidate | undefined {
  let best: HunkCandidate | undefined;
  for (const candidate of candidates) {
    const depth = getOpenDepth(candidate.result.grammarState);
    const bestDepth = getOpenDepth(best?.result.grammarState);
    if (
      best == null ||
      depth < bestDepth ||
      (depth === bestDepth && candidate.carries > best.carries)
    ) {
      best = candidate;
    }
  }
  return best;
}

// Drops candidates whose end state matches an earlier one's, since they
// continue identically, then keeps the shallowest few.
function pruneCandidates(candidates: HunkCandidate[]): HunkCandidate[] {
  const unique: HunkCandidate[] = [];
  for (const candidate of candidates) {
    const stack = candidate.result.grammarState?.getInternalStack();
    const duplicateIndex = unique.findIndex((other) => {
      const otherStack = other.result.grammarState?.getInternalStack();
      return stack != null && otherStack != null && stack.equals(otherStack);
    });
    if (duplicateIndex === -1) {
      unique.push(candidate);
    } else if (candidate.carries > (unique[duplicateIndex]?.carries ?? 0)) {
      // Both continue the same way, so keep the path that carried more.
      unique[duplicateIndex] = candidate;
    }
  }
  return unique
    .sort(
      (a, b) =>
        getOpenDepth(a.result.grammarState) -
        getOpenDepth(b.result.grammarState)
    )
    .slice(0, MAX_CANDIDATES_PER_HUNK);
}

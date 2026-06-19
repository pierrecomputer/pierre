import { describe, expect, test } from 'bun:test';

import { DEFAULT_COLLAPSED_CONTEXT_THRESHOLD } from '../src/constants';
import type { FileDiffMetadata, VirtualFileMetrics } from '../src/types';
import {
  computeEstimatedDiffHeights,
  type ComputeEstimatedDiffHeightsOptions,
} from '../src/utils/computeEstimatedDiffHeights';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { countDeclaredRows } from './testUtils';

const metrics: VirtualFileMetrics = {
  hunkLineCount: 2,
  lineHeight: 10,
  diffHeaderHeight: 30,
  spacing: 4,
};

// Built-in separator heights mirror getDefaultHunkSeparatorHeight: 'simple'
// renders a 4px rule while the other separator types measure 32px.
const simpleSeparatorHeight = 4;
const lineInfoSeparatorHeight = 32;
const metadataSeparatorHeight = 32;

// 'line-info' separators add `spacing` gaps around themselves except above
// the first separator and below the trailing one, mirroring
// getLeadingHunkSeparatorLayout and getTrailingHunkSeparatorLayout.
const firstLineInfoSeparatorHeight = lineInfoSeparatorHeight + metrics.spacing;
const middleLineInfoSeparatorHeight =
  metrics.spacing + lineInfoSeparatorHeight + metrics.spacing;
const trailingLineInfoSeparatorHeight =
  metrics.spacing + lineInfoSeparatorHeight;

// Diffs with at least one hunk always end with bottom padding, which falls
// back to `spacing` when `paddingBottom` is not configured.
const defaultPaddingBottom = metrics.spacing;

// Geometry for createTwoHunkDiff: a 140-line file with single-line changes at
// lines 40 and 100, leaving collapsed unchanged context before, between, and
// after the two parsed hunks.
const twoHunkFileLineCount = 140;
const twoHunkChangedLines = [40, 100];

function createTwoHunkDiff(): FileDiffMetadata {
  const oldLines = Array.from(
    { length: twoHunkFileLineCount },
    (_, index) => `${index + 1}`
  );
  const newLines = oldLines.map((line, index) =>
    twoHunkChangedLines.includes(index + 1) ? `changed-${index + 1}` : line
  );

  const fileDiff = parseDiffFromFile(
    { name: 'two-hunks.ts', contents: `${oldLines.join('\n')}\n` },
    { name: 'two-hunks.ts', contents: `${newLines.join('\n')}\n` }
  );
  const [firstHunk, secondHunk] = fileDiff.hunks;
  if (
    fileDiff.hunks.length !== 2 ||
    firstHunk == null ||
    secondHunk == null ||
    firstHunk.collapsedBefore <= 0 ||
    secondHunk.collapsedBefore <= 0
  ) {
    throw new Error('Expected two hunks with collapsed leading context');
  }
  return fileDiff;
}

// Height contributed by the rows each hunk declares (plus auto-expanded gaps
// at or under the collapsed-context threshold, none in these fixtures).
function getDeclaredRowHeights(fileDiff: FileDiffMetadata): {
  split: number;
  unified: number;
} {
  return {
    split: countDeclaredRows(fileDiff, 'split') * metrics.lineHeight,
    unified: countDeclaredRows(fileDiff, 'unified') * metrics.lineHeight,
  };
}

function compute(
  fileDiff: FileDiffMetadata,
  options: Partial<
    Omit<ComputeEstimatedDiffHeightsOptions, 'fileDiff' | 'metrics'>
  > & { metrics?: VirtualFileMetrics } = {}
) {
  const { metrics: overrideMetrics = metrics, ...rest } = options;
  return computeEstimatedDiffHeights({
    fileDiff,
    metrics: overrideMetrics,
    disableFileHeader: false,
    hunkSeparators: 'line-info',
    expandUnchanged: false,
    expandedHunks: undefined,
    collapsedContextThreshold: DEFAULT_COLLAPSED_CONTEXT_THRESHOLD,
    canHydratePartialDiff: false,
    ...rest,
  });
}

describe('computeEstimatedDiffHeights', () => {
  test('returns only the top region when a diff has no hunks', () => {
    const fileDiff = parseDiffFromFile(
      { name: 'same.ts', contents: 'one\n' },
      { name: 'same.ts', contents: 'one\n' }
    );
    const paddingTop = 6;
    const headerRegion = metrics.diffHeaderHeight + paddingTop;

    // paddingBottom is skipped entirely when there are no hunks to render.
    expect(
      compute(fileDiff, {
        metrics: { ...metrics, paddingTop, paddingBottom: 13 },
      })
    ).toEqual({
      splitHeight: headerRegion,
      unifiedHeight: headerRegion,
    });
  });

  test('computes split and unified heights with no-newline metadata rows', () => {
    const fileDiff = parseDiffFromFile(
      { name: 'no-newline.ts', contents: 'one\ntwo' },
      { name: 'no-newline.ts', contents: 'one\nTWO' }
    );
    const rowHeights = getDeclaredRowHeights(fileDiff);
    // Both sides lose their trailing newline on the changed final line, so
    // split rendering shares one metadata row while unified rendering shows
    // one per side.
    const splitMetadataRows = 1;
    const unifiedMetadataRows = 2;

    expect(compute(fileDiff)).toEqual({
      splitHeight:
        metrics.diffHeaderHeight +
        rowHeights.split +
        splitMetadataRows * metrics.lineHeight +
        defaultPaddingBottom,
      unifiedHeight:
        metrics.diffHeaderHeight +
        rowHeights.unified +
        unifiedMetadataRows * metrics.lineHeight +
        defaultPaddingBottom,
    });
  });

  test('computes split metadata when the no-newline deletion side is shorter', () => {
    const fileDiff = parseDiffFromFile(
      { name: 'deletion-shorter.ts', contents: 'same\nold-final' },
      { name: 'deletion-shorter.ts', contents: 'same\nnew-a\nnew-b\n' }
    );
    const rowHeights = getDeclaredRowHeights(fileDiff);
    // Only the deletion side loses its trailing newline, producing a single
    // metadata row in both layouts.
    const metadataRows = 1;

    expect(compute(fileDiff)).toEqual({
      splitHeight:
        metrics.diffHeaderHeight +
        rowHeights.split +
        metadataRows * metrics.lineHeight +
        defaultPaddingBottom,
      unifiedHeight:
        metrics.diffHeaderHeight +
        rowHeights.unified +
        metadataRows * metrics.lineHeight +
        defaultPaddingBottom,
    });
  });

  test('computes split metadata when the no-newline addition side is shorter', () => {
    const fileDiff = parseDiffFromFile(
      { name: 'addition-shorter.ts', contents: 'same\nold-a\nold-b\n' },
      { name: 'addition-shorter.ts', contents: 'same\nnew-final' }
    );
    const rowHeights = getDeclaredRowHeights(fileDiff);
    // Only the addition side loses its trailing newline, producing a single
    // metadata row in both layouts.
    const metadataRows = 1;

    expect(compute(fileDiff)).toEqual({
      splitHeight:
        metrics.diffHeaderHeight +
        rowHeights.split +
        metadataRows * metrics.lineHeight +
        defaultPaddingBottom,
      unifiedHeight:
        metrics.diffHeaderHeight +
        rowHeights.unified +
        metadataRows * metrics.lineHeight +
        defaultPaddingBottom,
    });
  });

  test('accounts for collapsed leading and trailing line-info separators', () => {
    const fileDiff = createTwoHunkDiff();
    const rowHeights = getDeclaredRowHeights(fileDiff);

    expect(compute(fileDiff)).toEqual({
      splitHeight:
        metrics.diffHeaderHeight +
        firstLineInfoSeparatorHeight +
        rowHeights.split +
        middleLineInfoSeparatorHeight +
        trailingLineInfoSeparatorHeight +
        defaultPaddingBottom,
      unifiedHeight:
        metrics.diffHeaderHeight +
        firstLineInfoSeparatorHeight +
        rowHeights.unified +
        middleLineInfoSeparatorHeight +
        trailingLineInfoSeparatorHeight +
        defaultPaddingBottom,
    });
  });

  test('preserves current simple separator behavior', () => {
    const fileDiff = createTwoHunkDiff();
    const rowHeights = getDeclaredRowHeights(fileDiff);

    // 'simple' separators render no rule before the first hunk and reserve
    // nothing for trailing collapsed context, leaving only the middle rule.
    expect(compute(fileDiff, { hunkSeparators: 'simple' })).toEqual({
      splitHeight:
        metrics.diffHeaderHeight +
        rowHeights.split +
        simpleSeparatorHeight +
        defaultPaddingBottom,
      unifiedHeight:
        metrics.diffHeaderHeight +
        rowHeights.unified +
        simpleSeparatorHeight +
        defaultPaddingBottom,
    });
  });

  test('expands unchanged context as rows without separators', () => {
    const fileDiff = createTwoHunkDiff();
    // Full expansion renders every file line as one split row; unified adds
    // an extra row per single-line change (deletion plus addition rows).
    const splitRows = twoHunkFileLineCount;
    const unifiedRows = twoHunkFileLineCount + twoHunkChangedLines.length;

    expect(compute(fileDiff, { expandUnchanged: true })).toEqual({
      splitHeight:
        metrics.diffHeaderHeight +
        splitRows * metrics.lineHeight +
        defaultPaddingBottom,
      unifiedHeight:
        metrics.diffHeaderHeight +
        unifiedRows * metrics.lineHeight +
        defaultPaddingBottom,
    });
  });

  test('accounts for partially expanded leading context', () => {
    const fileDiff = createTwoHunkDiff();
    const rowHeights = getDeclaredRowHeights(fileDiff);
    const expansion = { fromStart: 2, fromEnd: 3 };
    const expandedHunks = new Map([[0, expansion]]);
    // Partial expansion renders fromStart + fromEnd context rows while the
    // remaining collapsed lines keep the first hunk's separator.
    const expandedRows = expansion.fromStart + expansion.fromEnd;

    expect(compute(fileDiff, { expandedHunks })).toEqual({
      splitHeight:
        metrics.diffHeaderHeight +
        expandedRows * metrics.lineHeight +
        firstLineInfoSeparatorHeight +
        rowHeights.split +
        middleLineInfoSeparatorHeight +
        trailingLineInfoSeparatorHeight +
        defaultPaddingBottom,
      unifiedHeight:
        metrics.diffHeaderHeight +
        expandedRows * metrics.lineHeight +
        firstLineInfoSeparatorHeight +
        rowHeights.unified +
        middleLineInfoSeparatorHeight +
        trailingLineInfoSeparatorHeight +
        defaultPaddingBottom,
    });
  });

  test('accounts for partially expanded trailing context from the start only', () => {
    const fileDiff = createTwoHunkDiff();
    const rowHeights = getDeclaredRowHeights(fileDiff);
    const expansion = { fromStart: 2, fromEnd: 3 };
    const expandedHunks = new Map([[fileDiff.hunks.length, expansion]]);
    // Trailing context only supports upward expansion, so fromEnd is ignored
    // and the still-collapsed remainder keeps its trailing separator.
    const expandedRows = expansion.fromStart;

    expect(compute(fileDiff, { expandedHunks })).toEqual({
      splitHeight:
        metrics.diffHeaderHeight +
        firstLineInfoSeparatorHeight +
        rowHeights.split +
        middleLineInfoSeparatorHeight +
        expandedRows * metrics.lineHeight +
        trailingLineInfoSeparatorHeight +
        defaultPaddingBottom,
      unifiedHeight:
        metrics.diffHeaderHeight +
        firstLineInfoSeparatorHeight +
        rowHeights.unified +
        middleLineInfoSeparatorHeight +
        expandedRows * metrics.lineHeight +
        trailingLineInfoSeparatorHeight +
        defaultPaddingBottom,
    });
  });

  test('does not reserve a synthetic trailing separator for partial diffs without a file loader', () => {
    const fileDiff = { ...createTwoHunkDiff(), isPartial: true };
    const rowHeights = getDeclaredRowHeights(fileDiff);

    // Without a loader the unknown partial tail cannot be expanded, so no
    // synthetic trailing separator is rendered or reserved.
    expect(compute(fileDiff)).toEqual({
      splitHeight:
        metrics.diffHeaderHeight +
        firstLineInfoSeparatorHeight +
        rowHeights.split +
        middleLineInfoSeparatorHeight +
        defaultPaddingBottom,
      unifiedHeight:
        metrics.diffHeaderHeight +
        firstLineInfoSeparatorHeight +
        rowHeights.unified +
        middleLineInfoSeparatorHeight +
        defaultPaddingBottom,
    });
  });

  test('reserves a synthetic trailing separator for partial diffs with a file loader', () => {
    const fileDiff = { ...createTwoHunkDiff(), isPartial: true };
    const rowHeights = getDeclaredRowHeights(fileDiff);

    expect(compute(fileDiff, { canHydratePartialDiff: true })).toEqual({
      splitHeight:
        metrics.diffHeaderHeight +
        firstLineInfoSeparatorHeight +
        rowHeights.split +
        middleLineInfoSeparatorHeight +
        trailingLineInfoSeparatorHeight +
        defaultPaddingBottom,
      unifiedHeight:
        metrics.diffHeaderHeight +
        firstLineInfoSeparatorHeight +
        rowHeights.unified +
        middleLineInfoSeparatorHeight +
        trailingLineInfoSeparatorHeight +
        defaultPaddingBottom,
    });
  });

  test('reserves metadata separators only for hunk specs', () => {
    const fileDiff = createTwoHunkDiff();
    const rowHeights = getDeclaredRowHeights(fileDiff);
    // 'metadata' separators render gapless before each hunk that carries
    // hunk specs and reserve nothing for trailing collapsed context.
    const hunksWithSpecs = fileDiff.hunks.filter(
      (hunk) => hunk.hunkSpecs != null
    );

    expect(hunksWithSpecs).toHaveLength(fileDiff.hunks.length);
    expect(compute(fileDiff, { hunkSeparators: 'metadata' })).toEqual({
      splitHeight:
        metrics.diffHeaderHeight +
        metadataSeparatorHeight * hunksWithSpecs.length +
        rowHeights.split +
        defaultPaddingBottom,
      unifiedHeight:
        metrics.diffHeaderHeight +
        metadataSeparatorHeight * hunksWithSpecs.length +
        rowHeights.unified +
        defaultPaddingBottom,
    });
  });
});

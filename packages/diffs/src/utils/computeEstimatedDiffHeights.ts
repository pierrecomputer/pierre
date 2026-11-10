import type {
  ChangeContent,
  FileDiffMetadata,
  Hunk,
  HunkExpansionRegion,
  HunkSeparators,
  VirtualFileMetrics,
} from '../types';
import {
  getVirtualFileHeaderRegion,
  getVirtualFilePaddingBottom,
} from './computeVirtualFileMetrics';
import { createFoldCursor, takeHiddenRows } from './foldCursor';
import { endsWithNewline } from './iterateOverDiff';
import {
  getExpandedRegion,
  getLeadingHunkSeparatorLayout,
  getTrailingExpandedRegion,
  getTrailingHunkSeparatorLayout,
} from './virtualDiffLayout';

export interface ComputeEstimatedDiffHeightsOptions {
  fileDiff: FileDiffMetadata;
  metrics: VirtualFileMetrics;
  disableFileHeader: boolean;
  hunkSeparators: HunkSeparators;
  expandUnchanged: boolean;
  expandedHunks: Map<number, HunkExpansionRegion> | true | undefined;
  collapsedContextThreshold: number;
  canHydratePartialDiff: boolean;
  // Count the row for the empty line after the final newline; see
  // IterateOverDiffProps.includeTrailingNewline.
  includeTrailingNewline?: boolean;
  // Count the "No newline at end of file" marker rows.
  showNoNewlineMarkers?: boolean;
  // The semantic folds the reader opened; see
  // IterateOverDiffProps.openSemanticFolds.
  openSemanticFolds?: ReadonlySet<number>;
}

export interface EstimatedDiffHeights {
  splitHeight: number;
  unifiedHeight: number;
}

// Computes both split and unified baseline heights from hunk-level metadata so
// callers can avoid replaying the detailed rendered-line iterator.
export function computeEstimatedDiffHeights({
  fileDiff,
  metrics,
  disableFileHeader,
  hunkSeparators,
  expandUnchanged,
  expandedHunks: configuredExpandedHunks,
  collapsedContextThreshold,
  canHydratePartialDiff,
  includeTrailingNewline = false,
  showNoNewlineMarkers = true,
  openSemanticFolds,
}: ComputeEstimatedDiffHeightsOptions): EstimatedDiffHeights {
  let splitHeight = getVirtualFileHeaderRegion(metrics, disableFileHeader);
  let unifiedHeight = splitHeight;
  const expandedHunks = expandUnchanged ? true : configuredExpandedHunks;
  const finalHunkIndex = fileDiff.hunks.length - 1;
  const foldCursor = createFoldCursor(fileDiff, openSemanticFolds);

  for (let hunkIndex = 0; hunkIndex < fileDiff.hunks.length; hunkIndex++) {
    const hunk = fileDiff.hunks[hunkIndex];
    if (hunk == null) {
      throw new Error('computeEstimatedDiffHeights: invalid hunk index');
    }
    const hiddenRows =
      foldCursor != null ? takeHiddenRows(foldCursor, hunk) : 0;

    const leadingRegion = getExpandedRegion({
      isPartial: fileDiff.isPartial,
      rangeSize: hunk.collapsedBefore,
      expandedHunks,
      hunkIndex,
      collapsedContextThreshold,
    });
    const leadingExpandedHeight =
      (leadingRegion.fromStart + leadingRegion.fromEnd) * metrics.lineHeight;
    splitHeight += leadingExpandedHeight;
    unifiedHeight += leadingExpandedHeight;

    if (leadingRegion.collapsedLines > 0) {
      const separatorHeight =
        getLeadingHunkSeparatorLayout({
          type: hunkSeparators,
          metrics,
          hunkIndex,
          hunkSpecs: hunk.hunkSpecs,
        })?.totalHeight ?? 0;
      splitHeight += separatorHeight;
      unifiedHeight += separatorHeight;
    }

    splitHeight += (hunk.splitLineCount - hiddenRows) * metrics.lineHeight;
    unifiedHeight += (hunk.unifiedLineCount - hiddenRows) * metrics.lineHeight;

    if (showNoNewlineMarkers) {
      const metadataLineCounts = getNoNewlineMetadataLineCounts(
        hunk,
        foldCursor?.hidesLastOldLine === true
      );
      splitHeight += metadataLineCounts.split * metrics.lineHeight;
      unifiedHeight += metadataLineCounts.unified * metrics.lineHeight;
    }

    const trailingRegion =
      hunkIndex === finalHunkIndex
        ? getTrailingExpandedRegion({
            fileDiff,
            hunkIndex,
            expandedHunks,
            collapsedContextThreshold,
            errorPrefix: 'computeEstimatedDiffHeights',
          })
        : undefined;
    if (trailingRegion != null) {
      const trailingExpandedHeight =
        (trailingRegion.fromStart + trailingRegion.fromEnd) *
        metrics.lineHeight;
      splitHeight += trailingExpandedHeight;
      unifiedHeight += trailingExpandedHeight;

      if (trailingRegion.collapsedLines > 0) {
        const separatorHeight =
          getTrailingHunkSeparatorLayout({
            type: hunkSeparators,
            metrics,
          })?.totalHeight ?? 0;
        splitHeight += separatorHeight;
        unifiedHeight += separatorHeight;
      }
    } else if (
      hunkIndex === finalHunkIndex &&
      fileDiff.isPartial &&
      canHydratePartialDiff
    ) {
      const separatorHeight =
        getTrailingHunkSeparatorLayout({
          type: hunkSeparators,
          metrics,
        })?.totalHeight ?? 0;
      splitHeight += separatorHeight;
      unifiedHeight += separatorHeight;
    }

    if (
      includeTrailingNewline &&
      hunkIndex === finalHunkIndex &&
      (trailingRegion?.collapsedLines ?? 0) === 0 &&
      endsWithNewline(fileDiff, 'additions')
    ) {
      splitHeight += metrics.lineHeight;
      unifiedHeight += metrics.lineHeight;
    }
  }

  if (fileDiff.hunks.length > 0) {
    const paddingBottom = getVirtualFilePaddingBottom(metrics);
    splitHeight += paddingBottom;
    unifiedHeight += paddingBottom;
  }

  return { splitHeight, unifiedHeight };
}

// The "No newline at end of file" marker rows a hunk shows in each view.
// `hidesLastOldLine` is whether a closed semantic fold hides the hunk's last
// old line, which leaves the old side without a marker.
function getNoNewlineMetadataLineCounts(
  hunk: Hunk,
  hidesLastOldLine: boolean
): {
  split: number;
  unified: number;
} {
  if (!hunk.noEOFCRAdditions && !hunk.noEOFCRDeletions) {
    return { split: 0, unified: 0 };
  }

  const lastContent = hunk.hunkContent.at(-1);
  if (lastContent == null) {
    return { split: 0, unified: 0 };
  }

  if (lastContent.type === 'context') {
    const metadataRows = lastContent.lines > 0 ? 1 : 0;
    return { split: metadataRows, unified: metadataRows };
  }

  return getChangeNoNewlineMetadataLineCounts(
    hunk,
    lastContent,
    hidesLastOldLine
  );
}

function getChangeNoNewlineMetadataLineCounts(
  hunk: Hunk,
  content: ChangeContent,
  hidesLastOldLine: boolean
): { split: number; unified: number } {
  if (hidesLastOldLine) {
    // The fold's row is the hunk's last row in the split view, and the new
    // side's marker hangs under it.
    return {
      split: hunk.noEOFCRAdditions ? 1 : 0,
      unified: content.additions > 0 && hunk.noEOFCRAdditions ? 1 : 0,
    };
  }
  const unified =
    (content.deletions > 0 && hunk.noEOFCRDeletions ? 1 : 0) +
    (content.additions > 0 && hunk.noEOFCRAdditions ? 1 : 0);
  const splitDeletionHasMetadata =
    content.deletions > 0 && hunk.noEOFCRDeletions;
  const splitAdditionHasMetadata =
    content.additions > 0 && hunk.noEOFCRAdditions;
  const split = splitDeletionHasMetadata || splitAdditionHasMetadata ? 1 : 0;

  return { split, unified };
}

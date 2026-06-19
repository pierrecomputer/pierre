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
}: ComputeEstimatedDiffHeightsOptions): EstimatedDiffHeights {
  let splitHeight = getVirtualFileHeaderRegion(metrics, disableFileHeader);
  let unifiedHeight = splitHeight;
  const expandedHunks = expandUnchanged ? true : configuredExpandedHunks;
  const finalHunkIndex = fileDiff.hunks.length - 1;

  for (let hunkIndex = 0; hunkIndex < fileDiff.hunks.length; hunkIndex++) {
    const hunk = fileDiff.hunks[hunkIndex];
    if (hunk == null) {
      throw new Error('computeEstimatedDiffHeights: invalid hunk index');
    }

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

    splitHeight += hunk.splitLineCount * metrics.lineHeight;
    unifiedHeight += hunk.unifiedLineCount * metrics.lineHeight;

    const metadataLineCounts = getNoNewlineMetadataLineCounts(hunk);
    splitHeight += metadataLineCounts.split * metrics.lineHeight;
    unifiedHeight += metadataLineCounts.unified * metrics.lineHeight;

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
  }

  if (fileDiff.hunks.length > 0) {
    const paddingBottom = getVirtualFilePaddingBottom(metrics);
    splitHeight += paddingBottom;
    unifiedHeight += paddingBottom;
  }

  return { splitHeight, unifiedHeight };
}

function getNoNewlineMetadataLineCounts(hunk: Hunk): {
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

  return getChangeNoNewlineMetadataLineCounts(hunk, lastContent);
}
function getChangeNoNewlineMetadataLineCounts(
  hunk: Hunk,
  content: ChangeContent
): { split: number; unified: number } {
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

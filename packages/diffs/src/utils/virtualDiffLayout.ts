import type {
  FileDiffMetadata,
  HunkExpansionRegion,
  HunkSeparators,
  VirtualFileMetrics,
} from '../types';
import { getDefaultHunkSeparatorHeight } from './computeVirtualFileMetrics';

export interface ExpandedRegionResult {
  fromStart: number;
  fromEnd: number;
  rangeSize: number;
  collapsedLines: number;
  renderAll: boolean;
}

export interface GetExpandedRegionProps {
  isPartial: boolean;
  rangeSize: number;
  expandedHunks: Map<number, HunkExpansionRegion> | true | undefined;
  hunkIndex: number;
  collapsedContextThreshold: number;
}

export interface GetTrailingContextRangeSizeProps {
  fileDiff: FileDiffMetadata;
  errorPrefix: string;
}

export interface GetTrailingExpandedRegionProps extends GetTrailingContextRangeSizeProps {
  hunkIndex: number;
  expandedHunks: GetExpandedRegionProps['expandedHunks'];
  collapsedContextThreshold: number;
}

export interface HunkSeparatorLayout {
  height: number;
  gapBefore: number;
  gapAfter: number;
  totalHeight: number;
}

interface HunkSeparatorBaseProps {
  type: HunkSeparators;
  metrics: VirtualFileMetrics;
}

interface LeadingHunkSeparatorLayoutProps extends HunkSeparatorBaseProps {
  hunkIndex: number;
  hunkSpecs: string | undefined;
}

// Converts a collapsed unchanged range into the slices that should render near
// the start and end of that range for the active hunk expansion state.
export function getExpandedRegion({
  isPartial,
  rangeSize,
  expandedHunks,
  hunkIndex,
  collapsedContextThreshold,
}: GetExpandedRegionProps): ExpandedRegionResult {
  const normalizedRangeSize = Math.max(rangeSize, 0);
  if (normalizedRangeSize === 0 || isPartial) {
    return {
      fromStart: 0,
      fromEnd: 0,
      rangeSize: normalizedRangeSize,
      collapsedLines: normalizedRangeSize,
      renderAll: false,
    };
  }

  if (
    expandedHunks === true ||
    normalizedRangeSize <= collapsedContextThreshold
  ) {
    return {
      fromStart: normalizedRangeSize,
      fromEnd: 0,
      rangeSize: normalizedRangeSize,
      collapsedLines: 0,
      renderAll: true,
    };
  }

  const region = expandedHunks?.get(hunkIndex);
  const fromStart = Math.min(
    Math.max(region?.fromStart ?? 0, 0),
    normalizedRangeSize
  );
  const fromEnd = Math.min(
    Math.max(region?.fromEnd ?? 0, 0),
    normalizedRangeSize
  );
  const expandedCount = fromStart + fromEnd;
  const renderAll = expandedCount >= normalizedRangeSize;
  return {
    fromStart: renderAll ? normalizedRangeSize : fromStart,
    fromEnd: renderAll ? 0 : fromEnd,
    rangeSize: normalizedRangeSize,
    collapsedLines: Math.max(normalizedRangeSize - expandedCount, 0),
    renderAll,
  };
}

export function hasTrailingContext(fileDiff: FileDiffMetadata): boolean {
  const lastHunk = fileDiff.hunks[fileDiff.hunks.length - 1];
  if (
    lastHunk == null ||
    fileDiff.isPartial ||
    fileDiff.additionLines.length === 0 ||
    fileDiff.deletionLines.length === 0
  ) {
    return false;
  }

  const additionRemaining =
    fileDiff.additionLines.length -
    (lastHunk.additionLineIndex + lastHunk.additionCount);
  const deletionRemaining =
    fileDiff.deletionLines.length -
    (lastHunk.deletionLineIndex + lastHunk.deletionCount);

  return additionRemaining > 0 || deletionRemaining > 0;
}

// Returns true when trailing-context line counts disagree between sides.
export function hasTrailingContextMismatch(
  fileDiff: FileDiffMetadata
): boolean {
  const lastHunk = fileDiff.hunks[fileDiff.hunks.length - 1];
  if (
    lastHunk == null ||
    fileDiff.isPartial ||
    fileDiff.additionLines.length === 0 ||
    fileDiff.deletionLines.length === 0
  ) {
    return false;
  }

  const additionRemaining =
    fileDiff.additionLines.length -
    (lastHunk.additionLineIndex + lastHunk.additionCount);
  const deletionRemaining =
    fileDiff.deletionLines.length -
    (lastHunk.deletionLineIndex + lastHunk.deletionCount);

  if (additionRemaining <= 0 && deletionRemaining <= 0) {
    return false;
  }

  return additionRemaining !== deletionRemaining;
}

// Measures the unchanged tail after the final hunk. Both sides must have the
// same remaining length because trailing context represents paired lines.
export function getTrailingContextRangeSize({
  fileDiff,
  errorPrefix,
}: GetTrailingContextRangeSizeProps): number {
  const lastHunk = fileDiff.hunks[fileDiff.hunks.length - 1];
  if (
    lastHunk == null ||
    fileDiff.isPartial ||
    fileDiff.additionLines.length === 0 ||
    fileDiff.deletionLines.length === 0
  ) {
    return 0;
  }

  const additionRemaining =
    fileDiff.additionLines.length -
    (lastHunk.additionLineIndex + lastHunk.additionCount);
  const deletionRemaining =
    fileDiff.deletionLines.length -
    (lastHunk.deletionLineIndex + lastHunk.deletionCount);

  if (additionRemaining <= 0 && deletionRemaining <= 0) {
    return 0;
  }

  if (additionRemaining !== deletionRemaining) {
    throw new Error(
      `${errorPrefix}: trailing context mismatch (additions=${additionRemaining}, deletions=${deletionRemaining}) for ${fileDiff.name}`
    );
  }
  return Math.min(additionRemaining, deletionRemaining);
}

export function getTrailingExpandedRegion({
  fileDiff,
  hunkIndex,
  expandedHunks,
  collapsedContextThreshold,
  errorPrefix,
}: GetTrailingExpandedRegionProps): ExpandedRegionResult | undefined {
  if (hunkIndex !== fileDiff.hunks.length - 1) {
    return undefined;
  }

  const trailingRangeSize = getTrailingContextRangeSize({
    fileDiff,
    errorPrefix,
  });
  if (trailingRangeSize <= 0) {
    return undefined;
  }

  if (
    expandedHunks === true ||
    trailingRangeSize <= collapsedContextThreshold
  ) {
    return {
      fromStart: trailingRangeSize,
      fromEnd: 0,
      rangeSize: trailingRangeSize,
      collapsedLines: 0,
      renderAll: true,
    };
  }

  // The final trailing separator only exposes upward partial expansion. Treat it
  // as a bottom-only pseudo-hunk and ignore unsupported downward expansion.
  const region = expandedHunks?.get(fileDiff.hunks.length);
  const fromStart = Math.min(
    Math.max(region?.fromStart ?? 0, 0),
    trailingRangeSize
  );
  return {
    fromStart,
    fromEnd: 0,
    rangeSize: trailingRangeSize,
    collapsedLines: trailingRangeSize - fromStart,
    renderAll: fromStart >= trailingRangeSize,
  };
}

export function getHunkSeparatorHeight({
  type,
  metrics,
}: HunkSeparatorBaseProps): number {
  return metrics.hunkSeparatorHeight ?? getDefaultHunkSeparatorHeight(type);
}

export function getHunkSeparatorGap({
  type,
  metrics,
}: HunkSeparatorBaseProps): number {
  return type === 'simple' || type === 'metadata' || type === 'line-info-basic'
    ? 0
    : metrics.spacing;
}

export function hasLeadingHunkSeparator({
  type,
  hunkIndex,
  hunkSpecs,
}: Omit<LeadingHunkSeparatorLayoutProps, 'metrics'>): boolean {
  switch (type) {
    case 'simple':
      return hunkIndex > 0;
    case 'metadata':
      return hunkSpecs != null;
    case 'line-info':
    case 'line-info-basic':
    case 'custom':
      return true;
  }
}

export function hasTrailingHunkSeparator(type: HunkSeparators): boolean {
  return type !== 'simple' && type !== 'metadata';
}

// Mirrors the renderer/CSS spacing rules for the separator shown before a hunk.
export function getLeadingHunkSeparatorLayout({
  type,
  metrics,
  hunkIndex,
  hunkSpecs,
}: LeadingHunkSeparatorLayoutProps): HunkSeparatorLayout | undefined {
  if (!hasLeadingHunkSeparator({ type, hunkIndex, hunkSpecs })) {
    return undefined;
  }

  const height = getHunkSeparatorHeight({ type, metrics });
  const gap = getHunkSeparatorGap({ type, metrics });
  const gapBefore = hunkIndex > 0 ? gap : 0;
  const gapAfter = gap;
  return {
    height,
    gapBefore,
    gapAfter,
    totalHeight: gapBefore + height + gapAfter,
  };
}

// Mirrors the renderer/CSS spacing rules for the separator shown after the last
// hunk when trailing unchanged context is collapsed.
export function getTrailingHunkSeparatorLayout({
  type,
  metrics,
}: HunkSeparatorBaseProps): HunkSeparatorLayout | undefined {
  if (!hasTrailingHunkSeparator(type)) {
    return undefined;
  }

  const height = getHunkSeparatorHeight({ type, metrics });
  const gapBefore = getHunkSeparatorGap({ type, metrics });
  return {
    height,
    gapBefore,
    gapAfter: 0,
    totalHeight: gapBefore + height,
  };
}

import type {
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

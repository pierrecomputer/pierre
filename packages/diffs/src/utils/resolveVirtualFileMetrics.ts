import { DEFAULT_VIRTUAL_FILE_METRICS } from '../constants';
import type { HunkSeparators, VirtualFileMetrics } from '../types';

export function resolveVirtualFileMetrics(
  hunkSeparators: HunkSeparators,
  metricsOverride?: Partial<VirtualFileMetrics>
): VirtualFileMetrics {
  const metrics: VirtualFileMetrics = {
    ...DEFAULT_VIRTUAL_FILE_METRICS,
    ...metricsOverride,
  };
  metrics.hunkSeparatorHeight = getHunkSeparatorHeight(
    hunkSeparators,
    metricsOverride?.hunkSeparatorHeight
  );
  return metrics;
}

export function getVirtualFileHeaderRegion(
  metrics: VirtualFileMetrics,
  disableFileHeader: boolean
): number {
  const paddingTop = getVirtualFilePaddingTop(metrics, disableFileHeader);
  return disableFileHeader ? paddingTop : metrics.diffHeaderHeight + paddingTop;
}

export function getVirtualFilePaddingTop(
  metrics: VirtualFileMetrics,
  disableFileHeader: boolean
): number {
  return metrics.paddingTop ?? (disableFileHeader ? metrics.spacing : 0);
}

export function getVirtualFilePaddingBottom(
  metrics: VirtualFileMetrics
): number {
  return metrics.paddingBottom ?? metrics.spacing;
}

function getHunkSeparatorHeight(
  type: HunkSeparators,
  customHeight: number | undefined
): number {
  if (customHeight != null) {
    return customHeight;
  }
  switch (type) {
    case 'simple':
      return 4;
    case 'metadata':
    case 'line-info':
    case 'line-info-basic':
    case 'custom':
      return 32;
  }
}

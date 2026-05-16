import { DEFAULT_VIRTUAL_FILE_METRICS } from '../constants';
import type { HunkSeparators, VirtualFileMetrics } from '../types';

export function computeVirtualFileMetrics(
  metrics?: Partial<VirtualFileMetrics>
): VirtualFileMetrics {
  return {
    ...DEFAULT_VIRTUAL_FILE_METRICS,
    ...metrics,
  };
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

export function getDefaultHunkSeparatorHeight(type: HunkSeparators): number {
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

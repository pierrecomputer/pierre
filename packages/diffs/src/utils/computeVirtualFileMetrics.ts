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
  return (
    getVirtualFileHeaderHeight(metrics, disableFileHeader) +
    getVirtualFilePaddingTop(metrics, disableFileHeader)
  );
}

// Collapsed items render only the header. The top padding belongs to the
// code content, which is removed on collapse.
export function getVirtualFileHeaderHeight(
  metrics: VirtualFileMetrics,
  disableFileHeader: boolean
): number {
  return disableFileHeader ? 0 : metrics.diffHeaderHeight;
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

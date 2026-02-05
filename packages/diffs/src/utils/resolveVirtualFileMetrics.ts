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
    case 'custom':
      return 32;
  }
}

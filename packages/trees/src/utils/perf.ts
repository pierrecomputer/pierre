import type { FileTreePerformanceEvent } from '../FileTree';

export const now = (): number => performance.now();

export type PerfCallback = (event: FileTreePerformanceEvent) => void;

export const reportDuration = (
  onPerformanceEvent: PerfCallback | undefined,
  phase: FileTreePerformanceEvent['phase'],
  startTime: number,
  details?: FileTreePerformanceEvent['details']
): void => {
  if (onPerformanceEvent == null) return;
  onPerformanceEvent({
    phase,
    durationMs: now() - startTime,
    ...(details != null && { details }),
  });
};

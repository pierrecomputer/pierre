import type { BenchmarkInstrumentation } from '../../../src/internal/benchmarkInstrumentation';

interface BenchmarkPhaseAggregate {
  totalMs: number;
  count: number;
}

interface HeapSnapshot {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

interface ChromePerformanceMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

export interface BenchmarkInstrumentationSummary {
  phases: Array<{
    name: string;
    durationMs: number;
    count: number;
  }>;
  counters: Record<string, number>;
  heap: {
    usedJSHeapSizeBeforeBytes: number;
    usedJSHeapSizeAfterBytes: number;
    usedJSHeapSizeDeltaBytes: number;
    totalJSHeapSizeAfterBytes: number;
    jsHeapSizeLimitBytes: number;
  } | null;
}

const now = (): number => {
  if (typeof performance !== 'undefined') {
    return performance.now();
  }
  return Date.now();
};

export function createBenchmarkInstrumentation(): {
  instrumentation: BenchmarkInstrumentation;
  readHeapSnapshot: () => HeapSnapshot | null;
  summarize: (
    heapBefore: HeapSnapshot | null,
    heapAfter: HeapSnapshot | null
  ) => BenchmarkInstrumentationSummary;
} {
  const phaseTotals: Record<string, BenchmarkPhaseAggregate> = {};
  const counters: Record<string, number> = {};

  const instrumentation: BenchmarkInstrumentation = {
    measurePhase(name, fn) {
      const startedAt = now();
      try {
        return fn();
      } finally {
        const durationMs = now() - startedAt;
        if (Number.isFinite(durationMs) && durationMs >= 0) {
          const existing = phaseTotals[name] ?? {
            totalMs: 0,
            count: 0,
          };
          existing.totalMs += durationMs;
          existing.count += 1;
          phaseTotals[name] = existing;
        }
      }
    },
    setCounter(name, value) {
      if (!Number.isFinite(value)) {
        return;
      }
      counters[name] = value;
    },
  };

  const readHeapSnapshot = (): HeapSnapshot | null => {
    const memory = (
      performance as Performance & {
        memory?: ChromePerformanceMemory;
      }
    ).memory;
    if (memory == null) {
      return null;
    }

    return {
      usedJSHeapSize: memory.usedJSHeapSize,
      totalJSHeapSize: memory.totalJSHeapSize,
      jsHeapSizeLimit: memory.jsHeapSizeLimit,
    };
  };

  const summarize = (
    heapBefore: HeapSnapshot | null,
    heapAfter: HeapSnapshot | null
  ): BenchmarkInstrumentationSummary => {
    return {
      phases: Object.entries(phaseTotals).map(([name, aggregate]) => ({
        name,
        durationMs: aggregate.totalMs,
        count: aggregate.count,
      })),
      counters: { ...counters },
      heap:
        heapBefore == null || heapAfter == null
          ? null
          : {
              usedJSHeapSizeBeforeBytes: heapBefore.usedJSHeapSize,
              usedJSHeapSizeAfterBytes: heapAfter.usedJSHeapSize,
              usedJSHeapSizeDeltaBytes:
                heapAfter.usedJSHeapSize - heapBefore.usedJSHeapSize,
              totalJSHeapSizeAfterBytes: heapAfter.totalJSHeapSize,
              jsHeapSizeLimitBytes: heapAfter.jsHeapSizeLimit,
            },
    };
  };

  return {
    instrumentation,
    readHeapSnapshot,
    summarize,
  };
}

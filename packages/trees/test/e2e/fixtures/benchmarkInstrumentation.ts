import { attachBenchmarkInstrumentation } from '../../../dist/internal/benchmarkInstrumentation.js';

interface BenchmarkInstrumentation {
  measurePhase: <TValue>(name: string, fn: () => TValue) => TValue;
  setCounter: (name: string, value: number) => void;
}

interface BenchmarkPhaseAggregate {
  inclusiveMs: number;
  exclusiveMs: number;
  count: number;
}

interface BenchmarkPhaseFrame {
  childDurationMs: number;
  name: string;
  startedAt: number;
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
    selfDurationMs: number;
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
  attach: <TValue extends object>(value: TValue) => TValue;
  instrumentation: BenchmarkInstrumentation;
  readHeapSnapshot: () => HeapSnapshot | null;
  summarize: (
    heapBefore: HeapSnapshot | null,
    heapAfter: HeapSnapshot | null
  ) => BenchmarkInstrumentationSummary;
} {
  const phaseTotals: Record<string, BenchmarkPhaseAggregate> = {};
  const counters: Record<string, number> = {};
  const phaseStack: BenchmarkPhaseFrame[] = [];

  const instrumentation: BenchmarkInstrumentation = {
    measurePhase(name, fn) {
      const frame: BenchmarkPhaseFrame = {
        childDurationMs: 0,
        name,
        startedAt: now(),
      };
      phaseStack.push(frame);
      try {
        return fn();
      } finally {
        phaseStack.pop();
        const durationMs = now() - frame.startedAt;
        const exclusiveMs = Math.max(0, durationMs - frame.childDurationMs);
        if (Number.isFinite(durationMs) && durationMs >= 0) {
          const existing = phaseTotals[name] ?? {
            inclusiveMs: 0,
            exclusiveMs: 0,
            count: 0,
          };
          existing.inclusiveMs += durationMs;
          existing.exclusiveMs += exclusiveMs;
          existing.count += 1;
          phaseTotals[name] = existing;
        }
        const parentFrame = phaseStack.at(-1);
        if (parentFrame != null) {
          parentFrame.childDurationMs += durationMs;
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
        durationMs: aggregate.inclusiveMs,
        selfDurationMs: aggregate.exclusiveMs,
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
    attach: (value) => attachBenchmarkInstrumentation(value, instrumentation),
    instrumentation,
    readHeapSnapshot,
    summarize,
  };
}

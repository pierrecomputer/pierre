const now = () => {
  if (typeof performance !== 'undefined') {
    return performance.now();
  }

  return Date.now();
};

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    value != null &&
    (typeof value === 'object' || typeof value === 'function') &&
    'then' in value &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

interface BenchmarkPhaseFrame {
  childDurationMs: number;
  name: string;
  startedAt: number;
}

interface BenchmarkPhaseAggregate {
  count: number;
  exclusiveMs: number;
  inclusiveMs: number;
}

interface HeapSnapshot {
  jsHeapSizeLimit: number;
  totalJSHeapSize: number;
  usedJSHeapSize: number;
}

export function createBenchmarkInstrumentation() {
  const phaseTotals: Record<string, BenchmarkPhaseAggregate> = {};
  const counters: Record<string, number> = {};
  const phaseStack: BenchmarkPhaseFrame[] = [];

  const instrumentation = {
    measurePhase<TValue>(name: string, fn: () => TValue): TValue {
      const frame: BenchmarkPhaseFrame = {
        childDurationMs: 0,
        name,
        startedAt: now(),
      };
      phaseStack.push(frame);

      const finalize = () => {
        phaseStack.pop();
        const durationMs = now() - frame.startedAt;
        const exclusiveMs = Math.max(0, durationMs - frame.childDurationMs);

        if (Number.isFinite(durationMs) && durationMs >= 0) {
          const existing = phaseTotals[name] ?? {
            count: 0,
            exclusiveMs: 0,
            inclusiveMs: 0,
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
      };

      try {
        const result = fn();
        if (isPromiseLike(result)) {
          return Promise.resolve(result).finally(finalize) as TValue;
        }

        finalize();
        return result;
      } catch (error) {
        finalize();
        throw error;
      }
    },
    setCounter(name: string, value: number): void {
      if (!Number.isFinite(value)) {
        return;
      }

      counters[name] = value;
    },
  };

  const reset = () => {
    for (const phaseName of Object.keys(phaseTotals)) {
      delete phaseTotals[phaseName];
    }

    for (const counterName of Object.keys(counters)) {
      delete counters[counterName];
    }

    phaseStack.length = 0;
  };

  const readHeapSnapshot = (): HeapSnapshot | null => {
    const memory = performance.memory;
    if (memory == null) {
      return null;
    }

    return {
      jsHeapSizeLimit: memory.jsHeapSizeLimit,
      totalJSHeapSize: memory.totalJSHeapSize,
      usedJSHeapSize: memory.usedJSHeapSize,
    };
  };

  return {
    instrumentation,
    readHeapSnapshot,
    reset,
    summarize(heapBefore: HeapSnapshot | null, heapAfter: HeapSnapshot | null) {
      return {
        counters: { ...counters },
        heap:
          heapBefore == null || heapAfter == null
            ? null
            : {
                jsHeapSizeLimitBytes: heapAfter.jsHeapSizeLimit,
                totalJSHeapSizeAfterBytes: heapAfter.totalJSHeapSize,
                usedJSHeapSizeAfterBytes: heapAfter.usedJSHeapSize,
                usedJSHeapSizeBeforeBytes: heapBefore.usedJSHeapSize,
                usedJSHeapSizeDeltaBytes:
                  heapAfter.usedJSHeapSize - heapBefore.usedJSHeapSize,
              },
        phases: Object.entries(phaseTotals).map(([name, aggregate]) => ({
          count: aggregate.count,
          durationMs: aggregate.inclusiveMs,
          name,
          selfDurationMs: aggregate.exclusiveMs,
        })),
      };
    },
  };
}

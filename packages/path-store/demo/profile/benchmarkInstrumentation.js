import { attachBenchmarkInstrumentation } from '../../src/internal/benchmarkInstrumentation.ts';

const now = () => {
  if (typeof performance !== 'undefined') {
    return performance.now();
  }

  return Date.now();
};

/**
 * @typedef {{
 *   childDurationMs: number;
 *   name: string;
 *   startedAt: number;
 * }} BenchmarkPhaseFrame
 */

/**
 * @typedef {{
 *   count: number;
 *   exclusiveMs: number;
 *   inclusiveMs: number;
 * }} BenchmarkPhaseAggregate
 */

/**
 * @typedef {{
 *   jsHeapSizeLimit: number;
 *   totalJSHeapSize: number;
 *   usedJSHeapSize: number;
 * }} HeapSnapshot
 */

export function createBenchmarkInstrumentation() {
  /** @type {Record<string, BenchmarkPhaseAggregate>} */
  const phaseTotals = {};
  /** @type {Record<string, number>} */
  const counters = {};
  /** @type {BenchmarkPhaseFrame[]} */
  const phaseStack = [];

  /**
   * @type {{
   *   measurePhase: <TValue>(name: string, fn: () => TValue) => TValue;
   *   setCounter: (name: string, value: number) => void;
   * }}
   */
  const instrumentation = {
    /**
     * @template TValue
     * @param {string} name
     * @param {() => TValue} fn
     * @returns {TValue}
     */
    measurePhase(name, fn) {
      const frame = {
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
      }
    },
    setCounter(name, value) {
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

  /**
   * @returns {HeapSnapshot | null}
   */
  const readHeapSnapshot = () => {
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
    /**
     * @template TValue extends object
     * @param {TValue} value
     * @returns {TValue}
     */
    attach(value) {
      return attachBenchmarkInstrumentation(value, instrumentation);
    },
    instrumentation,
    readHeapSnapshot,
    reset,
    summarize(heapBefore, heapAfter) {
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

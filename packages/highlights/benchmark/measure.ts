export interface Measurement {
  median: number;
  p95: number;
  samples: number;
  iterations: number;
}

export interface MeasurementCase {
  run: () => unknown;
  /** Untimed cleanup after each call, including warmup. */
  afterEach?: () => void;
}

// Keep results observable without walking outputs of different sizes.
export let lastResult: unknown;

// Warm every contender, then rotate batches with the same budget per case.
// Throughput samples average ~5 ms batches; batch:false measures call latency.
// Cleanup is excluded from samples but counts toward the runtime budget;
// otherwise fast edits with expensive deferred work can run for minutes.
// Cases with cleanup always run one call per sample.
export function measure(
  cases: readonly ((() => unknown) | MeasurementCase)[],
  { batch = true }: { batch?: boolean } = {}
): Measurement[] {
  const states = cases.map((entry) => ({
    ...(typeof entry === 'function' ? { run: entry } : entry),
    batch: 1,
    elapsed: 0,
    iterations: 0,
    samples: [] as number[],
  }));
  for (const warmup of [true, false]) {
    const budget = warmup ? 200 : 1500;
    const minimum = warmup ? 3 : 20;
    for (const state of states) {
      state.elapsed = 0;
      state.iterations = 0;
    }
    for (let round = 0; ; round++) {
      let complete = true;
      for (let offset = 0; offset < states.length; offset++) {
        const state = states[(round + offset) % states.length];
        if (
          state.elapsed >= budget &&
          (warmup ? state.iterations : state.samples.length) >= minimum
        ) {
          continue;
        }
        complete = false;
        let elapsed: number;
        const start = performance.now();
        try {
          for (let i = 0; i < state.batch; i++) lastResult = state.run();
        } finally {
          elapsed = performance.now() - start;
          state.afterEach?.();
        }
        state.elapsed +=
          state.afterEach == null ? elapsed : performance.now() - start;
        state.iterations += state.batch;
        if (warmup && batch && state.afterEach == null) {
          state.batch = Math.max(
            1,
            Math.min(
              state.batch * 2,
              Math.ceil((state.batch * 5) / Math.max(elapsed, 0.001))
            )
          );
        } else if (!warmup) {
          state.samples.push(elapsed / state.batch);
        }
      }
      if (complete) break;
    }
  }
  return states.map(({ samples, iterations }) => {
    samples.sort((a, b) => a - b);
    const middle = Math.floor(samples.length / 2);
    return {
      median:
        samples.length % 2 === 0
          ? (samples[middle - 1] + samples[middle]) / 2
          : samples[middle],
      p95: samples[Math.ceil(samples.length * 0.95) - 1],
      samples: samples.length,
      iterations,
    };
  });
}

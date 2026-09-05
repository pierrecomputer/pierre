export interface Measurement {
  median: number;
  samples: number;
  iterations: number;
}

// Keep results observable without walking outputs of different sizes.
export let lastResult: unknown;

// Warm every contender, then rotate batches so each gets the same timed budget.
// Each sample is the per-call average of a batch calibrated to about 5 ms.
export function measure(cases: (() => unknown)[]): Measurement[] {
  const states = cases.map((fn) => ({
    fn,
    batch: 1,
    elapsed: 0,
    iterations: 0,
    samples: [] as number[],
  }));
  for (const warmup of [true, false]) {
    const budget = warmup ? 200 : 1500;
    const minimum = warmup ? 3 : 10;
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
        const start = performance.now();
        for (let i = 0; i < state.batch; i++) lastResult = state.fn();
        const elapsed = performance.now() - start;
        state.elapsed += elapsed;
        state.iterations += state.batch;
        if (warmup) {
          state.batch = Math.max(
            1,
            Math.min(
              state.batch * 2,
              Math.ceil((state.batch * 5) / Math.max(elapsed, 0.001))
            )
          );
        } else {
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
      samples: samples.length,
      iterations,
    };
  });
}

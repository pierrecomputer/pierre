import assert from 'node:assert/strict';

/** Fixed-seed ordering and bootstrap sampling make a saved run reproducible. */
export function randomGenerator(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(values, random) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function median(values) {
  assert(values.length > 0, 'Cannot summarize zero samples');
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Summarize batch means, not individual request-latency percentiles. */
export function summarize(samples) {
  assert(samples.length > 0, 'Cannot summarize zero samples');
  for (const value of samples)
    assert(
      Number.isFinite(value) && value > 0,
      'Timing must be finite and positive'
    );
  const center = median(samples);
  const half = Math.floor(samples.length / 2);
  return {
    medianMs: center,
    meanMs: samples.reduce((sum, value) => sum + value, 0) / samples.length,
    minMs: Math.min(...samples),
    maxMs: Math.max(...samples),
    relativeMad:
      median(samples.map((value) => Math.abs(value - center))) / center,
    lastVsFirst: half
      ? median(samples.slice(-half)) / median(samples.slice(0, half))
      : null,
  };
}

/** Resample independent process pairs, never the correlated batches within them. */
export function comparePairs(
  pairs,
  { seed = 1, resamples = 10000, threshold = 0.02, confirm = false } = {}
) {
  assert(pairs.length > 0, 'Comparison requires process pairs');
  assert(
    Number.isFinite(threshold) && threshold >= 0 && threshold < 1,
    'Invalid practical threshold'
  );
  assert(
    Number.isInteger(resamples) && resamples >= 100,
    'Too few bootstrap resamples'
  );
  const logs = pairs.map(({ baseline, candidate }) => {
    assert(
      Number.isFinite(baseline) &&
        baseline > 0 &&
        Number.isFinite(candidate) &&
        candidate > 0,
      'Invalid pair timing'
    );
    return Math.log(candidate / baseline);
  });
  const ratio = Math.exp(
    logs.reduce((sum, value) => sum + value, 0) / logs.length
  );
  // A single process pair cannot estimate process-to-process uncertainty.
  let ratio95 = null;
  if (pairs.length >= 4) {
    const random = randomGenerator(seed);
    const boot = Array.from({ length: resamples }, () => {
      let total = 0;
      for (let i = 0; i < logs.length; i++)
        total += logs[Math.floor(random() * logs.length)];
      return Math.exp(total / logs.length);
    }).sort((a, b) => a - b);
    ratio95 = [
      boot[Math.floor(resamples * 0.025)],
      boot[Math.ceil(resamples * 0.975) - 1],
    ];
  }
  let verdict = 'exploratory';
  if (confirm && pairs.length >= 8) {
    verdict =
      ratio95[1] < 1 - threshold
        ? 'faster'
        : ratio95[0] > 1 + threshold
          ? 'slower'
          : ratio95[0] >= 1 - threshold && ratio95[1] <= 1 + threshold
            ? 'within-threshold'
            : 'inconclusive';
  }
  return {
    processPairs: pairs.length,
    candidateOverBaseline: ratio,
    timeReductionPercent: (1 - ratio) * 100,
    ratio95,
    practicalThreshold: threshold,
    verdict,
  };
}

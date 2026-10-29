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
  {
    seed = 1,
    resamples = 10000,
    threshold = 0.02,
    confirm = false,
    confidence = 0.95,
  } = {}
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
  assert(
    Number.isFinite(confidence) && confidence > 0 && confidence < 1,
    'Invalid confidence level'
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
  // Screening never reports an interval, regardless of its number of rounds.
  // Eight pairs is a minimum, not a guarantee of bootstrap coverage.
  let ratioInterval = null;
  if (confirm && pairs.length >= 8) {
    const random = randomGenerator(seed);
    const boot = Array.from({ length: resamples }, () => {
      let total = 0;
      for (let i = 0; i < logs.length; i++)
        total += logs[Math.floor(random() * logs.length)];
      return Math.exp(total / logs.length);
    }).sort((a, b) => a - b);
    const tail = (1 - confidence) / 2;
    ratioInterval = [
      boot[Math.floor(resamples * tail)],
      boot[Math.ceil(resamples * (1 - tail)) - 1],
    ];
  }
  let verdict = 'exploratory';
  if (confirm && pairs.length >= 8) {
    verdict =
      ratioInterval[1] < 1 - threshold
        ? 'faster'
        : ratioInterval[0] > 1 + threshold
          ? 'slower'
          : ratioInterval[0] >= 1 - threshold &&
              ratioInterval[1] <= 1 + threshold
            ? 'within-threshold'
            : 'inconclusive';
  }
  const ratios = logs.map(Math.exp);
  const center = median(ratios);
  return {
    processPairs: pairs.length,
    candidateOverBaseline: ratio,
    timeReductionPercent: (1 - ratio) * 100,
    ratioInterval,
    confidence: ratioInterval ? confidence : null,
    pairDispersion: {
      relativeMad:
        median(ratios.map((value) => Math.abs(value - center))) / center,
      relativeRange: Math.max(...ratios) / Math.min(...ratios) - 1,
    },
    practicalThreshold: threshold,
    verdict,
  };
}

/**
 * Rank the fixed objective independently of guards. A local objective win can
 * nominate a candidate without clearing a diluted whole-suite threshold.
 * Only a qualified confirmation with bounded regression risk may accept it.
 */
export function aggregate(
  comparisons,
  {
    threshold = 0.02,
    confirm = false,
    objectiveCaseIds,
    requiredCaseIds,
    qualificationIssues = [],
  }
) {
  assert(comparisons.length > 0, 'Aggregate requires comparisons');
  assert(objectiveCaseIds.length > 0, 'An objective is required');
  const cases = {};
  const invalidCases = [];
  const regressions = [];
  const promisingCases = [];
  const confirmedWins = [];
  const unresolvedCases = [];
  const scoreCaseIds = [];
  let logSum = 0;
  for (const row of comparisons) {
    assert(!Object.hasOwn(cases, row.caseId), `Duplicate case ${row.caseId}`);
    const ratio = row.candidateOverBaseline;
    assert(
      Number.isFinite(ratio) && ratio > 0,
      `Invalid ratio for ${row.caseId}`
    );
    const objective = objectiveCaseIds.includes(row.caseId);
    if (objective) {
      logSum += Math.log(ratio);
      scoreCaseIds.push(row.caseId);
    }
    const screen =
      ratio > 1 + threshold
        ? 'regression-suspected'
        : ratio < 1 - threshold
          ? 'promising'
          : 'no-signal';
    if (row.warnings.length) invalidCases.push(row.caseId);
    if (objective && screen === 'promising') promisingCases.push(row.caseId);
    const interval = row.ratioInterval;
    const usableInterval =
      row.processPairs >= 8 &&
      Array.isArray(interval) &&
      interval.length === 2 &&
      interval.every((value) => Number.isFinite(value) && value > 0) &&
      interval[0] <= interval[1];
    if (confirm) {
      if (usableInterval && interval[0] > 1 + threshold)
        regressions.push(row.caseId);
      if (!usableInterval || interval[1] > 1 + threshold)
        unresolvedCases.push(row.caseId);
      if (objective && usableInterval && interval[1] < 1 - threshold)
        confirmedWins.push(row.caseId);
    } else if (screen === 'regression-suspected') {
      regressions.push(row.caseId);
    }
    cases[row.caseId] = {
      role: objective ? 'objective' : 'guard',
      baselineMs: row.baselineMs,
      candidateMs: row.candidateMs,
      ratio,
      ratioInterval: row.ratioInterval,
      confidence: row.confidence,
      screen,
      verdict: row.verdict,
      pairDispersion: row.pairDispersion,
      warnings: row.warnings,
    };
  }
  const score = scoreCaseIds.length
    ? Math.exp(logSum / scoreCaseIds.length)
    : null;
  const missingCases = [
    ...new Set([...requiredCaseIds, ...objectiveCaseIds]),
  ].filter((id) => !Object.hasOwn(cases, id));
  let status;
  if (invalidCases.length) status = 'invalid';
  else if (!confirm) {
    status = regressions.length
      ? 'regression-suspected'
      : promisingCases.length && score < 1
        ? 'promising'
        : 'no-signal';
  } else if (regressions.length) status = 'regressed';
  else if (missingCases.length || qualificationIssues.length)
    status = 'diagnostic-only';
  else if (unresolvedCases.length) status = 'inconclusive';
  else if (confirmedWins.length && score < 1) status = 'accepted';
  else
    status = comparisons.some(
      (row) =>
        objectiveCaseIds.includes(row.caseId) &&
        row.verdict !== 'within-threshold'
    )
      ? 'inconclusive'
      : 'unchanged';
  return {
    score,
    scoreCaseIds,
    scoreComplete: objectiveCaseIds.every((id) => Object.hasOwn(cases, id)),
    speedup: score === null ? null : 1 / score,
    scoreReductionPercent: score === null ? null : (1 - score) * 100,
    practicalThreshold: threshold,
    status,
    accepted: status === 'accepted',
    invalidCases,
    regressions,
    promisingCases,
    confirmedWins,
    unresolvedCases,
    missingCases,
    qualificationIssues,
    cases,
  };
}

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { confirmationIssues, measurementProfiles } from './policy.mjs';
import { aggregate, comparePairs, median, summarize } from './statistics.mjs';

void test('paired ratios cancel shared machine drift and detect a practical win', () => {
  const pairs = [1, 3, 2, 7, 4, 2, 6, 5].map((baseline) => ({
    baseline,
    candidate: baseline * 0.9,
  }));
  const result = comparePairs(pairs, { confirm: true });
  assert(Math.abs(result.candidateOverBaseline - 0.9) < 1e-12);
  assert.equal(result.verdict, 'faster');
  assert(result.ratioInterval[1] < 0.98);
});

void test('identical and materially slower candidates do not become wins', () => {
  const pairs = Array.from({ length: 8 }, (_, i) => ({
    baseline: i + 1,
    candidate: i + 1,
  }));
  assert.equal(
    comparePairs(pairs, { confirm: true }).verdict,
    'within-threshold'
  );
  assert.equal(
    comparePairs(
      pairs.map((pair) => ({ ...pair, candidate: pair.candidate * 1.1 })),
      { confirm: true }
    ).verdict,
    'slower'
  );
});

void test('noisy fresh-process pairs remain inconclusive even with a favorable estimate', () => {
  const pairs = [0.7, 1.2, 0.8, 1.1, 0.75, 1.15, 0.85, 1.05].map(
    (candidate) => ({ baseline: 1, candidate })
  );
  const result = comparePairs(pairs, { confirm: true, seed: 42 });
  assert(result.candidateOverBaseline < 1);
  assert(result.ratioInterval[0] < 1 && result.ratioInterval[1] > 1);
  assert.equal(result.verdict, 'inconclusive');
  const decision = aggregate([{ caseId: 'target', warnings: [], ...result }], {
    confirm: true,
    objectiveCaseIds: ['target'],
    requiredCaseIds: ['target'],
  });
  assert.equal(decision.accepted, false);
  assert.equal(decision.status, 'inconclusive');
});

void test('screening and undersampled comparisons cannot claim confirmation', () => {
  const pair = { baseline: 10, candidate: 1 };
  assert.equal(comparePairs([pair], { confirm: true }).ratioInterval, null);
  assert.equal(comparePairs([pair], { confirm: true }).verdict, 'exploratory');
  const four = comparePairs(Array(4).fill(pair), { confirm: true });
  assert.equal(four.ratioInterval, null);
  assert.equal(four.verdict, 'exploratory');
  const screening = comparePairs(Array(12).fill(pair));
  assert.equal(screening.verdict, 'exploratory');
  assert.equal(screening.ratioInterval, null);
});

void test('summary retains slow samples and flags a changing timing regime', () => {
  const result = summarize([1, 1, 1, 3, 3, 9]);
  assert.equal(result.medianMs, 2);
  assert.equal(result.meanMs, 3);
  assert.equal(result.maxMs, 9);
  assert.equal(result.lastVsFirst, 3);
  assert.equal(median([4, 1, 2]), 2);
});

void test('invalid timings fail instead of producing misleading ratios', () => {
  for (const value of [0, -1, NaN, Infinity]) {
    assert.throws(() => summarize([1, value]));
    assert.throws(() => comparePairs([{ baseline: 1, candidate: value }]));
  }
  assert.throws(() => comparePairs([]));
  assert.throws(() => summarize([]));
});

function comparison(caseId, ratio, warnings = []) {
  return {
    caseId,
    warnings,
    ...comparePairs(Array(12).fill({ baseline: 1, candidate: ratio }), {
      confirm: true,
    }),
  };
}

const decisionOptions = {
  objectiveCaseIds: ['target'],
  requiredCaseIds: ['target', 'guard'],
  confirm: true,
};

void test('localized wins survive dilution but screening never accepts them', () => {
  const rows = Array.from({ length: 8 }, (_, i) =>
    comparison(`case-${i}`, i === 0 ? 0.9 : 1)
  );
  const options = {
    objectiveCaseIds: rows.map((row) => row.caseId),
    requiredCaseIds: rows.map((row) => row.caseId),
    threshold: 0.03,
  };
  const screen = aggregate(rows, options);
  assert(Math.abs(screen.score - 0.9 ** (1 / 8)) < 1e-12);
  assert.equal(screen.status, 'promising');
  assert.equal(screen.accepted, false);
  const confirmed = aggregate(rows, { ...options, confirm: true });
  assert.equal(confirmed.status, 'accepted');
  assert.equal(confirmed.accepted, true);
});

void test('guard regressions block wins without diluting the objective score', () => {
  const result = aggregate(
    [comparison('target', 0.8), comparison('guard', 1.05)],
    decisionOptions
  );
  assert(Math.abs(result.score - 0.8) < 1e-12);
  assert.equal(result.status, 'regressed');
  assert.equal(result.accepted, false);
  assert.deepEqual(result.regressions, ['guard']);
});

void test('uncertain regression guards cannot authorize a confirmed target win', () => {
  const guard = {
    caseId: 'guard',
    warnings: [],
    ...comparePairs(
      [0.9, 1.1, 0.92, 1.08, 0.95, 1.05, 0.94, 1.06].map((candidate) => ({
        baseline: 1,
        candidate,
      })),
      { confirm: true }
    ),
  };
  const result = aggregate([comparison('target', 0.8), guard], decisionOptions);
  assert.equal(result.status, 'inconclusive');
  assert.equal(result.accepted, false);
  assert.deepEqual(result.unresolvedCases, ['guard']);
});

void test('measurement warnings, missing guards and reduced settings never authorize acceptance', () => {
  const target = comparison('target', 0.8);
  const warned = aggregate(
    [target, comparison('guard', 1, ['Warmup cap reached'])],
    decisionOptions
  );
  assert.equal(warned.status, 'invalid');
  assert.equal(warned.accepted, false);
  assert.deepEqual(warned.invalidCases, ['guard']);
  const missing = aggregate([target], decisionOptions);
  assert.equal(missing.status, 'diagnostic-only');
  assert.equal(missing.accepted, false);
  assert.deepEqual(missing.missingCases, ['guard']);
  const reduced = aggregate([target, comparison('guard', 1)], {
    ...decisionOptions,
    qualificationIssues: ['Warmup shortened'],
  });
  assert.equal(reduced.status, 'diagnostic-only');
  assert.equal(reduced.accepted, false);
});

void test('unchanged objectives and guard-only wins are not accepted', () => {
  const result = aggregate(
    [comparison('target', 1), comparison('guard', 0.8)],
    decisionOptions
  );
  assert.equal(result.status, 'unchanged');
  assert.equal(result.accepted, false);
  const onlyGuard = aggregate([comparison('guard', 0.8)], decisionOptions);
  assert.equal(onlyGuard.score, null);
  assert.equal(onlyGuard.accepted, false);
  assert.throws(() => aggregate([], decisionOptions));
  assert.throws(() =>
    aggregate(
      [comparison('target', 1), comparison('target', 1)],
      decisionOptions
    )
  );
});

void test('pair dispersion detects process-level shifts despite stable batches', () => {
  const result = comparePairs(
    [1.0476, 1.0062, 0.9796, 1.207].map((candidate) => ({
      baseline: 1,
      candidate,
    }))
  );
  assert(result.pairDispersion.relativeRange > 0.1);
  const sharedDrift = comparePairs(
    [1, 2, 3, 4].map((baseline) => ({ baseline, candidate: baseline * 0.9 }))
  );
  assert(sharedDrift.pairDispersion.relativeRange < 1e-12);
});

void test('higher confidence widens intervals instead of creating extra wins', () => {
  const pairs = [0.88, 0.91, 0.94, 0.96, 0.97, 1.02, 1.04, 1.08].map(
    (candidate) => ({ baseline: 1, candidate })
  );
  const individual = comparePairs(pairs, { confirm: true });
  const family = comparePairs(pairs, { confirm: true, confidence: 0.995 });
  assert(family.ratioInterval[0] <= individual.ratioInterval[0]);
  assert(family.ratioInterval[1] >= individual.ratioInterval[1]);
  assert.throws(() => comparePairs(pairs, { confidence: 1 }));
});

void test('the fixed confirmation policy disqualifies shortened measurements and relaxed guards', () => {
  const rows = [comparison('target', 0.8), comparison('guard', 1)];
  const valid = { ...measurementProfiles.confirm, rounds: 12 };
  const decide = (configuration) =>
    aggregate(rows, {
      ...decisionOptions,
      qualificationIssues: confirmationIssues(configuration),
    });
  assert.equal(decide(valid).accepted, true);
  for (const key of [
    'warmupMs',
    'warmupDeliveries',
    'warmupOperations',
    'sampleMs',
    'samples',
  ]) {
    const result = decide({ ...valid, [key]: valid[key] - 1 });
    assert.equal(result.accepted, false, key);
    assert.equal(result.status, 'diagnostic-only', key);
  }
  assert.equal(decide({ ...valid, rounds: 7 }).accepted, false);
  assert.equal(decide({ ...valid, rounds: 9 }).accepted, false);
  assert.equal(decide({ ...valid, threshold: 0.03 }).accepted, false);
  assert.equal(decide({ ...valid, threshold: 0.01 }).accepted, true);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { comparePairs, median, summarize } from './statistics.mjs';

void test('paired ratios cancel shared machine drift and detect a practical win', () => {
  const pairs = [1, 3, 2, 7, 4, 2, 6, 5].map((baseline) => ({
    baseline,
    candidate: baseline * 0.9,
  }));
  const result = comparePairs(pairs, { confirm: true });
  assert(Math.abs(result.candidateOverBaseline - 0.9) < 1e-12);
  assert.equal(result.verdict, 'faster');
  assert(result.ratio95[1] < 0.98);
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
  assert(result.ratio95[0] < 1 && result.ratio95[1] > 1);
  assert.equal(result.verdict, 'inconclusive');
});

void test('screening and undersampled comparisons cannot claim confirmation', () => {
  const pair = { baseline: 10, candidate: 1 };
  assert.equal(comparePairs([pair], { confirm: true }).ratio95, null);
  assert.equal(comparePairs([pair], { confirm: true }).verdict, 'exploratory');
  assert.equal(
    comparePairs(Array(4).fill(pair), { confirm: true }).verdict,
    'exploratory'
  );
  assert.equal(comparePairs(Array(12).fill(pair)).verdict, 'exploratory');
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

import {
  BASELINE_IMPLEMENTATION,
  type BenchmarkConfig,
  type BenchmarkFixture,
  compareSummaries,
  createBenchmarkCases,
  createStressFixtures,
  createSyntheticFixtures,
  CURRENT_IMPLEMENTATION,
  percentDelta,
  runBaselineComparisonBenchmark,
  runSingleImplementationBenchmark,
} from './benchmarkIterateOverDiff';

interface BrowserBenchmarkInput {
  config: BenchmarkConfig;
  realFixtures: BenchmarkFixture[];
  browser: {
    userAgent: string;
    href: string;
  };
}

function createBrowserFixtures({
  config,
  realFixtures,
}: BrowserBenchmarkInput): BenchmarkFixture[] {
  if (config.preset === 'stress') {
    return createStressFixtures();
  }
  return [
    ...realFixtures,
    ...(config.includeSynthetic ? createSyntheticFixtures() : []),
  ];
}

function runBrowserBenchmark(input: BrowserBenchmarkInput) {
  const { config } = input;
  const fixtures = createBrowserFixtures(input);
  const cases = createBenchmarkCases(fixtures, config);
  if (cases.length === 0) {
    throw new Error('No benchmark cases matched the provided filters.');
  }

  if (config.compareBaseline) {
    const { baseline, current } = runBaselineComparisonBenchmark(
      cases,
      config,
      undefined
    );
    const comparisons = compareSummaries(baseline, current);
    return {
      benchmark: 'iterateOverDiff:baseline-compare',
      runtime: 'chrome',
      browser: input.browser,
      fixturePath: config.fixturePath,
      config,
      implementations: {
        baseline: BASELINE_IMPLEMENTATION.label,
        current: CURRENT_IMPLEMENTATION.label,
      },
      caseCount: cases.length,
      fixtureCount: fixtures.length,
      baseline,
      current,
      scoreDeltaPct: percentDelta(baseline.score, current.score),
      checksumMatch: baseline.checksum === current.checksum,
      comparedCases: comparisons.length,
      comparisons,
    };
  }

  const { checksum, score, summaries } = runSingleImplementationBenchmark(
    CURRENT_IMPLEMENTATION,
    cases,
    config,
    undefined
  );
  return {
    benchmark: 'iterateOverDiff',
    runtime: 'chrome',
    browser: input.browser,
    implementation: CURRENT_IMPLEMENTATION.label,
    fixturePath: config.fixturePath,
    config,
    caseCount: cases.length,
    fixtureCount: fixtures.length,
    checksum,
    score,
    summaries,
  };
}

const browserGlobal = globalThis as typeof globalThis & {
  __runIterateOverDiffBrowserBenchmark?: typeof runBrowserBenchmark;
};

browserGlobal.__runIterateOverDiffBrowserBenchmark = runBrowserBenchmark;

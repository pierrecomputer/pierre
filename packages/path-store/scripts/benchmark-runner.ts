export interface BenchmarkRunnerScenario<TStats> {
  measure: () => Promise<TStats>;
  name: string;
}

export interface BenchmarkRunnerResult<TStats> {
  wallTimeMs: number;
  name: string;
  stats: TStats;
}

// Benchmarks need exclusive access to the CPU budget they are measuring, so
// the harness runs scenarios strictly one after another instead of in parallel.
export async function measureScenariosSequentially<TStats>(
  scenarios: readonly BenchmarkRunnerScenario<TStats>[],
  onStarted?:
    | ((
        scenario: BenchmarkRunnerScenario<TStats>,
        index: number,
        total: number
      ) => void | Promise<void>)
    | undefined,
  onMeasured?:
    | ((
        result: BenchmarkRunnerResult<TStats>,
        index: number,
        total: number
      ) => void | Promise<void>)
    | undefined
): Promise<BenchmarkRunnerResult<TStats>[]> {
  const results: BenchmarkRunnerResult<TStats>[] = [];

  for (let index = 0; index < scenarios.length; index++) {
    const scenario = scenarios[index];
    if (scenario == null) {
      continue;
    }

    await onStarted?.(scenario, index, scenarios.length);
    const wallTimeStart = performance.now();

    const result = {
      name: scenario.name,
      stats: await scenario.measure(),
      wallTimeMs: performance.now() - wallTimeStart,
    };

    results.push(result);
    await onMeasured?.(result, index, scenarios.length);
  }

  return results;
}

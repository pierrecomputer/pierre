import { performance } from 'node:perf_hooks';

import {
  createVisibleTreeProjectionScenarios,
  createVisibleTreeProjectionWorkload,
  summarizeDurations,
} from './visibleTreeProjectionShared';

interface BenchmarkConfig {
  json: boolean;
  runs: number;
  warmupRuns: number;
  workloads: string[];
}

interface ScenarioBenchmarkResult {
  description: string;
  metrics: ReturnType<typeof summarizeDurations>;
  name: string;
  rowCount: number;
  workload: {
    collapseTargetPath: string | null;
    expandedFolderCount: number;
    fileCount: number;
    name: string;
    visibleCount: number;
  };
}

function parseArgs(argv: readonly string[]): BenchmarkConfig {
  const config: BenchmarkConfig = {
    json: false,
    runs: 20,
    warmupRuns: 5,
    workloads: ['linux-1x'],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--json':
        config.json = true;
        break;
      case '--runs':
        config.runs = Number(argv[index + 1] ?? config.runs);
        index += 1;
        break;
      case '--warmup-runs':
        config.warmupRuns = Number(argv[index + 1] ?? config.warmupRuns);
        index += 1;
        break;
      case '--workloads':
        config.workloads = (argv[index + 1] ?? '')
          .split(',')
          .map((workload) => workload.trim())
          .filter((workload) => workload.length > 0);
        index += 1;
        break;
      default:
        break;
    }
  }

  return config;
}

function main(): void {
  const config = parseArgs(process.argv.slice(2));
  const results: ScenarioBenchmarkResult[] = [];

  for (const workloadName of config.workloads) {
    const workload = createVisibleTreeProjectionWorkload(workloadName);
    const scenarios = createVisibleTreeProjectionScenarios(workload);

    for (const scenario of scenarios) {
      for (
        let warmupIndex = 0;
        warmupIndex < config.warmupRuns;
        warmupIndex += 1
      ) {
        scenario.measure();
      }

      const durationsMs: number[] = [];
      let rowCount = 0;
      for (let runIndex = 0; runIndex < config.runs; runIndex += 1) {
        const startedAt = performance.now();
        const result = scenario.measure();
        durationsMs.push(performance.now() - startedAt);
        rowCount = result.rowCount;
      }

      results.push({
        description: scenario.description,
        metrics: summarizeDurations(durationsMs),
        name: scenario.name,
        rowCount,
        workload: {
          collapseTargetPath: workload.collapseTargetPath,
          expandedFolderCount: workload.expandedFolderCount,
          fileCount: workload.fileCount,
          name: workload.name,
          visibleCount: workload.visibleCount,
        },
      });
    }
  }

  if (config.json) {
    console.log(
      JSON.stringify(
        {
          benchmark: 'visible-tree-projection',
          config,
          results,
        },
        null,
        2
      )
    );
    return;
  }

  for (const result of results) {
    console.log(
      [
        `${result.workload.name}:${result.name}`,
        `rows=${String(result.rowCount)}`,
        `avg=${result.metrics.averageMs.toFixed(3)}ms`,
        `median=${result.metrics.medianMs.toFixed(3)}ms`,
        `p95=${result.metrics.p95Ms.toFixed(3)}ms`,
        `min=${result.metrics.minMs.toFixed(3)}ms`,
        `max=${result.metrics.maxMs.toFixed(3)}ms`,
      ].join('  ')
    );
  }
}

main();

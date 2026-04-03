import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// This is a good test to run locally to make sure changes to the benchmark tool
// dont break these tests, but it's not a runtime test for the library and it's quite
// slow to run, so we don't run it by default in the test suite.
describe.skip('path-store benchmark CLI', () => {
  test('emits JSON for a filtered smoke run', async () => {
    const {
      FORCE_COLOR: _forceColor,
      NO_COLOR: _noColor,
      ...env
    } = process.env;

    const processResult = Bun.spawn({
      cmd: [
        'bun',
        'run',
        './scripts/benchmark.ts',
        '--filter',
        '^visible-first/linux-5x/30$',
        '--json',
      ],
      cwd: import.meta.dir + '/..',
      env: {
        ...env,
        AGENT: '1',
      },
      stderr: 'pipe',
      stdout: 'pipe',
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(processResult.stdout).text(),
      new Response(processResult.stderr).text(),
      processResult.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe('');

    const payload = JSON.parse(stdout) as {
      kind: string;
      preparationTimeMs: number;
      profile: string;
      results: {
        benchmarks: Array<{
          alias: string;
          runs: Array<{
            stats: {
              ticks: number;
            };
          }>;
        }>;
      };
      scenarios: Array<{
        category: string;
        name: string;
        preparationTimeMs?: number;
        visibleCount?: number;
        viewport?: string;
        windowSize?: number;
        workload?: string;
      }>;
    };

    expect(payload.kind).toBe('path-store-benchmark-run');
    expect(payload.profile).toBe('full');
    expect(payload.preparationTimeMs).toBeGreaterThan(0);
    expect(payload.scenarios).toHaveLength(1);
    expect(payload.scenarios[0]?.name).toBe('visible-first/linux-5x/30');
    expect(payload.scenarios[0]?.category).toBe('visible');
    expect(payload.scenarios[0]?.preparationTimeMs).toBeGreaterThan(0);
    expect(payload.scenarios[0]?.workload).toBe('linux-5x');
    expect(payload.scenarios[0]?.viewport).toBe('first');
    expect(payload.scenarios[0]?.windowSize).toBe(30);
    expect(payload.scenarios[0]?.visibleCount).toBeGreaterThan(0);
    expect(
      payload.results.benchmarks.some(
        (bench) => bench.alias === 'visible-first/linux-5x/30'
      )
    ).toBe(true);
    expect(
      payload.results.benchmarks[0]?.runs[0]?.stats.ticks
    ).toBeGreaterThanOrEqual(50);
  }, 20_000);

  test('documents changed-window mutation reads in the scenario manifest', async () => {
    const {
      FORCE_COLOR: _forceColor,
      NO_COLOR: _noColor,
      ...env
    } = process.env;

    const processResult = Bun.spawn({
      cmd: [
        'bun',
        'run',
        './scripts/benchmark.ts',
        '--filter',
        '^mutate/rename-leaf/first/linux-5x/200$',
        '--json',
      ],
      cwd: import.meta.dir + '/..',
      env: {
        ...env,
        AGENT: '1',
      },
      stderr: 'pipe',
      stdout: 'pipe',
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(processResult.stdout).text(),
      new Response(processResult.stderr).text(),
      processResult.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe('');

    const payload = JSON.parse(stdout) as {
      scenarios: Array<{
        baselineWindowEnd?: number;
        baselineWindowStart?: number;
        destinationPath?: string;
        name: string;
        postMutationReadIntent?: string;
        renderTargetPath?: string;
        windowEnd?: number;
        windowShifted?: boolean;
        windowStart?: number;
      }>;
    };

    expect(payload.scenarios).toHaveLength(1);
    expect(payload.scenarios[0]?.name).toBe(
      'mutate/rename-leaf/first/linux-5x/200'
    );
    expect(payload.scenarios[0]?.postMutationReadIntent).toBe(
      'render-changed-window'
    );
    expect(payload.scenarios[0]?.renderTargetPath).toBe(
      payload.scenarios[0]?.destinationPath
    );
    expect(payload.scenarios[0]?.baselineWindowStart).toBeDefined();
    expect(payload.scenarios[0]?.baselineWindowEnd).toBeDefined();
    expect(payload.scenarios[0]?.windowStart).toBeDefined();
    expect(payload.scenarios[0]?.windowEnd).toBeDefined();
    expect(typeof payload.scenarios[0]?.windowShifted).toBe('boolean');
  }, 20_000);

  test('supports subtree moves even when the first viewport only covers one root subtree', async () => {
    const {
      FORCE_COLOR: _forceColor,
      NO_COLOR: _noColor,
      ...env
    } = process.env;

    const processResult = Bun.spawn({
      cmd: [
        'bun',
        'run',
        './scripts/benchmark.ts',
        '--filter',
        '^mutate/move-subtree/first/linux-5x/200$',
        '--json',
      ],
      cwd: import.meta.dir + '/..',
      env: {
        ...env,
        AGENT: '1',
      },
      stderr: 'pipe',
      stdout: 'pipe',
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(processResult.stdout).text(),
      new Response(processResult.stderr).text(),
      processResult.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe('');

    const payload = JSON.parse(stdout) as {
      scenarios: Array<{
        destinationPath?: string;
        name: string;
        notes?: readonly string[];
        targetPath?: string;
      }>;
    };

    expect(payload.scenarios).toHaveLength(1);
    expect(payload.scenarios[0]?.name).toBe(
      'mutate/move-subtree/first/linux-5x/200'
    );
    expect(payload.scenarios[0]?.targetPath).toBe('linux-1/');
    expect(payload.scenarios[0]?.destinationPath).toBe('linux-2/linux-1/');
    expect(payload.scenarios[0]?.notes?.[0]).toContain('linux-2/');
  }, 30_000);

  test('compares two benchmark runs with bootstrap confidence output', async () => {
    const {
      FORCE_COLOR: _forceColor,
      NO_COLOR: _noColor,
      ...env
    } = process.env;
    const tempDir = await mkdtemp(join(tmpdir(), 'path-store-bench-compare-'));

    try {
      const baselinePath = join(tempDir, 'baseline.json');
      const candidatePath = join(tempDir, 'candidate.json');
      const scenarioName = 'visible-first/linux-5x/30';

      await writeFile(
        baselinePath,
        JSON.stringify({
          generatedAt: '2026-04-02T00:00:00.000Z',
          intent: 'baseline',
          kind: 'path-store-benchmark-run',
          preparationTimeMs: 1,
          profile: 'full',
          results: {
            benchmarks: [
              {
                alias: scenarioName,
                runs: [
                  {
                    stats: {
                      avg: 100,
                      max: 108,
                      min: 92,
                      p50: 100,
                      p75: 104,
                      p95: 107,
                      p99: 108,
                      samples: [92, 96, 99, 100, 102, 104, 108],
                      ticks: 7,
                    },
                    wallTimeMs: 10,
                  },
                ],
              },
            ],
            context: {
              arch: 'arm64-darwin',
              runtime: 'bun',
              version: '1.0.0',
            },
            layout: [],
          },
          scenarios: [
            {
              category: 'visible',
              fileCount: 1,
              name: scenarioName,
              visibleCount: 1,
              viewport: 'first',
              windowEnd: 29,
              windowSize: 30,
              windowStart: 0,
              workload: 'linux-5x',
            },
          ],
        })
      );

      await writeFile(
        candidatePath,
        JSON.stringify({
          generatedAt: '2026-04-02T00:00:00.000Z',
          intent: 'candidate',
          kind: 'path-store-benchmark-run',
          preparationTimeMs: 1,
          profile: 'full',
          results: {
            benchmarks: [
              {
                alias: scenarioName,
                runs: [
                  {
                    stats: {
                      avg: 80,
                      max: 86,
                      min: 74,
                      p50: 80,
                      p75: 83,
                      p95: 85,
                      p99: 86,
                      samples: [74, 77, 79, 80, 81, 83, 86],
                      ticks: 7,
                    },
                    wallTimeMs: 8,
                  },
                ],
              },
            ],
            context: {
              arch: 'arm64-darwin',
              runtime: 'bun',
              version: '1.0.0',
            },
            layout: [],
          },
          scenarios: [
            {
              category: 'visible',
              fileCount: 1,
              name: scenarioName,
              visibleCount: 1,
              viewport: 'first',
              windowEnd: 29,
              windowSize: 30,
              windowStart: 0,
              workload: 'linux-5x',
            },
          ],
        })
      );

      const processResult = Bun.spawn({
        cmd: [
          'bun',
          'run',
          './scripts/benchmark.ts',
          '--compare',
          baselinePath,
          candidatePath,
          '--json',
          '--bootstrap-resamples',
          '200',
        ],
        cwd: import.meta.dir + '/..',
        env: {
          ...env,
          AGENT: '1',
        },
        stderr: 'pipe',
        stdout: 'pipe',
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(processResult.stdout).text(),
        new Response(processResult.stderr).text(),
        processResult.exited,
      ]);

      expect(exitCode).toBe(0);
      expect(stderr).toBe('');

      const payload = JSON.parse(stdout) as {
        bootstrapResamples: number;
        comparedScenarios: Array<{
          accepted: boolean;
          ci95HighPct?: number;
          ci95LowPct?: number;
          confidenceAvailable: boolean;
          name: string;
          p50ImprovementPct: number;
          p95ImprovementPct?: number;
          statisticallySignificant: boolean;
        }>;
        kind: string;
        minEffectPct: number;
        summary: {
          accepted: number;
          compared: number;
          improved: number;
        };
      };

      expect(payload.kind).toBe('path-store-benchmark-compare');
      expect(payload.bootstrapResamples).toBe(200);
      expect(payload.minEffectPct).toBe(3);
      expect(payload.summary.compared).toBe(1);
      expect(payload.summary.accepted).toBe(1);
      expect(payload.summary.improved).toBe(1);
      expect(payload.comparedScenarios).toHaveLength(1);
      expect(payload.comparedScenarios[0]?.name).toBe(scenarioName);
      expect(payload.comparedScenarios[0]?.confidenceAvailable).toBe(true);
      expect(payload.comparedScenarios[0]?.statisticallySignificant).toBe(true);
      expect(payload.comparedScenarios[0]?.accepted).toBe(true);
      expect(payload.comparedScenarios[0]?.p50ImprovementPct).toBeGreaterThan(
        15
      );
      expect(payload.comparedScenarios[0]?.p95ImprovementPct).toBeGreaterThan(
        15
      );
      expect(payload.comparedScenarios[0]?.ci95LowPct).toBeGreaterThan(0);
      expect(payload.comparedScenarios[0]?.ci95HighPct).toBeGreaterThan(
        payload.comparedScenarios[0]?.ci95LowPct ?? 0
      );
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  }, 20_000);
});

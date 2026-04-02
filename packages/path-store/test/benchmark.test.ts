import { describe, expect, test } from 'bun:test';

describe('path-store benchmark CLI', () => {
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
      profile: string;
      results: {
        benchmarks: Array<{
          alias: string;
        }>;
      };
      scenarios: Array<{
        category: string;
        name: string;
        visibleCount?: number;
        viewport?: string;
        windowSize?: number;
        workload?: string;
      }>;
    };

    expect(payload.kind).toBe('path-store-benchmark-run');
    expect(payload.profile).toBe('full');
    expect(payload.scenarios).toHaveLength(1);
    expect(payload.scenarios[0]?.name).toBe('visible-first/linux-5x/30');
    expect(payload.scenarios[0]?.category).toBe('visible');
    expect(payload.scenarios[0]?.workload).toBe('linux-5x');
    expect(payload.scenarios[0]?.viewport).toBe('first');
    expect(payload.scenarios[0]?.windowSize).toBe(30);
    expect(payload.scenarios[0]?.visibleCount).toBeGreaterThan(0);
    expect(
      payload.results.benchmarks.some(
        (bench) => bench.alias === 'visible-first/linux-5x/30'
      )
    ).toBe(true);
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
});

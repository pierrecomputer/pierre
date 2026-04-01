import { describe, expect, test } from 'bun:test';

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
        '^build/pierre-snapshot',
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
      benchmarks: Array<{
        alias: string;
      }>;
    };

    expect(
      payload.benchmarks.some(
        (bench) => bench.alias === 'build/pierre-snapshot sorted-constructor'
      )
    ).toBe(true);
  }, 20_000);
});

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertComparableRenderBenchmarkBaseline,
  type BenchmarkConfig,
} from '../scripts/benchmarkVirtualizedFileTreeRender';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const textDecoder = new TextDecoder();

function createConfig(
  overrides: Partial<BenchmarkConfig> = {}
): BenchmarkConfig {
  return {
    runs: 1,
    warmupRuns: 0,
    outputJson: true,
    caseFilters: ['tiny-flat'],
    windowStart: 0,
    windowSize: 5,
    itemHeight: 30,
    viewportHeight: 500,
    ...overrides,
  };
}

function createRuntime(
  overrides: Partial<{
    codePath: string;
    nodeEnv: string;
    renderer: string;
    renderHarness: string;
  }> = {}
) {
  return {
    codePath: 'dist',
    nodeEnv: 'production',
    renderer: 'preact-render-to-string',
    renderHarness: 'benchmark-local-static-virtualizer',
    ...overrides,
  };
}

function createBaseline(
  configOverrides: Partial<BenchmarkConfig> = {},
  runtimeOverrides: Partial<{
    codePath: string;
    nodeEnv: string;
    renderer: string;
    renderHarness: string;
  }> = {}
) {
  return {
    path: '/tmp/baseline.json',
    output: {
      config: createConfig(configOverrides),
      runtime: createRuntime(runtimeOverrides),
    },
  };
}

function createComparison(
  overrides: Partial<{
    unmatchedCurrentCases: string[];
    checksumMismatches: string[];
  }> = {}
) {
  return {
    unmatchedCurrentCases: [],
    checksumMismatches: [],
    ...overrides,
  };
}

function runRenderBenchmark(args: string[]) {
  const result = Bun.spawnSync({
    cmd: [
      'bun',
      'run',
      './scripts/benchmarkVirtualizedFileTreeRender.ts',
      ...args,
    ],
    cwd: packageRoot,
    env: {
      ...process.env,
      AGENT: '1',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  return {
    result,
    stdout: textDecoder.decode(result.stdout).trim(),
    stderr: textDecoder.decode(result.stderr).trim(),
  };
}

describe('virtualized render benchmark helpers', () => {
  test('compare validation rejects incompatible virtual window settings', () => {
    expect(() =>
      assertComparableRenderBenchmarkBaseline(
        createBaseline({ windowSize: 10 }),
        createComparison(),
        createConfig(),
        createRuntime()
      )
    ).toThrow('baseline windowSize=10 does not match current windowSize=5');
  });

  test('compare validation rejects incompatible runtime metadata', () => {
    expect(() =>
      assertComparableRenderBenchmarkBaseline(
        createBaseline({}, { codePath: 'src' }),
        createComparison(),
        createConfig(),
        createRuntime()
      )
    ).toThrow('baseline codePath=src does not match current codePath=dist');
  });

  test('compare validation rejects HTML mismatches', () => {
    expect(() =>
      assertComparableRenderBenchmarkBaseline(
        createBaseline(),
        createComparison({ checksumMismatches: ['tiny-flat'] }),
        createConfig(),
        createRuntime()
      )
    ).toThrow(
      'baseline HTML output does not match current output for cases: tiny-flat'
    );
  });

  test('CLI emits JSON for a standalone dist/production smoke run', () => {
    const { result, stdout, stderr } = runRenderBenchmark([
      '--case=tiny-flat',
      '--runs=1',
      '--warmup-runs=0',
      '--window-size=5',
      '--json',
    ]);

    expect(result.exitCode).toBe(0);
    expect(stderr).toBe('');

    const payload = JSON.parse(stdout) as {
      benchmark: string;
      runtime: {
        codePath: string;
        nodeEnv: string;
        renderer: string;
        renderHarness: string;
        buildCommand: string;
      };
      config: {
        runs: number;
        warmupRuns: number;
        caseFilters: string[];
        windowSize: number;
      };
      cases: Array<{
        name: string;
        fileCount: number;
        renderedItemCount: number;
        htmlChecksum: number;
      }>;
    };

    expect(payload.benchmark).toBe('virtualizedFileTreeRender');
    expect(payload.runtime).toMatchObject({
      codePath: 'dist',
      nodeEnv: 'production',
      renderer: 'preact-render-to-string',
      renderHarness: 'benchmark-local-static-virtualizer',
      buildCommand: 'bun run build',
    });
    expect(payload.config.runs).toBe(1);
    expect(payload.config.warmupRuns).toBe(0);
    expect(payload.config.caseFilters).toEqual(['tiny-flat']);
    expect(payload.config.windowSize).toBe(5);
    expect(payload.cases).toHaveLength(1);
    expect(payload.cases[0]).toMatchObject({
      name: 'tiny-flat',
      fileCount: 128,
      renderedItemCount: 5,
    });
    expect(payload.cases[0]?.htmlChecksum).toBeGreaterThan(0);
  });

  test('CLI compare exits non-zero when the baseline window is incompatible', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'render-benchmark-cli-'));
    const baselinePath = join(tempDir, 'baseline.json');

    try {
      const baselineRun = runRenderBenchmark([
        '--case=tiny-flat',
        '--runs=1',
        '--warmup-runs=0',
        '--window-size=5',
        '--json',
      ]);

      expect(baselineRun.result.exitCode).toBe(0);
      expect(baselineRun.stderr).toBe('');
      writeFileSync(baselinePath, baselineRun.result.stdout);

      const compareRun = runRenderBenchmark([
        '--case=tiny-flat',
        '--runs=1',
        '--warmup-runs=0',
        '--window-size=10',
        '--compare',
        baselinePath,
        '--json',
      ]);

      expect(compareRun.result.exitCode).not.toBe(0);
      expect(compareRun.stderr).toContain(
        'baseline windowSize=5 does not match current windowSize=10'
      );
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });
});

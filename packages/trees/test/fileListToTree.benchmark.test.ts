import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  describeFileListShape,
  filterBenchmarkCases,
  getFileListToTreeBenchmarkCases,
} from '../scripts/lib/fileListToTreeBenchmarkData';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));

describe('fileListToTree benchmark data', () => {
  test('covers the intended mix of synthetic shapes and a fixture snapshot', () => {
    const cases = getFileListToTreeBenchmarkCases();
    const caseNames = cases.map((caseConfig) => caseConfig.name);

    expect(caseNames).toEqual([
      'tiny-flat',
      'small-mixed',
      'medium-balanced',
      'large-wide',
      'large-deep-chain',
      'large-monorepo-shaped',
      'explicit-directories',
      'fixture-linux-kernel-files',
      'fixture-pierrejs-repo-snapshot',
    ]);

    const byName = new Map(
      cases.map((caseConfig) => [caseConfig.name, caseConfig])
    );
    expect(byName.get('tiny-flat')?.fileCount).toBe(128);
    expect(byName.get('large-wide')?.fileCount).toBe(8000);
    expect(byName.get('large-deep-chain')?.fileCount).toBe(2048);
    expect(byName.get('fixture-linux-kernel-files')?.source).toBe('fixture');
    expect(byName.get('fixture-linux-kernel-files')?.fileCount).toBe(92914);
    expect(byName.get('fixture-pierrejs-repo-snapshot')?.source).toBe(
      'fixture'
    );
    expect(byName.get('fixture-pierrejs-repo-snapshot')?.fileCount).toBe(648);
    expect(
      (byName.get('large-deep-chain')?.maxDepth ?? 0) >
        (byName.get('large-wide')?.maxDepth ?? 0)
    ).toBe(true);
  });

  test('describes file-list shape including explicit directories', () => {
    expect(
      describeFileListShape([
        'README.md',
        'src/components/',
        'src/components/Button.tsx',
      ])
    ).toEqual({
      fileCount: 3,
      uniqueFolderCount: 2,
      maxDepth: 3,
    });
  });

  test('filters cases by case-insensitive substring', () => {
    const cases = getFileListToTreeBenchmarkCases();
    const filtered = filterBenchmarkCases(cases, ['DEEP', 'pierrejs']);

    expect(filtered.map((caseConfig) => caseConfig.name)).toEqual([
      'large-deep-chain',
      'fixture-pierrejs-repo-snapshot',
    ]);
  });
});

// These tests spawn benchmark subprocesses and are meant for local iteration,
// not CI. Run them explicitly with: bun test --test-name-pattern "benchmark CLI"
describe.skip('fileListToTree benchmark CLI', () => {
  test('emits JSON for a filtered smoke run', () => {
    const result = Bun.spawnSync({
      cmd: [
        'bun',
        'run',
        './scripts/benchmarkFileListToTree.ts',
        '--case=tiny-flat',
        '--runs=1',
        '--warmup-runs=0',
        '--json',
      ],
      cwd: packageRoot,
      env: {
        ...process.env,
        AGENT: '1',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const stdout = new TextDecoder().decode(result.stdout).trim();
    const stderr = new TextDecoder().decode(result.stderr).trim();

    expect(result.exitCode).toBe(0);
    expect(stderr).toBe('');

    const payload = JSON.parse(stdout) as {
      benchmark: string;
      checksum: number;
      config: {
        runs: number;
        warmupRuns: number;
        caseFilters: string[];
        comparePath?: string;
      };
      cases: Array<{
        name: string;
        fileCount: number;
        runs: number;
        checksum: number;
      }>;
      stages: Array<{
        name: string;
        stages: Record<string, { runs: number; medianMs: number }>;
      }>;
    };

    expect(payload.benchmark).toBe('fileListToTree');
    expect(payload.config.runs).toBe(1);
    expect(payload.config.warmupRuns).toBe(0);
    expect(payload.config.caseFilters).toEqual(['tiny-flat']);
    expect(payload.checksum).toBeGreaterThan(0);
    expect(payload.cases).toHaveLength(1);
    expect(payload.cases[0]).toMatchObject({
      name: 'tiny-flat',
      fileCount: 128,
      runs: 1,
    });
    expect(payload.cases[0]?.checksum).toBeGreaterThan(0);
    expect(payload.stages).toHaveLength(1);
    expect(payload.stages[0]?.name).toBe('tiny-flat');
    expect(payload.stages[0]?.stages.buildPathGraph?.runs).toBe(1);
  });

  test('compares the current run against a saved baseline', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'benchmark-compare-'));
    const baselinePath = join(tempDir, 'baseline.json');

    try {
      const baselineResult = Bun.spawnSync({
        cmd: [
          'bun',
          'run',
          './scripts/benchmarkFileListToTree.ts',
          '--case=tiny-flat',
          '--runs=1',
          '--warmup-runs=0',
          '--json',
        ],
        cwd: packageRoot,
        env: {
          ...process.env,
          AGENT: '1',
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });

      expect(baselineResult.exitCode).toBe(0);
      expect(new TextDecoder().decode(baselineResult.stderr).trim()).toBe('');
      writeFileSync(baselinePath, baselineResult.stdout);

      const compareResult = Bun.spawnSync({
        cmd: [
          'bun',
          'run',
          './scripts/benchmarkFileListToTree.ts',
          '--case=tiny-flat',
          '--runs=1',
          '--warmup-runs=0',
          '--compare',
          baselinePath,
          '--json',
        ],
        cwd: packageRoot,
        env: {
          ...process.env,
          AGENT: '1',
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const compareStdout = new TextDecoder()
        .decode(compareResult.stdout)
        .trim();
      const compareStderr = new TextDecoder()
        .decode(compareResult.stderr)
        .trim();

      expect(compareResult.exitCode).toBe(0);
      expect(compareStderr).toBe('');

      const payload = JSON.parse(compareStdout) as {
        config: { comparePath?: string };
        comparison: {
          baselinePath: string;
          unmatchedCurrentCases: string[];
          unmatchedBaselineCases: string[];
          checksumMismatches: string[];
          cases: Array<{
            name: string;
            checksumMatches: boolean;
            baselineChecksum: number;
            currentChecksum: number;
          }>;
          stages: Array<{
            name: string;
            stages: Record<string, { medianDeltaMs: number }>;
          }>;
        };
      };

      expect(payload.config.comparePath).toBe(baselinePath);
      expect(payload.comparison.baselinePath).toBe(baselinePath);
      expect(payload.comparison.unmatchedCurrentCases).toEqual([]);
      expect(payload.comparison.unmatchedBaselineCases).toEqual([]);
      expect(payload.comparison.checksumMismatches).toEqual([]);
      expect(payload.comparison.cases).toHaveLength(1);
      expect(payload.comparison.cases[0]).toMatchObject({
        name: 'tiny-flat',
        checksumMatches: true,
      });
      expect(payload.comparison.cases[0]?.baselineChecksum).toBeGreaterThan(0);
      expect(payload.comparison.cases[0]?.currentChecksum).toBeGreaterThan(0);
      expect(payload.comparison.stages).toHaveLength(1);
      expect(payload.comparison.stages[0]?.name).toBe('tiny-flat');
      expect(
        typeof payload.comparison.stages[0]?.stages.buildPathGraph
          ?.medianDeltaMs
      ).toBe('number');
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });
});

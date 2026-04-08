import { describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const textDecoder = new TextDecoder();

function runClientRenderBenchmark(args: string[]) {
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] != null
    )
  );
  env.AGENT = '1';
  delete env.FORCE_COLOR;
  delete env.NO_COLOR;

  const result = Bun.spawnSync({
    cmd: [
      'bun',
      'run',
      './scripts/benchmarkVirtualizedFileTreeClientMount.ts',
      ...args,
    ],
    cwd: packageRoot,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  return {
    result,
    stdout: textDecoder.decode(result.stdout).trim(),
    stderr: textDecoder.decode(result.stderr).trim(),
  };
}

describe('virtualized client render benchmark CLI', () => {
  test('emits JSON for a tiny-flat smoke run', () => {
    const { result, stdout, stderr } = runClientRenderBenchmark([
      '--case=tiny-flat',
      '--runs=1',
      '--warmup-runs=0',
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
        mountHarness: string;
        buildCommand: string;
      };
      config: {
        runs: number;
        warmupRuns: number;
        caseFilters: string[];
        viewportHeight: number;
      };
      cases: Array<{
        name: string;
        fileCount: number;
        renderedItemCount: number;
        shadowHtmlChecksum: number;
      }>;
    };

    expect(payload.benchmark).toBe('virtualizedFileTreeClientMount');
    expect(payload.runtime).toMatchObject({
      codePath: 'dist',
      nodeEnv: 'production',
      renderer: 'preact-dom',
      mountHarness: 'jsdom-fresh-filetree-render',
      buildCommand: 'bun run build',
    });
    expect(payload.config.runs).toBe(1);
    expect(payload.config.warmupRuns).toBe(0);
    expect(payload.config.caseFilters).toEqual(['tiny-flat']);
    expect(payload.config.viewportHeight).toBe(500);
    expect(payload.cases).toHaveLength(1);
    expect(payload.cases[0]).toMatchObject({
      name: 'tiny-flat',
      fileCount: 128,
    });
    expect(payload.cases[0]?.renderedItemCount).toBeGreaterThan(0);
    expect(payload.cases[0]?.shadowHtmlChecksum).toBeGreaterThan(0);
  });
});

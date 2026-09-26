import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { arch, cpus, platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import type { MemoryCase, MemoryRequest, MemoryResult } from './memory-worker';

const { values: flags } = parseArgs({
  args: process.argv.slice(2),
  options: {
    samples: { type: 'string', default: '5' },
    json: { type: 'string' },
  },
});
const samples = Number(flags.samples);
assert.ok(
  Number.isSafeInteger(samples) && samples > 0,
  '--samples must be a positive integer'
);
const engines = [
  ['highlights', 'Highlights'],
  ['shiki-js', 'Shiki JS'],
  ['shiki-wasm', 'Shiki Wasm'],
] as const;
const cases: MemoryCase[] = [];
for (const [fixture, repeat] of [
  ['tiny.ts', 1],
  ['small.ts', 1],
  ['large.ts', 1],
  ['large.ts', 10],
] as const) {
  for (const mode of ['html', 'tokens'] as const) {
    cases.push({
      name: `${fixture}${repeat > 1 ? ` ×${repeat}` : ''} → ${mode}`,
      mode,
      fixture: fileURLToPath(
        new URL(`./fixtures/${fixture}.txt`, import.meta.url)
      ),
      repeat,
    });
  }
}

const environment = {
  date: new Date().toISOString(),
  platform: platform(),
  arch: arch(),
  cpu: cpus()[0]?.model,
  bun: Bun.version,
  shiki: (
    JSON.parse(
      readFileSync(new URL(import.meta.resolve('shiki/package.json')), 'utf8')
    ) as { version: string }
  ).version,
};
const results: (MemoryResult & {
  engine: MemoryRequest['engine'];
  scenario: string;
  sample: number;
})[] = [];
const directory = mkdtempSync(join(tmpdir(), 'highlights-memory-'));

try {
  // Compile outside the measured processes so WABT/Binaryen are never counted.
  const { listTokenTypes, optimizeWasm, transformWat, wat2wasm } =
    await import('../scripts/build');
  const { default: tokenTypes } = await import('../lib/token-types');
  const source = new URL('../src/highlights.wat', import.meta.url);
  const { code, enumMap } = transformWat(source);
  assert.deepEqual(
    listTokenTypes(enumMap),
    tokenTypes,
    'Generated token table is stale'
  );
  writeFileSync(
    join(directory, 'highlights.wasm'),
    optimizeWasm(wat2wasm(source.pathname, code))
  );
  const build = await Bun.build({
    entrypoints: [
      fileURLToPath(new URL('../lib/index.ts', import.meta.url)),
      fileURLToPath(new URL('./memory-worker.ts', import.meta.url)),
    ],
    outdir: directory,
    naming: '[name].mjs',
    target: 'bun',
    format: 'esm',
  });
  if (!build.success)
    throw new AggregateError(build.logs, 'Memory benchmark build failed');

  console.log(
    `${environment.cpu}; ${environment.platform} ${environment.arch}; Bun ${environment.bun}; Shiki ${environment.shiki}`
  );
  console.log(
    `${samples} fresh processes per case/engine; sequential runs; GitHub Dark.`
  );
  console.log(
    'MiB; RSS includes the runtime, compiled code, and allocator capacity.\n'
  );
  for (let sample = 0; sample < samples; sample++) {
    for (const scenario of cases) {
      for (let offset = 0; offset < engines.length; offset++) {
        const [engine] = engines[(sample + offset) % engines.length];
        const request: MemoryRequest = {
          engine,
          scenario,
          highlights: pathToFileURL(join(directory, 'index.mjs')).href,
          shiki: import.meta.resolve('shiki'),
          wasm: join(directory, 'highlights.wasm'),
          theme: fileURLToPath(
            new URL('../themes/github-dark.json', import.meta.url)
          ),
        };
        const child = Bun.spawn(
          [
            process.execPath,
            join(directory, 'memory-worker.mjs'),
            JSON.stringify(request),
          ],
          { stdout: 'pipe', stderr: 'pipe' }
        );
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        assert.equal(exitCode, 0, `${engine} ${scenario.name}: ${stderr}`);
        const result = JSON.parse(stdout) as MemoryResult;
        results.push({ ...result, engine, scenario: scenario.name, sample });
      }
      console.log(`${sample + 1}/${samples}: ${scenario.name}`);
    }
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}

console.log('\nPeak RSS through first call — median MiB');
console.table(
  cases.map((scenario) => {
    const readings = results.filter((r) => r.scenario === scenario.name);
    const bytes = readings[0].inputBytes;
    const size =
      bytes < 1048576
        ? `${Math.round(bytes / 1024)} KiB`
        : `${Math.round(bytes / 1048576)} MiB`;
    const row: Record<string, string> = {
      Workload: `${size} → ${scenario.mode === 'html' ? 'HTML' : 'tokens'}`,
    };
    for (const [engine, label] of engines) {
      const values = readings
        .filter((r) => r.engine === engine)
        .map((r) => r.firstCall.peakRss)
        .sort((a, b) => a - b);
      const middle = Math.floor(values.length / 2);
      const median =
        values.length % 2 === 0
          ? (values[middle - 1] + values[middle]) / 2
          : values[middle];
      row[label] = (median / 1048576).toFixed(0);
    }
    return row;
  })
);

if (flags.json !== undefined) {
  writeFileSync(
    flags.json,
    JSON.stringify({ environment, samples, cases, results }, null, 2) + '\n'
  );
  console.log(`\nRaw measurements: ${flags.json}`);
}

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import type { MemoryRequest, MemoryResult } from './memory-worker.ts';
import {
  type Engine,
  environment,
  labels,
  loadFixtures,
  median,
  parsers,
  streamers,
} from './shared.ts';
import { chunkEnds } from './stream.ts';

const { values: flags } = parseArgs({
  options: {
    samples: { type: 'string', default: '5' },
    fixture: { type: 'string' },
    mode: { type: 'string', default: 'all' },
    'chunk-size': { type: 'string', default: '256' },
    json: { type: 'string' },
  },
});
const samples = Number(flags.samples);
assert.ok(
  Number.isSafeInteger(samples) && samples > 0,
  '--samples must be a positive integer'
);
assert.ok(
  ['html', 'stream', 'all'].includes(flags.mode),
  '--mode must be html, stream, or all'
);
const chunkSize = Number(flags['chunk-size']);
chunkEnds('', chunkSize);
const fixtures = loadFixtures(flags.fixture);
const results: (MemoryResult & {
  engine: Engine;
  fixture: string;
  sample: number;
})[] = [];
const skipped = new Map<Engine, string>();
const system = environment();
console.log(system);
const worker = fileURLToPath(new URL('./memory-worker.ts', import.meta.url));
for (const mode of ['html', 'stream']) {
  if (flags.mode !== 'all' && flags.mode !== mode) continue;
  const engines = mode === 'html' ? parsers : streamers;
  for (const fixture of fixtures) {
    for (let sample = 0; sample < samples; sample++) {
      for (let offset = 0; offset < engines.length; offset++) {
        const engine = engines[(sample + offset) % engines.length];
        if (skipped.has(engine)) continue;
        const request: MemoryRequest = {
          engine,
          fixture: fixture.path,
          chunkSize,
        };
        const child = spawnSync(
          process.execPath,
          ['--expose-gc', worker, JSON.stringify(request)],
          {
            encoding: 'utf8',
            timeout: 180000,
            env: { ...process.env, NODE_ENV: 'production' },
          }
        );
        if (child.error != null) throw child.error;
        assert.equal(
          child.status,
          0,
          `${engine}: ${child.signal ?? ''}\n${child.stderr}\n${child.stdout}`
        );
        const result = JSON.parse(child.stdout) as
          | MemoryResult
          | { skipped: string };
        if ('skipped' in result) {
          skipped.set(engine, result.skipped);
          console.warn(`Skip ${labels[engine]}: ${result.skipped}`);
        } else {
          if (child.stderr.trim() !== '') process.stderr.write(child.stderr);
          results.push({ engine, fixture: fixture.name, sample, ...result });
        }
      }
    }
    console.log(
      `Measured ${mode}: ${fixture.name} (${samples} samples/engine)`
    );
  }
  // Subtract each process's own pre-import peak: Node's ~80 MiB baseline
  // varies by a few MiB per process, as much as the HTML engines differ.
  console.log(
    `\n${mode === 'html' ? 'HTML strings' : 'React streaming in JSDOM'}: median peak RSS growth over the pre-import baseline, MiB (lower is better)`
  );
  console.table(
    fixtures.map((fixture) => ({
      Fixture: fixture.name,
      KiB: (fixture.bytes / 1024).toFixed(1),
      ...Object.fromEntries(
        engines.map((engine) => {
          const values = results.filter(
            (r) => r.engine === engine && r.fixture === fixture.name
          );
          return [
            labels[engine],
            values.length === 0
              ? 'skipped'
              : (
                  median(
                    values.map((r) => r.firstCall.peakRss - r.baseline.peakRss)
                  ) / 1048576
                ).toFixed(1),
          ];
        })
      ),
    }))
  );
}
if (flags.json != null) {
  writeFileSync(
    flags.json,
    JSON.stringify(
      {
        environment: system,
        samples,
        chunkSize,
        mode: flags.mode,
        skipped: Object.fromEntries(skipped),
        results,
      },
      null,
      2
    ) + '\n'
  );
}

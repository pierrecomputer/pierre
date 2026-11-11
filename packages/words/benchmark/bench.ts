import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import {
  type Engine,
  environment,
  labels,
  loadFixtures,
  loadParser,
  measure,
  parsers,
  streamers,
  unavailable,
} from './shared.ts';
import { chunkEnds, loadStream } from './stream.ts';

process.env.NODE_ENV = 'production';
const { values: flags } = parseArgs({
  options: {
    stream: { type: 'boolean', default: false },
    quick: { type: 'boolean', default: false },
    fixture: { type: 'string' },
    'chunk-size': { type: 'string', default: '256' },
    json: { type: 'string' },
  },
});
const chunkSize = Number(flags['chunk-size']);
chunkEnds('', chunkSize);
const fixtures = loadFixtures(flags.fixture);
const engines: {
  id: Engine;
  run(source: string): string | HTMLElement;
  cleanup?(): void;
}[] = [];
const skipped: { engine: Engine; reason: string }[] = [];
for (const id of flags.stream ? streamers : parsers) {
  try {
    if (id === 'words-react' || id === 'streamdown') {
      const stream = await loadStream(id);
      engines.push({
        id,
        run: (source) => stream.run(source, chunkSize),
        cleanup: stream.cleanup,
      });
    } else {
      engines.push({ id, run: await loadParser(id) });
    }
  } catch (error) {
    if (id === 'words' || id === 'words-react' || !unavailable(error))
      throw error;
    const reason = String(error);
    skipped.push({ engine: id, reason });
    console.warn(`Skip ${labels[id]}: ${reason}`);
  }
}
const system = environment();
console.log(system);
console.log(
  flags.stream
    ? `React streaming in JSDOM; ${chunkSize} UTF-16 units/chunk; total ms/replay (lower is better).`
    : 'Markdown → HTML strings; input MiB/s (higher is better).'
);
if (flags.quick)
  console.log('Quick check only; do not use these timings for comparisons.');
const results = [];
for (const fixture of fixtures) {
  for (const engine of engines) {
    const output = engine.run(fixture.source);
    assert.ok(
      typeof output === 'string'
        ? output.length > 0
        : output.childElementCount > 0,
      `${engine.id}: empty output for ${fixture.name}`
    );
    const text = typeof output === 'string' ? output : output.textContent;
    engine.cleanup?.();
    if (engine.id === 'words-react' || engine.id === 'streamdown') {
      const fresh = await loadStream(engine.id);
      try {
        assert.equal(
          fresh.run(fixture.source, Math.max(1, fixture.source.length))
            .textContent,
          text,
          `${engine.id}: streamed text differs from a complete render of ${fixture.name}`
        );
      } finally {
        fresh.cleanup();
      }
    }
  }
  const timings = measure(
    engines.map((engine) => ({
      run: () => engine.run(fixture.source),
      cleanup: engine.cleanup,
    })),
    flags.quick
  );
  const measurements = engines.map((engine, index) => ({
    engine: engine.id,
    ...timings[index],
    mibPerSecond: fixture.bytes / 1048576 / (timings[index].medianMs / 1000),
  }));
  results.push({
    fixture: fixture.name,
    bytes: fixture.bytes,
    ...(flags.stream
      ? {
          chunks: chunkEnds(fixture.source, chunkSize).length,
          commits: chunkEnds(fixture.source, chunkSize).length + 1,
        }
      : {}),
    measurements,
  });
  console.log(
    `Measured ${fixture.name} (${fixture.bytes.toLocaleString()} bytes)`
  );
}
console.table(
  results.map((result) => ({
    Fixture: result.fixture,
    KiB: (result.bytes / 1024).toFixed(1),
    ...(flags.stream ? { Chunks: result.chunks } : {}),
    ...Object.fromEntries(
      result.measurements.map((entry) => [
        labels[entry.engine],
        (flags.stream ? entry.medianMs : entry.mibPerSecond).toFixed(2),
      ])
    ),
  }))
);
if (flags.json != null) {
  writeFileSync(
    flags.json,
    JSON.stringify(
      {
        environment: system,
        mode: flags.stream ? 'stream' : 'html',
        quick: flags.quick,
        chunkSize,
        skipped,
        results,
      },
      null,
      2
    ) + '\n'
  );
}

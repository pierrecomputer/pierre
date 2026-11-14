import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { environment, median } from './shared.ts';

const { values: flags } = parseArgs({
  options: {
    baseline: { type: 'string' },
    candidate: { type: 'string' },
    json: { type: 'string' },
  },
});
assert.ok(flags.baseline !== undefined, '--baseline is required');
const repositories = [
  resolve(flags.baseline),
  flags.candidate === undefined
    ? fileURLToPath(new URL('../../../', import.meta.url))
    : resolve(flags.candidate),
];
const entries = repositories.map((repo) => {
  const bytes = readFileSync(repo + '/packages/words/dist/md.wasm');
  return {
    repo,
    resolvedEntry: '',
    wasmSha256: createHash('sha256').update(bytes).digest('hex'),
    module: new WebAssembly.Module(bytes),
    importSamplesMs: [] as number[],
    instanceSamplesMs: [] as number[],
  };
});
// Each child includes package resolution in the import, then validates outside it.
const cold = `
const specifier = process.argv[1];
const start = performance.now();
const module = await import(specifier);
const elapsed = performance.now() - start;
if (new TextDecoder().decode(module.renderToHtml('# Hello')) !== '<h1>Hello</h1>\\n')
  throw new Error('Unexpected renderer output');
console.log(JSON.stringify({ elapsed, resolvedEntry: import.meta.resolve(specifier) }));
`;
for (let round = 0; round < 30; round++)
  for (const side of round % 2 === 0 ? [0, 1] : [1, 0]) {
    const entry = entries[side];
    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '--eval', cold, '@pierre/words'],
      { cwd: entry.repo + '/packages/words', encoding: 'utf8' }
    );
    assert.equal(result.status, 0, result.stderr);
    const { elapsed, resolvedEntry } = JSON.parse(result.stdout) as {
      elapsed: number;
      resolvedEntry: string;
    };
    assert.ok(typeof elapsed === 'number' && Number.isFinite(elapsed));
    assert.ok(typeof resolvedEntry === 'string');
    if (round > 0) assert.equal(resolvedEntry, entry.resolvedEntry);
    entry.resolvedEntry = resolvedEntry;
    entry.importSamplesMs.push(elapsed);
  }
let consumed = 0;
for (let round = 0; round < 500; round++)
  for (const side of round % 2 === 0 ? [0, 1] : [1, 0]) {
    const entry = entries[side];
    const start = performance.now();
    const instance = new WebAssembly.Instance(entry.module, {});
    const elapsed = performance.now() - start;
    consumed += (instance.exports.memory as WebAssembly.Memory).buffer
      .byteLength;
    if (round >= 100) entry.instanceSamplesMs.push(elapsed);
  }
const results = entries.map(({ module: _module, ...entry }) => ({
  ...entry,
  entrySha256: createHash('sha256')
    .update(readFileSync(new URL(entry.resolvedEntry)))
    .digest('hex'),
  importMedianMs: median(entry.importSamplesMs),
  instanceMedianMs: median(entry.instanceSamplesMs),
}));
const report = {
  environment: environment([]),
  runtime: {
    executable: process.execPath,
    node: process.version,
    bun: process.versions.bun,
  },
  results,
  consumed,
};
console.table(
  results.map(({ repo, importMedianMs, instanceMedianMs }) => ({
    repo,
    importMedianMs,
    instanceMedianMs,
  }))
);
if (flags.json !== undefined)
  writeFileSync(flags.json, JSON.stringify(report, null, 2) + '\n');

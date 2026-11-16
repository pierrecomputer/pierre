import type { createHtmlSession as Session } from '@pierre/words';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import type { environment } from './shared.ts';
import type { loadStream } from './stream.ts';

process.env.NODE_ENV = 'production';
const { values: flags } = parseArgs({
  options: {
    repo: { type: 'string' },
    kind: { type: 'string', default: 'paragraph' },
    mode: { type: 'string', default: 'dom' },
    sizes: { type: 'string', default: '16384,65536,262144' },
    'chunk-size': { type: 'string', default: '256' },
    json: { type: 'string' },
  },
});
assert.ok(['paragraph', 'rich-paragraph', 'fence'].includes(flags.kind));
const fence = flags.kind === 'fence';
const prefix =
  flags.kind === 'rich-paragraph'
    ? 'A **formatted introduction** with [a link](/docs), followed by '
    : '';
const prefixText =
  flags.kind === 'rich-paragraph'
    ? 'A formatted introduction with a link, followed by '
    : '';
assert.ok(flags.mode === 'dom' || flags.mode === 'session');
const sizes = flags.sizes.split(',').map(Number);
const chunk = Number(flags['chunk-size']);
assert.ok(Number.isSafeInteger(chunk) && chunk > 0);
assert.ok(sizes.every((size) => Number.isSafeInteger(size) && size > 0));
const directory =
  flags.repo === undefined
    ? fileURLToPath(new URL('../', import.meta.url))
    : resolve(flags.repo, 'packages/words');
const entry = createRequire(resolve(directory, 'package.json')).resolve(
  '@pierre/words'
);
const { createHtmlSession } = (await import(pathToFileURL(entry).href)) as {
  createHtmlSession: typeof Session;
};
const { environment: runtimeEnvironment } = (await import(
  pathToFileURL(resolve(directory, 'benchmark/shared.ts')).href
)) as { environment: typeof environment };
let streamer: Awaited<ReturnType<typeof loadStream>> | undefined;
if (flags.mode === 'dom') {
  const stream = (await import(
    pathToFileURL(resolve(directory, 'benchmark/stream.ts')).href
  )) as { loadStream: typeof loadStream };
  streamer = await stream.loadStream('words-react');
}
const median = (values: number[]): number =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const results = [];
let consumed = 0;
for (const size of sizes) {
  const line: string = fence
    ? 'const value = "<&>"; // é 中, ordinary code\n'
    : 'Ordinary prose, with words and numbers 12345. ';
  const body: string = line
    .repeat(Math.ceil(size / line.length))
    .slice(0, size);
  const source: string = fence
    ? '```typescript\n' + body + '\n```\n'
    : prefix + body + '\n\n';
  const run = (): string | HTMLElement => {
    if (streamer !== undefined) return streamer.run(source, chunk);
    const session = createHtmlSession();
    for (let end = chunk; end < source.length + chunk; end += chunk) {
      const pending = session.render(source.slice(0, end), {
        incomplete: true,
      }).pending;
      // Consume each lazy result so parsing and materialization remain measured.
      if (pending.length > 0)
        consumed = (consumed + pending.charCodeAt(pending.length >>> 1)) | 0;
    }
    return session.render(source, { incomplete: true }).html;
  };
  const output = run();
  // Capture before cleanup: unmounting empties the returned container.
  const text = typeof output === 'string' ? output : output.textContent;
  assert.ok(text.length >= body.trimEnd().length);
  if (typeof output !== 'string') {
    const content: Element | null = output.querySelector(
      fence ? 'pre code' : 'p'
    );
    assert.equal(
      content?.textContent,
      fence ? body + '\n' : prefixText + body.trimEnd()
    );
  } else
    assert.equal(
      text,
      createHtmlSession().render(source, { incomplete: true }).html
    );
  const hash = createHash('sha256').update(text).digest('hex');
  streamer?.cleanup();
  for (const end = performance.now() + 500; performance.now() < end; ) {
    run();
    streamer?.cleanup();
  }
  const samples: number[] = [];
  let total = 0;
  while (samples.length < 8 || total < 1000) {
    const at = performance.now();
    const result = run();
    const elapsed = performance.now() - at;
    samples.push(elapsed);
    total += elapsed;
    consumed =
      (consumed +
        (typeof result === 'string'
          ? result.length
          : result.childNodes.length)) |
      0;
    streamer?.cleanup();
  }
  const row = {
    size,
    sourceLength: source.length,
    bytes: Buffer.byteLength(source),
    hash,
    outputLength: text.length,
    medianMs: median(samples),
    samples,
  };
  results.push(row);
  console.log({ ...row, samples: samples.length });
}
const record = {
  environment: runtimeEnvironment(['react', 'jsdom']),
  directory,
  entry,
  kind: flags.kind,
  mode: flags.mode,
  chunk,
  consumed,
  results,
};
if (flags.json !== undefined)
  writeFileSync(flags.json, JSON.stringify(record, null, 2) + '\n');
process.exit(0);

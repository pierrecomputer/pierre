import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { environment, median, p95 } from '../shared.ts';
import type { ReplayResult } from './app.ts';

const { values: flags } = parseArgs({
  options: {
    repo: { type: 'string' },
    kind: { type: 'string', default: 'paragraph' },
    mode: { type: 'string', default: 'plain' },
    size: { type: 'string', default: '262144' },
    'chunk-size': { type: 'string', default: '256' },
    runs: { type: 'string', default: '3' },
    channel: { type: 'string', default: 'chromium' },
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
assert.ok(['plain', 'highlight', 'animated'].includes(flags.mode));
assert.ok(flags.channel === 'chromium' || flags.channel === 'chrome');
const size = Number(flags.size);
const chunk = Number(flags['chunk-size']);
const runs = Number(flags.runs);
assert.ok(Number.isSafeInteger(size) && size > 0);
assert.ok(Number.isSafeInteger(chunk) && chunk > 0 && chunk % 32 === 0);
assert.ok(Number.isSafeInteger(runs) && runs > 0);
const repo =
  flags.repo === undefined
    ? resolve(import.meta.dir, '../../../..')
    : resolve(flags.repo);
const directory = join(repo, 'packages/words/benchmark/browser');
const line = fence
  ? 'const value = "<&>"; // é 中, ordinary code\n'
  : 'Ordinary prose, with words and numbers 12345. ';
const body = line.repeat(Math.ceil(size / line.length)).slice(0, size);
const source = fence
  ? '```typescript\n' + body + '\n```\n'
  : prefix + body + '\n\n';
const expected = fence ? body + '\n' : prefixText + body.trimEnd();
const fixtureModule =
  `const line=${JSON.stringify(line)};` +
  `const body=line.repeat(Math.ceil(${size}/line.length)).slice(0,${size});` +
  'export const createStressFixture=()=>' +
  (fence
    ? JSON.stringify('```typescript\n') + '+body+' + JSON.stringify('\n```\n')
    : JSON.stringify(prefix) + "+body+'\\n\\n'") +
  ';';
const { outputs, success, logs } = await Bun.build({
  entrypoints: [join(directory, 'words.ts')],
  naming: { entry: 'app.[ext]' },
  target: 'browser',
  format: 'esm',
  splitting: true,
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'incremental-fixture',
      setup(build) {
        build.onLoad({ filter: /benchmark\/fixtures\/index\.ts$/ }, () => ({
          contents: fixtureModule,
          loader: 'ts',
        }));
      },
    },
  ],
});
assert.ok(success, logs.map((log) => log.message).join('\n'));
const pages = new Map<string, { body: Buffer; contentType: string }>();
const bundle = createHash('sha256');
for (const file of outputs) {
  const contents = Buffer.from(await file.arrayBuffer());
  const name = '/' + basename(file.path);
  pages.set(name, { body: contents, contentType: file.type });
  bundle.update(name).update(contents);
}
pages.set('/', {
  body: Buffer.from(
    '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="app.css"><div id="app"></div><script type="module" src="app.js"></script>'
  ),
  contentType: 'text/html',
});
const git = (args: string[]): string | null => {
  const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
};
const settings = {
  kind: flags.kind,
  mode: flags.mode,
  contentUnits: size,
  chunkUnits: chunk,
  intervalMs: 40,
  viewport: { width: 1280, height: 960 },
  runs,
  channel: flags.channel,
};
/** Stop stalled replays while always closing their browser. */
async function within<T>(
  promise: Promise<T>,
  milliseconds: number
): Promise<T | undefined> {
  const timer = new AbortController();
  try {
    return await Promise.race([
      promise,
      delay(milliseconds, undefined, { signal: timer.signal }),
    ]);
  } finally {
    timer.abort();
  }
}
const system = environment(['@playwright/test']);
const { environment: targetEnvironment } = (await import(
  pathToFileURL(join(repo, 'packages/words/benchmark/shared.ts')).href
)) as { environment: typeof environment };
const rendererVersions = targetEnvironment(['react']).versions;
const records = [];
let chrome = '';
for (let run = 0; run < runs; run++) {
  const browser = await chromium.launch({ channel: flags.channel });
  try {
    chrome = browser.version();
    const page = await browser.newPage({ viewport: settings.viewport });
    await page.route('http://localhost/**', (route) => {
      const file = pages.get(new URL(route.request().url()).pathname);
      return route.fulfill(file ?? { status: 404 });
    });
    const cdp = await page.context().newCDPSession(page);
    const heap = async (): Promise<{
      usedSize: number;
      totalSize: number;
      embedderHeapUsedSize?: number;
      backingStorageSize?: number;
    }> => {
      await cdp.send('HeapProfiler.collectGarbage');
      await cdp.send('HeapProfiler.collectGarbage');
      return await cdp.send('Runtime.getHeapUsage');
    };
    await page.goto(
      `http://localhost/?scale=${chunk / 32}&mode=${flags.mode}&interval=${settings.intervalMs}`
    );
    assert.equal(
      await within(page.evaluate('bench.ready.then(() => true)'), 30000),
      true,
      'Warmup timed out'
    );
    const before = await heap();
    const result = await within(
      page.evaluate<ReplayResult>('bench.run()'),
      Math.max(180000, Math.ceil(source.length / chunk) * 140)
    );
    assert.ok(result !== undefined, 'Replay timed out');
    const text: string | null | undefined = await page.evaluate(
      (selector) => document.querySelector(selector)?.textContent,
      fence ? '#preview pre code' : '#preview p'
    );
    assert.ok(typeof text === 'string', 'Missing rendered content');
    assert.equal(
      text,
      expected,
      'Exact streamed content differs from the fixture'
    );
    assert.deepEqual(result.errors, []);
    assert.equal(result.updates.length, Math.ceil(source.length / chunk));
    assert.equal(result.paragraphs, fence ? 0 : 1);
    assert.equal(result.fences, flags.kind === 'fence' ? 1 : 0);
    assert.equal(
      result.highlightedFences,
      flags.kind === 'fence' && flags.mode !== 'plain' ? 1 : 0
    );
    const after = await heap();
    const record = {
      run,
      updateP95Ms: p95(result.updates),
      frameP95Ms: p95(result.frames),
      heapBytes: after.usedSize - before.usedSize,
      initialHeap: before,
      finalHeap: after,
      exactTextHash: createHash('sha256').update(text).digest('hex'),
      exactTextLength: text.length,
      ...result,
    };
    records.push(record);
    console.log({
      run,
      updateP95Ms: record.updateP95Ms,
      frameP95Ms: record.frameP95Ms,
      heapBytes: record.heapBytes,
    });
  } finally {
    await browser.close();
  }
}
const status = git(['status', '--porcelain']);
const report = {
  environment: system,
  rendererVersions,
  bun: Bun.version,
  chrome,
  repo,
  commit: git(['rev-parse', 'HEAD']),
  dirty: status === null ? null : status !== '',
  bundleSha256: bundle.digest('hex'),
  sourceSha256: createHash('sha256').update(source).digest('hex'),
  settings,
  median: {
    updateP95Ms: median(records.map((record) => record.updateP95Ms)),
    frameP95Ms: median(records.map((record) => record.frameP95Ms)),
    heapBytes: median(records.map((record) => record.heapBytes)),
  },
  records,
};
console.log(report.median);
if (flags.json !== undefined)
  await Bun.write(flags.json, JSON.stringify(report, null, 2) + '\n');

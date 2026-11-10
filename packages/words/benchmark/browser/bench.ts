import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { basename, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';

import { createStressFixture } from '../fixtures/index.ts';
import { environment, median, p95 } from '../shared.ts';
import type { ReplayResult } from './app.ts';
import { measureDownload, printDownload } from './download.ts';

const { values: flags } = parseArgs({
  options: {
    quick: { type: 'boolean', default: false },
    runs: { type: 'string', default: '3' },
    json: { type: 'string' },
    docs: { type: 'boolean', default: false },
  },
});
assert.ok(!(flags.quick && flags.docs), 'Do not publish --quick results');
const runs = flags.quick ? 1 : Number(flags.runs);
assert.ok(Number.isSafeInteger(runs) && runs > 0, '--runs must be positive');
const settings = {
  intervalMs: flags.quick ? 4 : 40,
  charactersPerUpdate: '32 × scale',
  viewport: { width: 1280, height: 960 },
  runs,
  stressTimeoutMs: 180000,
};
const libraries = ['words', 'streamdown'] as const;
const modes = ['plain', 'highlight', 'animated'];
const cases = [
  ...(flags.quick ? [1] : [1, 100]).flatMap((scale) =>
    modes.map((mode) => ({ scale, mode, stress: false }))
  ),
  ...(flags.quick ? [] : modes.slice(1)).map((mode) => ({
    scale: 1000,
    mode,
    stress: true,
  })),
];
const directory = import.meta.dir;
const commit = (await Bun.$`git rev-parse HEAD`.cwd(directory).text()).trim();
const dirty =
  (await Bun.$`git status --porcelain`.cwd(directory).text()).trim() !== '';
const system = environment([
  'react',
  'streamdown',
  '@streamdown/code',
  '@playwright/test',
]);
console.log({ ...system, bun: Bun.version, commit, dirty, settings });

// Production pages stay in memory; Playwright serves them from `pages`.
const pages = new Map<string, { body: Buffer; type: string }>();
for (const library of libraries) {
  const { outputs } = await Bun.build({
    entrypoints: [join(directory, `${library}.ts`)],
    naming: { entry: 'app.[ext]' },
    target: 'browser',
    format: 'esm',
    splitting: true,
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  for (const file of outputs)
    pages.set(`/${library}/${basename(file.path)}`, {
      body: Buffer.from(await file.arrayBuffer()),
      type: file.type,
    });
  pages.set(`/${library}/`, {
    body: Buffer.from(
      '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="app.css"><div id="app"></div><script type="module" src="app.js"></script>\n'
    ),
    type: 'text/html',
  });
}

let chrome = '';
// Resolve with undefined when the promise does not settle in time.
async function within<T>(promise: Promise<T>, ms: number) {
  const timer = new AbortController();
  try {
    return await Promise.race([
      promise,
      delay(ms, undefined, { signal: timer.signal }),
    ]);
  } finally {
    timer.abort();
  }
}

/**
 * One replay in a fresh browser. Heap is V8's used size after two forced GCs,
 * from the warmed empty renderer to the settled document.
 */
async function replay(
  library: string,
  scale: number,
  mode: string,
  timeout: number
) {
  const browser = await chromium.launch({ channel: 'chromium' });
  try {
    chrome = browser.version();
    const page = await browser.newPage({ viewport: settings.viewport });
    await page.route('http://localhost/**', (route) => {
      const file = pages.get(new URL(route.request().url()).pathname);
      return file === undefined
        ? route.fulfill({ status: 404 })
        : route.fulfill({ body: file.body, contentType: file.type });
    });
    const cdp = await page.context().newCDPSession(page);
    const heap = async () => {
      await cdp.send('HeapProfiler.collectGarbage');
      await cdp.send('HeapProfiler.collectGarbage');
      return (await cdp.send('Runtime.getHeapUsage')).usedSize;
    };
    await page.goto(
      `http://localhost/${library}/?scale=${scale}&mode=${mode}&interval=${settings.intervalMs}`
    );
    assert.equal(
      await within(page.evaluate('bench.ready.then(() => true)'), 30000),
      true,
      `${library}: warmup did not finish`
    );
    const baseline = await heap();
    const result = await within(
      page.evaluate<ReplayResult>('bench.run()'),
      timeout
    );
    if (result === undefined) return { status: 'timed-out' as const };
    return {
      status: 'completed' as const,
      updateP95Ms: p95(result.updates),
      frameP95Ms: p95(result.frames),
      heapBytes: (await heap()) - baseline,
      ...result,
    };
  } finally {
    await browser.close();
  }
}

const records: (Awaited<ReturnType<typeof replay>> & {
  library: string;
  scale: number;
  mode: string;
  run: number;
})[] = [];
const hashes = new Map<number, string>();
for (const { scale, mode, stress } of cases) {
  const characters = createStressFixture(scale).length;
  for (let run = 0; run < (stress ? 1 : runs); run++) {
    // Alternate the first library to spread order and thermal bias.
    for (const library of run % 2 === 0
      ? libraries
      : [...libraries].reverse()) {
      const label = `${library} ${scale}× ${mode} #${run + 1}`;
      const result = await replay(
        library,
        scale,
        mode,
        stress ? settings.stressTimeoutMs : 600000
      );
      if (result.status === 'completed') {
        assert.deepEqual(result.errors, [], label);
        assert.equal(
          result.updates.length,
          Math.ceil(characters / (32 * scale)),
          `${label}: update count`
        );
        assert.equal(result.paragraphs, 101 * scale, `${label}: paragraphs`);
        assert.equal(result.fences, scale, `${label}: code blocks`);
        assert.equal(
          result.highlightedFences,
          mode === 'plain' ? 0 : scale,
          `${label}: highlighted code blocks`
        );
        if (!hashes.has(scale)) hashes.set(scale, result.textHash);
        assert.equal(result.textHash, hashes.get(scale), `${label}: text`);
        console.log(
          `${label}: update p95 ${result.updateP95Ms} ms, frame p95 ${result.frameP95Ms} ms, heap +${(result.heapBytes / 1e6).toFixed(1)} MB`
        );
      } else {
        assert.ok(stress, `${label}: timed out`);
        console.log(`${label}: timed out`);
      }
      records.push({ library, scale, mode, run, ...result });
    }
  }
}

// Median of each run's own p95, not a pooled percentile.
const summarize = ({ scale, mode }: { scale: number; mode: string }) => {
  const characters = createStressFixture(scale).length;
  const pick = (library: string) => {
    const done = records.flatMap((record) =>
      record.library === library &&
      record.scale === scale &&
      record.mode === mode &&
      record.status === 'completed'
        ? [record]
        : []
    );
    return done.length === 0
      ? { status: 'timed-out' }
      : {
          status: 'completed',
          runs: done.length,
          updateP95Ms: median(done.map((record) => record.updateP95Ms)),
          frameP95Ms: median(done.map((record) => record.frameP95Ms)),
          heapBytes: median(done.map((record) => record.heapBytes)),
          elements: done[0].elements,
        };
  };
  return {
    scale,
    mode,
    characters,
    updates: Math.ceil(characters / (32 * scale)),
    words: pick('words'),
    streamdown: pick('streamdown'),
  };
};

const { download, downloadRun } = await measureDownload();

const report = {
  date: system.date,
  commit,
  dirty,
  bun: Bun.version,
  platform: `${system.platform}/${system.arch}`,
  cpu: system.cpu,
  memoryBytes: system.memoryBytes,
  chrome,
  versions: system.versions,
  settings,
  rows: cases.filter((entry) => !entry.stress).map(summarize),
  stress: cases.filter((entry) => entry.stress).map(summarize),
  download,
  downloadRun,
};
console.log(`\nChromium ${chrome}: median of per-run p95 (lower is better)`);
console.table(
  [...report.rows, ...report.stress].map((row) => ({
    Case: `${row.scale}× ${row.mode}`,
    ...Object.fromEntries(
      libraries.flatMap((library) => {
        const value = row[library];
        return value.updateP95Ms === undefined
          ? [[`${library} update ms`, 'timed out']]
          : [
              [`${library} update ms`, value.updateP95Ms.toFixed(1)],
              [`${library} frame ms`, value.frameP95Ms.toFixed(1)],
              [`${library} heap MB`, (value.heapBytes / 1e6).toFixed(1)],
            ];
      })
    ),
  }))
);
printDownload(download);

if (flags.json != null)
  await Bun.write(
    flags.json,
    JSON.stringify({ ...report, runs: records }, null, 2) + '\n'
  );
if (flags.docs) {
  const docs = join(directory, '../../../../apps/docs/public/words');
  const { packageRun } = await Bun.file(join(docs, 'benchmark.json')).json();
  await Bun.write(
    join(docs, 'benchmark.json'),
    JSON.stringify({ browser: report, packageRun }, null, 2) + '\n'
  );
  // One record per run, enough to check each median; --json keeps every sample.
  await Bun.write(
    join(docs, 'benchmark-raw.json'),
    JSON.stringify(
      {
        ...report,
        runs: records.map((record) =>
          record.status === 'completed'
            ? { ...record, updates: undefined, frames: undefined }
            : record
        ),
      },
      null,
      2
    ) + '\n'
  );
}

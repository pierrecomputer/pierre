import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { basename, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';

import { environment, loadFixtures, median, p95 } from '../shared.ts';
import { chunkEnds } from '../stream.ts';
import type { ReplayResult } from './app.ts';
import { measureDownload, printDownload } from './download.ts';

const { values: flags } = parseArgs({
  options: {
    quick: { type: 'boolean', default: false },
    runs: { type: 'string', default: '3' },
    json: { type: 'string' },
    docs: { type: 'boolean', default: false },
    fixture: { type: 'string' },
  },
});
assert.ok(
  !(flags.docs && (flags.quick || flags.fixture != null)),
  'Do not publish --quick or --fixture results'
);
const runs = flags.quick ? 1 : Number(flags.runs);
assert.ok(Number.isSafeInteger(runs) && runs > 0, '--runs must be positive');
const settings = {
  intervalMs: flags.quick ? 4 : 40,
  charactersPerUpdate: 256,
  viewport: { width: 1280, height: 960 },
  runs,
};
const libraries = ['words', 'streamdown'] as const;
const modes = ['plain', 'highlight', 'animated'];
// The same documents as the Node suite, so browser and JSDOM numbers describe the same input.
const fixtures = loadFixtures(
  flags.fixture ?? (flags.quick ? 'assistant-review.md' : undefined)
);
const cases = fixtures.flatMap((fixture) => {
  const updates = chunkEnds(
    fixture.source,
    settings.charactersPerUpdate
  ).length;
  return modes.map((mode) => ({ fixture, mode, updates }));
});
const directory = import.meta.dir;
const commit = (await Bun.$`git rev-parse HEAD`.cwd(directory).text()).trim();
const dirty =
  (await Bun.$`git status --porcelain`.cwd(directory).text()).trim() !== '';
const system = environment([
  'react',
  'streamdown',
  '@streamdown/code',
  '@playwright/test',
  'shiki',
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
for (const { name, source } of fixtures)
  pages.set(`/fixtures/${name}`, {
    body: Buffer.from(source),
    type: 'text/markdown; charset=utf-8',
  });

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
async function replay(library: string, fixture: string, mode: string) {
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
      `http://localhost/${library}/?fixture=${fixture}&chunk=${settings.charactersPerUpdate}&mode=${mode}&interval=${settings.intervalMs}`
    );
    assert.equal(
      await within(page.evaluate('bench.ready.then(() => true)'), 30000),
      true,
      `${library}: warmup did not finish`
    );
    const baseline = await heap();
    const result = await within(
      page.evaluate<ReplayResult>('bench.run()'),
      600000
    );
    assert.ok(result !== undefined, `${library} ${fixture} ${mode}: timed out`);
    return {
      // Total work is fair across document sizes; p95 of a few updates is just the slowest one.
      updateTotalMs:
        Math.round(result.updates.reduce((sum, value) => sum + value, 0) * 10) /
        10,
      updateMedianMs: median(result.updates),
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
  fixture: string;
  mode: string;
  run: number;
})[] = [];
// Engines split paragraphs and know languages differently, so each library is only checked against itself.
const expected = new Map<string, ReplayResult>();
for (const { fixture, mode, updates } of cases) {
  for (let run = 0; run < runs; run++) {
    // Alternate the first library to spread order and thermal bias.
    for (const library of run % 2 === 0
      ? libraries
      : [...libraries].reverse()) {
      const label = `${library} ${fixture.name} ${mode} #${run + 1}`;
      const result = await replay(library, fixture.name, mode);
      assert.deepEqual(result.errors, [], label);
      assert.equal(result.updates.length, updates, `${label}: update count`);
      assert.ok(
        mode === 'plain'
          ? result.highlightedFences === 0
          : result.highlightedFences > 0 || result.fences === 0,
        `${label}: highlighted code blocks`
      );
      const key = `${library} ${fixture.name}`;
      const first = expected.get(key) ?? result;
      expected.set(key, first);
      assert.equal(result.paragraphs, first.paragraphs, `${label}: paragraphs`);
      assert.equal(result.fences, first.fences, `${label}: code blocks`);
      assert.equal(result.textHash, first.textHash, `${label}: text`);
      if (mode !== 'plain') {
        const highlighted = expected.get(`${key} highlight`) ?? result;
        expected.set(`${key} highlight`, highlighted);
        assert.equal(
          result.highlightedFences,
          highlighted.highlightedFences,
          `${label}: highlighted code blocks`
        );
      }
      console.log(
        `${label}: update total ${result.updateTotalMs} ms, median ${result.updateMedianMs} ms, p95 ${result.updateP95Ms} ms, frame p95 ${result.frameP95Ms} ms, heap +${(result.heapBytes / 1e6).toFixed(1)} MB`
      );
      records.push({ library, fixture: fixture.name, mode, run, ...result });
    }
  }
}

// Median across runs of each run's own total, median, and p95, not pooled samples.
const summarize = ({ fixture, mode, updates }: (typeof cases)[number]) => {
  const pick = (library: string) => {
    const done = records.filter(
      (record) =>
        record.library === library &&
        record.fixture === fixture.name &&
        record.mode === mode
    );
    return {
      runs: done.length,
      updateTotalMs: median(done.map((record) => record.updateTotalMs)),
      updateMedianMs: median(done.map((record) => record.updateMedianMs)),
      updateP95Ms: median(done.map((record) => record.updateP95Ms)),
      frameP95Ms: median(done.map((record) => record.frameP95Ms)),
      heapBytes: median(done.map((record) => record.heapBytes)),
      elements: done[0].elements,
      highlightedFences: done[0].highlightedFences,
    };
  };
  return {
    fixture: fixture.name,
    mode,
    characters: fixture.source.length,
    bytes: fixture.bytes,
    updates,
    words: pick('words'),
    streamdown: pick('streamdown'),
  };
};

const { download, downloadRun, downloadCoverage } = await measureDownload();

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
  rows: cases.map(summarize),
  download,
  downloadRun,
  downloadCoverage,
};
console.log(`\nChromium ${chrome}: median across runs (lower is better)`);
console.table(
  report.rows.map((row) => ({
    Case: `${row.fixture} ${row.mode}`,
    ...Object.fromEntries(
      libraries.flatMap((library) => {
        const value = row[library];
        return [
          [`${library} total ms`, value.updateTotalMs.toFixed(0)],
          [`${library} median ms`, value.updateMedianMs.toFixed(1)],
          [`${library} p95 ms`, value.updateP95Ms.toFixed(1)],
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
        runs: records.map((record) => ({
          ...record,
          updates: undefined,
          frames: undefined,
        })),
      },
      null,
      2
    ) + '\n'
  );
}

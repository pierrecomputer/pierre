import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const defaults = {
  input: resolve(
    repository,
    'packages/words/benchmark/results/2026-10-23-current.json'
  ),
  output: resolve(repository, 'apps/docs/public/words/benchmark.json'),
  rawOutput: resolve(repository, 'apps/docs/public/words/benchmark-raw.json'),
};
const modes = ['plain', 'highlight', 'animated'];
const providers = { words: 'pierre', streamdown: 'streamdown' };

function median(values) {
  assert(values.length > 0, 'Cannot aggregate an empty sample');
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2;
}

function numeric(value, field) {
  assert(
    Number.isFinite(value) && value >= 0,
    `Invalid nonnegative number: ${field}`
  );
  return value;
}

// Reject missing or unfinished measurements before they can become public bars.
function timingRows(report, section, scale, mode, provider) {
  const collection = report[section];
  const rows = collection.results
    .map((row, index) => ({ row, source: `${section}.results[${index}]` }))
    .filter(
      ({ row }) =>
        row.scale === scale && row.mode === mode && row.library === provider
    );
  assert.equal(
    rows.length,
    collection.metadata.runs,
    `Unexpected run count: ${section}/${scale}/${mode}/${provider}`
  );
  assert.deepEqual(
    rows.map(({ row }) => row.run).sort((left, right) => left - right),
    Array.from({ length: rows.length }, (_, index) => index),
    'Duplicate or missing run IDs'
  );
  for (const { row, source } of rows) {
    assert.equal(row.done, true, `Incomplete result: ${source}`);
    assert.deepEqual(row.errors, [], `Runtime errors: ${source}`);
    assert.equal(
      row.committedUpdates,
      row.expectedUpdates,
      `Missing deliveries: ${source}`
    );
    assert.equal(row.pendingHighlights, 0, `Unsettled highlighting: ${source}`);
    assert.equal(row.retainedFadeSpans, 0, `Unsettled animation: ${source}`);
    for (const field of [
      'commitP95',
      'frameP95',
      'longTaskCount',
      'settledElapsed',
    ])
      numeric(row[field], `${source}.${field}`);
  }
  return rows;
}

function aggregateTiming(rows) {
  return {
    runs: rows.length,
    updateP95Milliseconds: median(rows.map(({ row }) => row.commitP95)),
    frameP95Milliseconds: median(rows.map(({ row }) => row.frameP95)),
    longTasks: median(rows.map(({ row }) => row.longTaskCount)),
    settledReplayMilliseconds: median(
      rows.map(({ row }) => row.settledElapsed)
    ),
    sourceRows: rows.map(({ source }) => source),
  };
}

// Aggregate within-sample deltas instead of subtracting independently chosen medians.
function aggregateMemory(report, mode, provider) {
  const measurement = report.memory[mode];
  const samples = measurement.samples
    .map((row, index) => ({ row, source: `memory.${mode}.samples[${index}]` }))
    .filter(({ row }) => row.library === provider);
  assert.equal(
    samples.length,
    measurement.runs,
    `Unexpected memory run count: ${mode}/${provider}`
  );
  assert.deepEqual(
    samples.map(({ row }) => row.run).sort((left, right) => left - right),
    Array.from({ length: samples.length }, (_, index) => index),
    'Duplicate or missing memory run IDs'
  );
  for (const { row, source } of samples) {
    assert.equal(
      row.scale,
      measurement.scale,
      `Mismatched memory workload: ${source}`
    );
    for (const stage of ['baseline', 'settled', 'reset']) {
      numeric(row[stage].heapUsed, `${source}.${stage}.heapUsed`);
      assert.deepEqual(
        row[stage].errors,
        [],
        `Runtime errors: ${source}.${stage}`
      );
      assert.equal(
        row[stage].pendingHighlights,
        0,
        `Unsettled highlighting: ${source}.${stage}`
      );
      assert.equal(
        row[stage].fadeSpans,
        0,
        `Unsettled animation: ${source}.${stage}`
      );
    }
    assert.equal(
      row.retainedHeapDelta,
      row.settled.heapUsed - row.baseline.heapUsed,
      `Incorrect settled delta: ${source}`
    );
    assert.equal(
      row.resetHeapDelta,
      row.reset.heapUsed - row.baseline.heapUsed,
      `Incorrect reset delta: ${source}`
    );
  }
  return {
    runs: samples.length,
    baselineHeapBytes: median(samples.map(({ row }) => row.baseline.heapUsed)),
    settledHeapBytes: median(samples.map(({ row }) => row.settled.heapUsed)),
    additionalHeapBytes: median(
      samples.map(({ row }) => row.retainedHeapDelta)
    ),
    resetHeapBytes: median(samples.map(({ row }) => row.reset.heapUsed)),
    resetAboveBaselineBytes: median(
      samples.map(({ row }) => row.resetHeapDelta)
    ),
    sourceRows: samples.map(({ source }) => source),
  };
}

// Turn the reviewed complete snapshot into a smaller, traceable public dataset.
export function createChartData(
  bytes,
  sourcePath = 'packages/words/benchmark/results/2026-10-23-current.json'
) {
  const report = JSON.parse(bytes.toString('utf8'));
  assert.deepEqual(
    report.browser.metadata.modes,
    modes,
    'A complete three-mode browser matrix is required'
  );
  assert.deepEqual(
    report.browser.metadata.scales,
    [1, 100],
    'Both published workload scales are required'
  );
  assert(
    report.browser.metadata.runs >= 3,
    'Published timing comparisons require at least three runs'
  );
  assert.equal(
    report.browser.metadata.production,
    true,
    'Production builds are required'
  );
  assert.equal(
    report.browser.metadata.traced,
    false,
    'Traced timing results cannot be published'
  );
  assert.equal(
    report.browser.results.length,
    modes.length * 2 * 2 * report.browser.metadata.runs,
    'Unexpected browser matrix rows'
  );
  assert.deepEqual(
    report.stress.metadata.scales,
    [1000],
    'Expected the separate 1,000× capacity diagnostic'
  );
  assert.deepEqual(
    report.stress.metadata.modes,
    ['highlight', 'animated'],
    'Expected both stress modes'
  );
  assert.equal(
    report.stress.metadata.runs,
    1,
    'The published stress diagnostic uses one run'
  );
  assert.equal(
    report.stress.results.length,
    4,
    'Unexpected stress matrix rows'
  );

  const browserRows = [1, 100].flatMap((scale) =>
    modes.map((mode) => {
      const selected = Object.fromEntries(
        Object.entries(providers).map(([name, provider]) => [
          name,
          timingRows(report, 'browser', scale, mode, provider),
        ])
      );
      const all = Object.values(selected)
        .flat()
        .map(({ row }) => row);
      for (const field of [
        'characters',
        'chunk',
        'expectedUpdates',
        'semanticCharacters',
        'semanticHash',
      ]) {
        assert(
          all.every((row) => row[field] === all[0][field]),
          `Mismatched browser ${field}: ${scale}/${mode}`
        );
      }
      return {
        scale,
        mode,
        characters: all[0].characters,
        chunk: all[0].chunk,
        updates: all[0].expectedUpdates,
        ...Object.fromEntries(
          Object.entries(selected).map(([name, rows]) => [
            name,
            aggregateTiming(rows),
          ])
        ),
      };
    })
  );

  const memoryRows = ['highlight', 'animated'].map((mode) => {
    assert(
      report.memory[mode].runs >= 3,
      'Published memory comparisons require at least three samples'
    );
    assert.equal(
      report.memory[mode].scale,
      100,
      'Published memory uses the 100× fixture'
    );
    assert.equal(
      report.memory[mode].samples.length,
      2 * report.memory[mode].runs,
      'Unexpected memory matrix rows'
    );
    return {
      mode,
      scale: report.memory[mode].scale,
      ...Object.fromEntries(
        Object.entries(providers).map(([name, provider]) => [
          name,
          aggregateMemory(report, mode, provider),
        ])
      ),
    };
  });

  const footprintRows = [
    {
      id: 'base',
      label: 'Base React renderer · initial load',
      words: 'pierreBase',
      streamdown: 'streamdownBase',
      phase: 'initial',
    },
    {
      id: 'highlight',
      label: 'TypeScript + two themes · loaded closure',
      words: 'pierreCode',
      streamdown: 'streamdownCode',
      phase: 'configured',
    },
  ].map(({ id, label, words, streamdown, phase }) => {
    const wordsField = `footprint.variants.${words}.${phase}.gzip`;
    const streamdownField = `footprint.variants.${streamdown}.${phase}.gzip`;
    return {
      id,
      label,
      wordsGzipBytes: numeric(
        report.footprint.variants[words][phase].gzip,
        wordsField
      ),
      streamdownGzipBytes: numeric(
        report.footprint.variants[streamdown][phase].gzip,
        streamdownField
      ),
      sourceFields: {
        wordsGzipBytes: wordsField,
        streamdownGzipBytes: streamdownField,
      },
    };
  });

  const stressRows = report.stress.metadata.modes.map((mode) => ({
    mode,
    ...Object.fromEntries(
      Object.entries(providers).map(([name, provider]) => {
        const index = report.stress.results.findIndex(
          (row) =>
            row.library === provider && row.mode === mode && row.scale === 1000
        );
        assert(index >= 0, `Missing stress diagnostic: ${provider}/${mode}`);
        const row = report.stress.results[index];
        if (row.error) {
          assert.match(
            row.error,
            /Playback exceeded \d+ ms/,
            'Unrecognized stress failure'
          );
          return [
            name,
            {
              status: 'timed-out',
              reason: row.error,
              sourceRows: [`stress.results[${index}]`],
            },
          ];
        }
        return [
          name,
          {
            status: 'completed',
            ...aggregateTiming(
              timingRows(report, 'stress', 1000, mode, provider)
            ),
            elements: row.finalElements,
          },
        ];
      })
    ),
  }));

  return {
    schemaVersion: 1,
    provenance: {
      measuredAt: report.environment.measuredAt,
      sourcePath,
      sourceUrl: '/words/benchmark-raw.json',
      sourceSha256: createHash('sha256').update(bytes).digest('hex'),
      head: report.environment.head,
      uncommittedWorkingTree: report.environment.uncommittedWorkingTree,
      library: {
        name: '@pierre/words',
        capturedName: '@pierre/markdowns',
        distribution: 'unpublished workspace build',
        version: null,
        versionNote:
          'The snapshot did not record a package version; the source commit, uncommitted flag, and raw build hashes identify the measured code.',
      },
      notes: [
        'The measurements predate the package rename to Words. The original raw evidence is copied without modification.',
        'This is a reviewed historical measurement, not a benchmark of the currently checked-out build.',
      ],
    },
    environment: Object.fromEntries(
      [
        'cpu',
        'logicalCpus',
        'totalMemoryBytes',
        'platform',
        'macOS',
        'runtime',
        'browserUserAgent',
        'dependencies',
      ].map((field) => [field, report.environment[field]])
    ),
    browser: {
      aggregation:
        'Median of per-run metrics from three or more fresh-browser runs; update p95 is not a pooled percentile.',
      units: {
        updateP95Milliseconds: 'ms',
        frameP95Milliseconds: 'ms',
        longTasks: 'count',
        settledReplayMilliseconds: 'ms',
        characters: 'ASCII characters',
        chunk: 'characters per delivery',
      },
      fields: {
        updateP95Milliseconds: 'commitP95',
        frameP95Milliseconds: 'frameP95',
        longTasks: 'longTaskCount',
        settledReplayMilliseconds: 'settledElapsed',
      },
      metadata: report.browser.metadata,
      rows: browserRows,
    },
    memory: {
      aggregation:
        'Median of three or more fresh-browser samples; additional and reset heap deltas are computed within each sample before aggregation.',
      units: 'bytes',
      fields: {
        baselineHeapBytes: 'baseline.heapUsed',
        settledHeapBytes: 'settled.heapUsed',
        additionalHeapBytes: 'retainedHeapDelta',
        resetHeapBytes: 'reset.heapUsed',
        resetAboveBaselineBytes: 'resetHeapDelta',
      },
      notes: report.memory.highlight.notes,
      rows: memoryRows,
    },
    footprint: {
      units: 'gzip bytes',
      bundler: report.footprint.bundler,
      rows: footprintRows,
      css: {
        wordsGzipBytes: report.footprint.css.pierre.gzip,
        streamdownGzipBytes: report.footprint.css.streamdown.gzip,
        sourceFields: {
          wordsGzipBytes: 'footprint.css.pierre.gzip',
          streamdownGzipBytes: 'footprint.css.streamdown.gzip',
        },
      },
      notes: report.footprint.notes,
    },
    stress: {
      metadata: report.stress.metadata,
      rows: stressRows,
      note: 'Single-run 1,000× capacity diagnostics, not repeated estimates. A timeout has no numeric timing bar. Both completed implementations still have severe frame delays.',
    },
    caveats: [
      'Source-update latency ends at the parent layout effect and excludes subsequent paint and passive effects. It does not measure parser throughput or complete visual rendering.',
      'Both renderers use native streaming and incremental paths. Larger scales increase delivery size as well as accumulated content; this is not a fixed token-rate simulation.',
      'The repeated fixture contains identical TypeScript fences, allowing Streamdown code-cache reuse. Multiple languages and unique programs may behave differently.',
      'Small fixtures remain near a 60 Hz frame interval for both renderers. Faster update timings do not establish a visible frame-rate advantage.',
      'Fades use native behaviors: Words animates delivered text chunks including code; Streamdown animates prose words and skips code.',
      'Replay elapsed includes 40 ms delivery pacing and final settlement, so its ratio is not a CPU-throughput ratio.',
      'Additional settled JavaScript heap excludes native DOM, Wasm, graphics, and total process memory. It is not peak memory; reset deltas do not establish a leak.',
      'Configured transfer excludes React, React DOM, separately reported library CSS, application Tailwind CSS, other Streamdown languages, and extra plugins. Grammar coverage differs.',
    ],
  };
}

function parseArguments(args) {
  const options = { ...defaults, check: false };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--check') {
      options.check = true;
      continue;
    }
    const match = /^(--input|--output|--raw-output)(?:=(.*))?$/.exec(argument);
    assert(match, `Unknown option: ${argument}`);
    const value = match[2] ?? args[++index];
    assert(value && !value.startsWith('--'), `Expected path after ${match[1]}`);
    const key = match[1] === '--raw-output' ? 'rawOutput' : match[1].slice(2);
    options[key] = resolve(value);
  }
  assert.notEqual(
    options.input,
    options.output,
    'Summary output must not overwrite the input snapshot'
  );
  assert.notEqual(
    options.input,
    options.rawOutput,
    'Public raw output must not overwrite the input snapshot'
  );
  assert.notEqual(
    options.output,
    options.rawOutput,
    'Summary and raw output paths must differ'
  );
  return options;
}

export function run(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  const bytes = readFileSync(options.input);
  const inputRelative = relative(repository, options.input).replaceAll(
    '\\',
    '/'
  );
  const sourcePath =
    isAbsolute(inputRelative) || inputRelative.startsWith('..')
      ? options.input
      : inputRelative;
  const summary = Buffer.from(
    JSON.stringify(createChartData(bytes, sourcePath), null, 2) + '\n'
  );
  for (const [path, expected] of [
    [options.output, summary],
    [options.rawOutput, bytes],
  ]) {
    if (options.check) {
      assert(
        readFileSync(path).equals(expected),
        `Outdated chart evidence: ${path}. Regenerate with words:bench-chart.`
      );
    } else {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, expected);
    }
  }
  console.log(
    options.check
      ? 'Words chart evidence matches the reviewed source snapshot.'
      : 'Generated Words chart summary and byte-identical raw evidence.'
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  run();

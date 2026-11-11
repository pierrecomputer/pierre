'use client';

import { IconChevronSm } from '@pierre/icons';
import { type ComponentProps, useState } from 'react';

import { BenchmarkBar } from '../highlights/BenchmarkBar';
import cardStyles from '../highlights/HighlightsBenchmarkCard.module.css';
import benchmark from '@/public/words/benchmark.json';

const methodologyUrl =
  'https://github.com/pierrecomputer/pierre/tree/main/packages/words/benchmark';

const modes = [
  { id: 'plain', label: 'Plain Markdown' },
  { id: 'highlight', label: 'Syntax highlighting' },
  { id: 'animated', label: 'Highlighting + fades' },
] as const;

const decimal = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

function ChartSelect({ children, ...props }: ComponentProps<'select'>) {
  return (
    <span className="relative block min-w-0">
      <select
        {...props}
        className="text-foreground h-9 w-full min-w-0 cursor-pointer appearance-none truncate rounded-md border border-[var(--border)] bg-[var(--background)] py-2 pr-9 pl-3 text-xs leading-4 outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      >
        {children}
      </select>
      <IconChevronSm
        aria-hidden="true"
        size={16}
        className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 -translate-y-1/2"
      />
    </span>
  );
}

function Comparison({
  words,
  streamdown,
  unit,
  divisor = 1,
}: {
  words: number;
  streamdown: number;
  unit: string;
  divisor?: number;
}) {
  const maximum = Math.max(words, streamdown);

  return (
    <dl className="space-y-5">
      {[
        { name: 'Words', value: words },
        { name: 'Streamdown', value: streamdown },
      ].map(({ name, value }) => (
        <div key={name} className="grid grid-cols-2 items-baseline gap-y-2">
          <dt className="text-sm font-medium">{name}</dt>
          <dd className="contents">
            <span className="text-right text-2xl tracking-tight tabular-nums">
              {decimal.format(value / divisor)}
              <span className="text-muted-foreground ml-1 text-sm">{unit}</span>
            </span>
            <div className="col-span-2">
              <BenchmarkBar
                value={value}
                maximum={maximum}
                highlighted={name === 'Words'}
              />
            </div>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function capacityFrame(sample: { status: string; frameP95Ms?: number }) {
  return sample.status === 'completed' && sample.frameP95Ms !== undefined
    ? `${decimal.format(sample.frameP95Ms)} ms`
    : 'Timed out';
}

export function WordsBenchmarks() {
  const [metricIndex, setMetricIndex] = useState(0);
  const [scale, setScale] = useState(100);
  const [mode, setMode] = useState('highlight');
  const [memoryMode, setMemoryMode] = useState('highlight');
  const [footprintId, setFootprintId] = useState('shared');
  const [methodOpen, setMethodOpen] = useState(false);
  const [fixture, setFixture] = useState('gfm-spec.md');
  const suite = benchmark.packageRun;
  const metric = suite.metrics[metricIndex];
  const versions: Record<string, string> = suite.environment.versions;
  // Best result first, like the highlights chart.
  const results = metric.engines
    .map((engine, index) => ({
      engine,
      value: metric.rows.find((row) => row.fixture === fixture)!.values[index],
      version: versions[engine.split(' ')[0].toLowerCase()],
    }))
    .sort((a, b) =>
      metric.higherIsBetter === true ? b.value - a.value : a.value - b.value
    );
  const maximum = Math.max(...results.map(({ value }) => value));
  const run = benchmark.browser;
  const browser = run.rows.find(
    (row) => row.scale === scale && row.mode === mode
  )!;
  const memory = run.rows.find(
    (row) => row.scale === 100 && row.mode === memoryMode
  )!;
  const footprint = run.download[footprintId === 'base' ? 'base' : 'shared'];
  const coverage = run.downloadCoverage;
  const downloadRun = run.downloadRun;
  const date = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const measuredDate = date.format(new Date(run.date));
  const cardClass = `${cardStyles.card} dark text-foreground flex min-w-0 flex-col rounded-lg p-5 sm:p-7`;

  return (
    <section
      id="benchmarks"
      aria-labelledby="words-benchmarks"
      className="scroll-mt-20 space-y-6 pb-16 md:pb-24"
    >
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="max-w-2xl space-y-2">
          <h2
            id="words-benchmarks"
            className="text-2xl font-semibold tracking-tight"
          >
            Markdown rendering benchmarks
          </h2>
          <p className="text-muted-foreground text-pretty">
            Compare HTML throughput, React streaming time, and peak memory
            across five Markdown files.
          </p>
        </div>
        <a
          href="#words-benchmark-method"
          className="styled-link text-sm"
          onClick={() => setMethodOpen(true)}
        >
          How we measure ↓
        </a>
      </div>

      <figure className={cardClass} aria-labelledby="words-package-chart">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <figcaption>
            <h3
              id="words-package-chart"
              className="text-xl font-semibold tracking-tight"
            >
              Package benchmarks
            </h3>
            <p className="text-muted-foreground mt-1 text-sm">
              {date.format(new Date(suite.environment.date))} · Node{' '}
              {suite.environment.node} · {suite.environment.cpu} ·{' '}
              {suite.environment.memoryBytes / 1024 ** 3} GiB RAM
            </p>
          </figcaption>
          <div className="grid w-full grid-cols-2 gap-2 sm:w-auto">
            <label className="grid min-w-0 gap-1.5 text-xs">
              <span className="text-muted-foreground">Measurement</span>
              <ChartSelect
                value={metricIndex}
                onChange={(event) => setMetricIndex(Number(event.target.value))}
              >
                {suite.metrics.map(({ label }, index) => (
                  <option key={label} value={index}>
                    {label}
                  </option>
                ))}
              </ChartSelect>
            </label>
            <label className="grid min-w-0 gap-1.5 text-xs">
              <span className="text-muted-foreground">Fixture</span>
              <ChartSelect
                value={fixture}
                onChange={(event) => setFixture(event.target.value)}
              >
                {metric.rows.map((row) => (
                  <option key={row.fixture} value={row.fixture}>
                    {row.fixture}
                  </option>
                ))}
              </ChartSelect>
            </label>
          </div>
        </div>
        <p
          id="words-package-caption"
          className="text-muted-foreground mb-5 text-sm"
        >
          <strong>{fixture}</strong> · {metric.description}
        </p>
        <dl
          aria-labelledby="words-package-caption"
          aria-live="polite"
          className="space-y-5 tabular-nums sm:space-y-6"
        >
          {results.map(({ engine, value, version }) => {
            const words = engine.startsWith('Words');
            return (
              <div
                key={engine}
                className="grid grid-cols-[minmax(0,1fr)_8rem] items-center gap-x-3 gap-y-1.5 sm:grid-cols-[minmax(0,1fr)_10rem]"
              >
                <dt className="text-muted-foreground col-start-1 row-start-2 flex min-w-0 flex-wrap items-baseline gap-x-1 text-xs leading-tight">
                  <span className="text-foreground text-sm font-medium">
                    {engine}
                  </span>
                  {version}
                </dt>
                <dd className="contents">
                  <div className="col-start-1 row-start-1">
                    <BenchmarkBar
                      value={value}
                      maximum={maximum}
                      highlighted={words}
                      scaleFloor={6}
                    />
                  </div>
                  <span
                    className={`col-start-2 row-span-2 row-start-1 self-center text-right text-2xl whitespace-nowrap sm:text-3xl ${words ? 'font-semibold' : 'text-foreground/50 font-normal'}`}
                  >
                    {value.toFixed(metric.decimals)}
                    <span className="text-muted-foreground ml-1 text-sm font-normal">
                      {metric.unit}
                    </span>
                  </span>
                </dd>
              </div>
            );
          })}
        </dl>
      </figure>

      <h3 className="text-xl font-semibold tracking-tight">
        Browser measurements
      </h3>
      <div className="grid min-w-0 gap-4 lg:grid-cols-3">
        <figure className={cardClass} aria-labelledby="words-update-chart">
          <figcaption className="mb-5 space-y-1.5">
            <h3
              id="words-update-chart"
              className="text-xl font-semibold tracking-tight"
            >
              Streaming updates
            </h3>
            <p className="text-muted-foreground text-sm">
              Source update latency, p95. Recorded {measuredDate}. Shorter is
              better.
            </p>
          </figcaption>
          <div className="mb-6 grid grid-cols-2 gap-2">
            <label className="grid min-w-0 gap-1.5 text-xs">
              <span className="text-muted-foreground">Document</span>
              <ChartSelect
                aria-label="Benchmark document size"
                value={scale}
                onChange={(event) => setScale(Number(event.target.value))}
              >
                <option value={1}>8.5 KB · 1×</option>
                <option value={100}>853 KB · 100×</option>
              </ChartSelect>
            </label>
            <label className="grid min-w-0 gap-1.5 text-xs">
              <span className="text-muted-foreground">Rendering</span>
              <ChartSelect
                aria-label="Benchmark rendering mode"
                value={mode}
                onChange={(event) => setMode(event.target.value)}
              >
                {modes.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </ChartSelect>
            </label>
          </div>
          <div aria-live="polite" aria-atomic="true">
            <Comparison
              words={browser.words.updateP95Ms}
              streamdown={browser.streamdown.updateP95Ms}
              unit="ms"
            />
          </div>
          <p className="text-muted-foreground mt-6 border-t pt-4 text-xs leading-relaxed">
            Frame p95: {decimal.format(browser.words.frameP95Ms)} ms for Words,{' '}
            {decimal.format(browser.streamdown.frameP95Ms)} ms for Streamdown.
            Median of {browser.words.runs} runs, {browser.updates} updates each.
            Update latency excludes following paint.
          </p>
        </figure>

        <figure className={cardClass} aria-labelledby="words-memory-chart">
          <figcaption className="mb-5 space-y-1.5">
            <h3
              id="words-memory-chart"
              className="text-xl font-semibold tracking-tight"
            >
              Memory after streaming
            </h3>
            <p className="text-muted-foreground text-sm">
              Additional settled JS heap. Recorded {measuredDate}. Shorter is
              better.
            </p>
          </figcaption>
          <label className="mb-6 grid min-w-0 gap-1.5 text-xs">
            <span className="text-muted-foreground">
              853 KB document · 100×
            </span>
            <ChartSelect
              aria-label="Benchmark memory configuration"
              value={memoryMode}
              onChange={(event) => setMemoryMode(event.target.value)}
            >
              {modes.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </ChartSelect>
          </label>
          <div aria-live="polite" aria-atomic="true">
            <Comparison
              words={memory.words.heapBytes}
              streamdown={memory.streamdown.heapBytes}
              divisor={1e6}
              unit="MB"
            />
          </div>
          <p className="text-muted-foreground mt-6 border-t pt-4 text-xs leading-relaxed">
            Median of {memory.words.runs} runs. V8 heap after forced garbage
            collection, relative to a warmed empty renderer. Excludes native
            DOM, Wasm, and graphics memory.
          </p>
        </figure>

        <figure className={cardClass} aria-labelledby="words-footprint-chart">
          <figcaption className="mb-5 space-y-1.5">
            <h3
              id="words-footprint-chart"
              className="text-xl font-semibold tracking-tight"
            >
              Browser download
            </h3>
            <p className="text-muted-foreground text-sm">
              Compressed JavaScript. Shorter is better.
            </p>
          </figcaption>
          <label className="mb-6 grid min-w-0 gap-1.5 text-xs">
            <span className="text-muted-foreground">React renderer · gzip</span>
            <ChartSelect
              aria-label="Benchmark download configuration"
              value={footprintId}
              onChange={(event) => setFootprintId(event.target.value)}
            >
              <option value="base">Base renderer · initial load</option>
              <option value="shared">
                {coverage.sharedLanguages.length} shared languages · loaded
                total
              </option>
            </ChartSelect>
          </label>
          <div aria-live="polite" aria-atomic="true">
            <Comparison
              words={footprint.words}
              streamdown={footprint.streamdown}
              divisor={1000}
              unit="KB"
            />
          </div>
          <p className="text-muted-foreground mt-6 border-t pt-4 text-xs leading-relaxed">
            React is external. CSS is separate:{' '}
            {decimal.format(run.download.css.words / 1000)} KB for Words,{' '}
            {decimal.format(run.download.css.streamdown / 1000)} KB for
            Streamdown.
            {footprintId === 'shared' && (
              <>
                {' '}
                Both use GitHub light/dark and support the same{' '}
                {coverage.sharedLanguages.length} language requests. Words
                includes all {coverage.wordsLanguages.length} built-in
                languages. Streamdown loads languages on demand; this total
                includes the shared set and required embedded grammars.
              </>
            )}
          </p>
          <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
            Download measured {date.format(new Date(downloadRun.date))} at
            commit {downloadRun.commit.slice(0, 8)}
            {downloadRun.dirty ? ' with uncommitted changes' : ''} · Bun{' '}
            {downloadRun.bun}.
          </p>
        </figure>
      </div>

      <div className="text-muted-foreground max-w-4xl space-y-2 text-xs leading-relaxed">
        <p>
          Browser timings recorded {measuredDate} at commit{' '}
          {run.commit.slice(0, 8)}
          {run.dirty ? ' with uncommitted changes' : ''} · {run.cpu} ·{' '}
          {Math.round(run.memoryBytes / 1024 ** 3)} GiB RAM · Chromium{' '}
          {run.chrome} · React {run.versions.react} · Streamdown{' '}
          {run.versions.streamdown}.
        </p>
        <p>
          Both libraries use their native streaming paths. The repeated fixture
          includes identical TypeScript fences; unique code and other languages
          may behave differently. Small documents stay near the display frame
          interval for both renderers.{' '}
          <a
            href="/words/benchmark-raw.json"
            className="styled-link"
            target="_blank"
            rel="noopener noreferrer"
          >
            Raw browser results
          </a>
          {' · '}
          <a href="/words/benchmark.json" className="styled-link">
            Chart data
          </a>
          {' · '}
          <a href={methodologyUrl} className="styled-link">
            Benchmark source
          </a>
        </p>
      </div>

      <details
        id="words-benchmark-method"
        open={methodOpen}
        onToggle={(event) => setMethodOpen(event.currentTarget.open)}
        className="scroll-mt-20 rounded-lg border px-5 py-4 sm:px-7"
      >
        <summary className="cursor-pointer text-sm font-medium">
          How we measure
        </summary>
        <div className="mt-5 grid min-w-0 gap-8 text-sm md:grid-cols-2">
          <div className="min-w-0 space-y-3">
            <h3 className="font-medium">From a fresh checkout</h3>
            <p className="text-muted-foreground leading-relaxed">
              Install the repository’s pinned toolchain and dependencies, then
              run these commands from its root. They measure HTML throughput,
              React stream replays in JSDOM, process memory, and the browser
              charts above.
            </p>
            <pre className="bg-muted/50 overflow-x-auto rounded-md p-4 text-xs leading-6">
              <code>{`moonx words:bench --ignore-ci-checks\nmoonx words:bench-stream --ignore-ci-checks\nmoonx words:bench-memory --ignore-ci-checks\nmoonx words:bench-browser --ignore-ci-checks`}</code>
            </pre>
            <a href={methodologyUrl} className="styled-link inline-block">
              Setup, methodology, and output files ↗
            </a>
          </div>
          <div className="space-y-3">
            <h3 className="font-medium">What these charts cover</h3>
            <p className="text-muted-foreground leading-relaxed">
              Timing uses {browser.updates} commit-paced deliveries, waiting{' '}
              {run.settings.intervalMs} ms after each commit, in a{' '}
              {run.settings.viewport.width} × {run.settings.viewport.height}{' '}
              viewport without auto-scrolling. Code controls and line numbers
              are disabled. Each value is the median of {run.settings.runs}{' '}
              fresh-browser runs’ p95 update times. Startup and first grammar
              loading are warmed before measurement. Heap is sampled in the same
              runs, before and after playback.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              The 8.53 MB capacity diagnostic still stutters in both libraries.
              These single runs are excluded from the charts above. Playback
              stops after {run.settings.stressTimeoutMs / 1000} seconds.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs tabular-nums">
                <caption className="text-muted-foreground mb-2 text-left">
                  Frame p95 · 8.53 MB · single diagnostic runs
                </caption>
                <thead>
                  <tr className="border-b">
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Rendering
                    </th>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Words
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      Streamdown
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {run.stress.map((row) => (
                    <tr key={row.mode} className="border-b">
                      <th scope="row" className="py-2 pr-3 font-normal">
                        {row.mode === 'animated'
                          ? 'Highlighting + fades'
                          : 'Highlighting'}
                      </th>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {capacityFrame(row.words)}
                      </td>
                      <td className="py-2 whitespace-nowrap">
                        {capacityFrame(row.streamdown)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-muted-foreground leading-relaxed">
              Fade behavior differs: Words animates delivered text chunks,
              including code; Streamdown animates prose words. Parser-only
              speed, browser update latency, and complete replay duration are
              separate measurements.
            </p>
          </div>
        </div>
      </details>
    </section>
  );
}

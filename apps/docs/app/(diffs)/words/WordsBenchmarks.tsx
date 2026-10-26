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

// Reserve space for an inset chevron while keeping the native picker and keyboard behavior.
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

// Every comparison shares a zero-based linear scale and keeps the values in text.
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

// Incomplete capacity runs have no comparable percentile to display.
function capacityFrame(sample: {
  status: string;
  frameP95Milliseconds?: number;
}) {
  return sample.status === 'completed' &&
    sample.frameP95Milliseconds !== undefined
    ? `${decimal.format(sample.frameP95Milliseconds)} ms`
    : 'Timed out';
}

export function WordsBenchmarks() {
  const [scale, setScale] = useState(100);
  const [mode, setMode] = useState('highlight');
  const [memoryMode, setMemoryMode] = useState('highlight');
  const [footprintId, setFootprintId] = useState('base');
  const [methodOpen, setMethodOpen] = useState(false);
  const browser = benchmark.browser.rows.find(
    (row) => row.scale === scale && row.mode === mode
  )!;
  const memory = benchmark.memory.rows.find((row) => row.mode === memoryMode)!;
  const footprint = benchmark.footprint.rows.find(
    (row) => row.id === footprintId
  )!;
  const measuredDate = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(benchmark.provenance.measuredAt));
  const chromeVersion = /(?:Headless)?Chrome\/(\d+)/.exec(
    benchmark.environment.browserUserAgent
  )?.[1];
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
            Streaming, memory, and download size.
          </h2>
          <p className="text-muted-foreground text-pretty">
            Words and Streamdown on the same Markdown. Production browser
            builds, native incremental rendering, and results you can inspect
            and reproduce.
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
              Source update latency, p95. Shorter is better.
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
              words={browser.words.updateP95Milliseconds}
              streamdown={browser.streamdown.updateP95Milliseconds}
              unit="ms"
            />
          </div>
          <p className="text-muted-foreground mt-6 border-t pt-4 text-xs leading-relaxed">
            Frame p95: {decimal.format(browser.words.frameP95Milliseconds)} ms
            for Words, {decimal.format(browser.streamdown.frameP95Milliseconds)}{' '}
            ms for Streamdown. Median of {browser.words.runs} runs,{' '}
            {browser.updates} updates each. Update latency excludes following
            paint.
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
              Additional settled JS heap. Shorter is better.
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
              <option value="highlight">Syntax highlighting</option>
              <option value="animated">Highlighting + fades</option>
            </ChartSelect>
          </label>
          <div aria-live="polite" aria-atomic="true">
            <Comparison
              words={memory.words.additionalHeapBytes}
              streamdown={memory.streamdown.additionalHeapBytes}
              divisor={1e6}
              unit="MB"
            />
          </div>
          <p className="text-muted-foreground mt-6 border-t pt-4 text-xs leading-relaxed">
            Median of {memory.words.runs} separate samples after explicit
            garbage collection, relative to a warmed empty renderer. Excludes
            native DOM, Wasm, and graphics memory.
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
              <option value="highlight">
                TypeScript + two themes · loaded total
              </option>
            </ChartSelect>
          </label>
          <div aria-live="polite" aria-atomic="true">
            <Comparison
              words={footprint.wordsGzipBytes}
              streamdown={footprint.streamdownGzipBytes}
              divisor={1000}
              unit="KB"
            />
          </div>
          <p className="text-muted-foreground mt-6 border-t pt-4 text-xs leading-relaxed">
            React is external. CSS is separate:{' '}
            {decimal.format(benchmark.footprint.css.wordsGzipBytes / 1000)} KB
            for Words,{' '}
            {decimal.format(benchmark.footprint.css.streamdownGzipBytes / 1000)}{' '}
            KB for Streamdown. Grammar and theme coverage differ.
          </p>
        </figure>
      </div>

      <div className="text-muted-foreground max-w-4xl space-y-2 text-xs leading-relaxed">
        <p>
          Recorded {measuredDate} · {benchmark.environment.cpu} ·{' '}
          {Math.round(benchmark.environment.totalMemoryBytes / 1024 ** 3)} GiB
          RAM · Chrome {chromeVersion} · React{' '}
          {benchmark.environment.dependencies.react} · Streamdown{' '}
          {benchmark.environment.dependencies.streamdown}. Measurements use an
          unpublished workspace build
          {benchmark.provenance.uncommittedWorkingTree
            ? ' with uncommitted changes'
            : ''}
          ; the raw results identify the commit and built files.
        </p>
        <p>
          Both libraries use their native streaming paths. The repeated fixture
          includes identical TypeScript fences; unique code and other languages
          may behave differently. Small documents remain near a 60 Hz frame
          interval for both renderers.{' '}
          <a
            href="/words/benchmark-raw.json"
            className="styled-link"
            target="_blank"
            rel="noopener noreferrer"
          >
            Raw results
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
          Run the benchmarks. See the tradeoffs.
        </summary>
        <div className="mt-5 grid min-w-0 gap-8 text-sm md:grid-cols-2">
          <div className="min-w-0 space-y-3">
            <h3 className="font-medium">From a fresh checkout</h3>
            <p className="text-muted-foreground leading-relaxed">
              Install the repository’s pinned toolchain and dependencies, then
              run these commands from its root. Setup installs the isolated
              comparison tools and browser. Quick verifies the pipeline; full
              records repeated timings, memory, and transfer sizes.
            </p>
            <pre className="bg-muted/50 overflow-x-auto rounded-md p-4 text-xs leading-6">
              <code>{`moon run words:bench-setup\nmoon run words:bench-quick\nmoon run words:bench-full`}</code>
            </pre>
            <a href={methodologyUrl} className="styled-link inline-block">
              Setup, methodology, and output files ↗
            </a>
          </div>
          <div className="space-y-3">
            <h3 className="font-medium">What these charts cover</h3>
            <p className="text-muted-foreground leading-relaxed">
              Timing uses {browser.updates} commit-paced deliveries, waiting{' '}
              {benchmark.browser.metadata.requestedIntervalMs} ms after each
              commit, in a {benchmark.browser.metadata.viewport.width} ×{' '}
              {benchmark.browser.metadata.viewport.height} viewport without
              auto-scrolling. Code controls and line numbers are disabled. Each
              value is the median of three runs’ p95 update times. Startup and
              first grammar loading are warmed before measurement. Memory is
              measured separately.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              The 8.53 MB capacity diagnostic still stutters in both libraries.
              These single runs are excluded from the charts above. Playback
              stops after {benchmark.stress.metadata.timeout / 1000} seconds.
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
                  {benchmark.stress.rows.map((row) => (
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

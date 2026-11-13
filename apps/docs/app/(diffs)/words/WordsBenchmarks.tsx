'use client';

import { IconChevronSm } from '@pierre/icons';
import { type ComponentProps, useState } from 'react';

import { BenchmarkBar } from '../highlights/BenchmarkBar';
import cardStyles from '../highlights/HighlightsBenchmarkCard.module.css';
import { WordsDisclosure } from './WordsDisclosure';
import benchmark from '@/public/words/benchmark.json';

const methodologyUrl =
  'https://github.com/pierrecomputer/pierre/tree/main/packages/words/benchmark';

const modes = [
  { id: 'plain', label: 'Plain Markdown' },
  { id: 'highlight', label: 'Syntax highlighting' },
  { id: 'animated', label: 'Highlighting + fades' },
] as const;

const documents: Record<string, { label: string; description: string }> = {
  'tiny.md': {
    label: 'Markdown showcase · 1.3 KiB',
    description: 'A short document with lists, links, a table, and code.',
  },
  'assistant-review.md': {
    label: 'AI code review · 5.4 KiB',
    description:
      'A code review response with suggested diffs and TypeScript examples.',
  },
  'assistant-explain.md': {
    label: 'AI explanation · 6.0 KiB',
    description: 'A technical explanation with a TypeScript implementation.',
  },
  'simd.md': {
    label: 'Technical specification · 39.0 KiB',
    description:
      'The WebAssembly SIMD specification, with detailed instructions and code.',
  },
  'gfm-spec.md': {
    label: 'GitHub Markdown specification · 211.3 KiB',
    description:
      'The full GitHub Flavored Markdown specification and its examples.',
  },
};

const measurements = [
  'How much Markdown becomes HTML per second. Higher is better.',
  'Time to replay the full document through React in JSDOM. Lower is better.',
  'Peak process memory added by loading the parser and rendering HTML. Lower is better.',
  'Peak process memory added by loading React and JSDOM and replaying the stream. Lower is better.',
];

const decimal = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

function ChartSelect({ children, ...props }: ComponentProps<'select'>) {
  return (
    <span className="relative block min-w-0">
      <select
        {...props}
        className="text-foreground h-9 w-full min-w-0 cursor-pointer appearance-none truncate rounded-md border border-[var(--border)] bg-[var(--background)] py-2 pr-9 pl-3 text-sm leading-4 outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
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
          <dt className="text-md font-medium">{name}</dt>
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

export function WordsBenchmarks() {
  const [metricIndex, setMetricIndex] = useState(0);
  const [scale, setScale] = useState(100);
  const [mode, setMode] = useState('highlight');
  const [memoryMode, setMemoryMode] = useState('highlight');
  const [footprintId, setFootprintId] = useState('shared');
  const [methodOpen, setMethodOpen] = useState(false);
  const [fixture, setFixture] = useState('assistant-review.md');
  const suite = benchmark.packageRun;
  const metric = suite.metrics[metricIndex];
  // Best result first, like the highlights chart.
  const results = metric.engines
    .map((engine, index) => ({
      engine,
      value: metric.rows.find((row) => row.fixture === fixture)!.values[index],
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
  const cardClass = `${cardStyles.card} dark text-foreground flex min-w-0 flex-col rounded-lg p-4 sm:p-8 lg:p-10`;

  return (
    <section
      id="benchmarks"
      aria-labelledby="words-benchmarks"
      className="scroll-mt-20 space-y-6 pb-16 md:pb-24"
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div className="max-w-2xl">
            <h2
              id="words-benchmarks"
              className="text-2xl font-semibold tracking-tight"
            >
              Markdown rendering benchmarks
            </h2>
            <p className="text-muted-foreground text-pretty">
              From everyday AI replies to full specifications, compare rendering
              speed, streaming work, memory use, and download size.
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
        <div className="grid w-full max-w-3xl grid-cols-1 gap-3 sm:grid-cols-2">
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
            <span className="text-muted-foreground">Document</span>
            <ChartSelect
              value={fixture}
              onChange={(event) => setFixture(event.target.value)}
            >
              {metric.rows.map((row) => (
                <option key={row.fixture} value={row.fixture}>
                  {documents[row.fixture].label}
                </option>
              ))}
            </ChartSelect>
          </label>
        </div>
      </div>

      <figure className={cardClass} aria-labelledby="words-package-chart">
        <figcaption className="mb-6 max-w-2xl">
          <h3
            id="words-package-chart"
            className="text-xl font-semibold tracking-tight"
          >
            Markdown to HTML and React
          </h3>
          <p className="text-muted-foreground text-pretty">
            {measurements[metricIndex]}
          </p>
        </figcaption>
        <p
          id="words-package-caption"
          className="text-muted-foreground mb-5 text-sm"
        >
          <strong className="text-foreground">
            {documents[fixture].label}
          </strong>
          {' · '}
          {documents[fixture].description}
        </p>
        <dl
          aria-labelledby="words-package-caption"
          aria-live="polite"
          className="space-y-5 tabular-nums sm:space-y-6"
        >
          {results.map(({ engine, value }) => {
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
                    className={`col-start-2 row-span-2 row-start-1 mt-[-16px] self-center text-right text-2xl whitespace-nowrap sm:text-3xl ${words ? 'font-semibold' : 'text-foreground/50 font-normal'}`}
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

      <div className="max-w-2xl">
        <h3 className="text-xl font-semibold tracking-tight">
          Streaming in the browser
        </h3>
        <p className="text-muted-foreground max-w-2xl text-pretty">
          A long response with paragraphs and TypeScript code, tested on its own
          and repeated 100 times to show how each renderer scales.
        </p>
      </div>
      <div className="grid min-w-0 gap-8 lg:grid-cols-3">
        <figure className={cardClass} aria-labelledby="words-update-chart">
          <figcaption className="mb-6 max-w-2xl">
            <h3
              id="words-update-chart"
              className="text-xl font-semibold tracking-tight"
            >
              Streaming updates
            </h3>
            <p className="text-muted-foreground text-pretty">
              Time for incoming text to reach the DOM, before paint. 95% of
              updates finish within this time. Lower is better.
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
                <option value={1}>Long response · 8.5 KB</option>
                <option value={100}>Repeated response · 853 KB</option>
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
        </figure>

        <figure className={cardClass} aria-labelledby="words-memory-chart">
          <figcaption className="mb-6 max-w-2xl">
            <h3
              id="words-memory-chart"
              className="text-xl font-semibold tracking-tight"
            >
              Memory after streaming
            </h3>
            <p className="text-muted-foreground text-pretty">
              JavaScript memory kept after the full document has rendered. Lower
              is better.
            </p>
          </figcaption>
          <label className="mb-6 grid min-w-0 gap-1.5 text-xs">
            <span className="text-muted-foreground">
              Repeated response · 853 KB
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
        </figure>

        <figure className={cardClass} aria-labelledby="words-footprint-chart">
          <figcaption className="mb-6 max-w-2xl">
            <h3
              id="words-footprint-chart"
              className="text-xl font-semibold tracking-tight"
            >
              Browser download
            </h3>
            <p className="text-muted-foreground text-pretty">
              JavaScript transferred to load the renderer and selected
              languages, compressed with gzip. Lower is better.
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
                With {coverage.sharedLanguages.length} languages · total
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
        </figure>
      </div>

      <WordsDisclosure
        id="words-benchmark-method"
        open={methodOpen}
        onToggle={(event) => setMethodOpen(event.currentTarget.open)}
        className="scroll-mt-20 rounded-lg border px-5 py-4 sm:px-7"
        summary="How we measure"
        summaryClassName="text-sm font-medium"
      >
        <div className="text-muted-foreground mt-5 grid min-w-0 gap-6 text-sm leading-relaxed md:grid-cols-2">
          <div className="space-y-3">
            <h3 className="text-foreground font-medium">
              HTML and React benchmarks
            </h3>
            <p>
              Five documents cover short Markdown, AI responses, and technical
              specifications. HTML throughput measures input MiB per second.
              React replays deliver chunks of up to 256 UTF-16 code units in
              JSDOM, without highlighting or animations. This measures parsing
              and DOM work; it does not include browser layout or paint. Memory
              is median peak process growth through import and rendering,
              measured in five fresh processes per engine and document.
            </p>
            <p>
              {date.format(new Date(suite.environment.date))} · Node{' '}
              {suite.environment.node} · {suite.environment.cpu} ·{' '}
              {suite.environment.memoryBytes / 1024 ** 3} GiB RAM · commit{' '}
              {suite.head.slice(0, 8)}. md4x {suite.environment.versions.md4x},
              markdown-it {suite.environment.versions['markdown-it']}, React{' '}
              {suite.environment.versions.react}, Streamdown{' '}
              {suite.environment.versions.streamdown}, JSDOM{' '}
              {suite.environment.versions.jsdom}.
            </p>
          </div>
          <div className="space-y-3">
            <h3 className="text-foreground font-medium">
              Browser streaming and memory
            </h3>
            <p>
              The 8.5 KB document has 100 paragraphs and a 40-line TypeScript
              block; the 853 KB document repeats it 100 times. Both libraries
              use their native streaming paths, with {browser.updates} updates
              spaced {run.settings.intervalMs} ms after each commit. Results are
              the median of {run.settings.runs} fresh-browser runs, after
              warming startup and grammar loading, in a{' '}
              {run.settings.viewport.width} × {run.settings.viewport.height}{' '}
              viewport. Auto-scrolling, code controls, and line numbers are off.
            </p>
            <p>
              Memory is settled V8 heap growth after forced garbage collection;
              it excludes native DOM, Wasm, and graphics memory. Repeated code
              blocks are identical; unique code and other languages may differ.
              Small documents stay near the display frame interval for both
              renderers. Words fades delivered chunks, including code;
              Streamdown fades prose words. Single 8.53 MB diagnostic runs
              stutter in both libraries and are excluded from the charts.
            </p>
            <p>
              {measuredDate} · {run.cpu} ·{' '}
              {Math.round(run.memoryBytes / 1024 ** 3)} GiB RAM · Chromium{' '}
              {run.chrome} · Bun {run.bun} · React {run.versions.react} ·
              Streamdown {run.versions.streamdown} · commit{' '}
              {run.commit.slice(0, 8)}
              {run.dirty ? ' with uncommitted changes' : ''}.
            </p>
          </div>
          <div className="space-y-3">
            <h3 className="text-foreground font-medium">Browser download</h3>
            <p>
              Minified JavaScript, gzipped per file, with React external. The
              base renderer counts initial static imports; the language total
              counts every chunk loaded for the same{' '}
              {coverage.sharedLanguages.length} languages and GitHub light/dark
              themes. Words includes all {coverage.wordsLanguages.length}{' '}
              built-in languages. Streamdown loads languages on demand,
              including required embedded grammars. Streamdown downloads less
              than this total on pages that use fewer languages. CSS is
              separate: {decimal.format(run.download.css.words / 1000)} KB for
              Words and {decimal.format(run.download.css.streamdown / 1000)} KB
              for Streamdown.
            </p>
            <p>
              {date.format(new Date(downloadRun.date))} · Bun {downloadRun.bun}{' '}
              · commit {downloadRun.commit.slice(0, 8)}
              {downloadRun.dirty ? ' with uncommitted changes' : ''}.
            </p>
          </div>
          <div className="space-y-3">
            <h3 className="text-foreground font-medium">
              Explore or reproduce the results
            </h3>
            <p>
              The benchmark source includes setup instructions, commands, and
              the Markdown documents used here. Raw results include frame
              timings and the larger capacity diagnostics.
            </p>
            <ul className="space-y-2">
              <li>
                <a href={methodologyUrl} className="styled-link">
                  Benchmark source and methodology ↗
                </a>
              </li>
              <li>
                <a
                  href="/words/benchmark-raw.json"
                  className="styled-link"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Raw browser results ↗
                </a>
              </li>
              <li>
                <a href="/words/benchmark.json" className="styled-link">
                  Chart data ↗
                </a>
              </li>
            </ul>
          </div>
        </div>
      </WordsDisclosure>
    </section>
  );
}

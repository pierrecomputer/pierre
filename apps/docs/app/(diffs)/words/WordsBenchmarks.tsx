'use client';

import { IconArrow, IconCheck, IconChevronSm } from '@pierre/icons';
import { type ReactNode, useState } from 'react';

import { BenchmarkBar } from '../highlights/BenchmarkBar';
import cardStyles from '../highlights/HighlightsBenchmarkCard.module.css';
import { WordsDisclosure } from './WordsDisclosure';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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

const cardClass = `${cardStyles.card} dark text-foreground flex min-w-0 flex-col rounded-lg p-4 sm:p-8 lg:p-10`;
const browserCardClass = `${cardClass} lg:row-span-4 lg:grid lg:grid-rows-subgrid`;

const decimal = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

function ChartMenu({
  label,
  value,
  options,
  onValueChange,
  labelInside = false,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string; description?: string }[];
  onValueChange: (value: string) => void;
  labelInside?: boolean;
}) {
  const selectedLabel =
    options.find((option) => option.value === value)?.label ?? value;
  const hasDescriptions = options.some((option) => option.description != null);

  return (
    <div className={labelInside ? 'min-w-0' : 'grid min-w-0 gap-1.5 text-sm'}>
      {!labelInside && <span className="text-muted-foreground">{label}</span>}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="dark group w-fit max-w-full min-w-0 justify-start border-neutral-800 bg-neutral-950 px-3 font-normal text-neutral-50 hover:bg-neutral-900 hover:text-neutral-50"
            aria-label={`${label}: ${selectedLabel}`}
          >
            {labelInside && (
              <span className="text-muted-foreground">{label}:</span>
            )}
            <span className="truncate">{selectedLabel}</span>
            <IconChevronSm className="text-muted-foreground ml-auto shrink-0 transition-transform group-data-[state=open]:rotate-180" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className={`dark min-w-[var(--radix-dropdown-menu-trigger-width)] border-neutral-800 bg-neutral-950 text-neutral-50 ${
            hasDescriptions ? 'w-80 max-w-[calc(100vw-2rem)]' : ''
          }`}
          scrollSelectedIntoView
        >
          {options.map((option) => (
            <DropdownMenuItem
              key={option.value}
              selected={option.value === value}
              className="items-start focus:bg-neutral-800 focus:text-neutral-50 data-[selected=true]:bg-neutral-800 data-[selected=true]:text-neutral-50"
              onSelect={() => onValueChange(option.value)}
            >
              <span className="min-w-0">
                <span className="block">{option.label}</span>
                {option.description != null && (
                  <span className="mt-0.5 block text-xs leading-snug text-pretty text-neutral-400">
                    {option.description}
                  </span>
                )}
              </span>
              <IconCheck
                className={
                  option.value === value
                    ? 'mt-0.5 ml-auto'
                    : 'invisible mt-0.5 ml-auto'
                }
                aria-hidden="true"
              />
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
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
    <dl className="space-y-5 tabular-nums sm:space-y-6">
      {[
        { name: 'Words', value: words },
        { name: 'Streamdown', value: streamdown },
      ].map(({ name, value }) => (
        <div
          key={name}
          className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-x-3 gap-y-1.5"
        >
          <dt className="text-muted-foreground col-start-1 row-start-2 flex min-w-0 flex-wrap items-baseline gap-x-1 text-xs leading-tight">
            <span className="text-foreground text-sm font-medium">{name}</span>
          </dt>
          <dd className="contents">
            <div className="col-start-1 row-start-1">
              <BenchmarkBar
                value={value}
                maximum={maximum}
                highlighted={name === 'Words'}
                scaleFloor={6}
              />
            </div>
            <span
              className={`col-start-2 row-span-2 row-start-1 mt-[-16px] self-center text-right text-3xl whitespace-nowrap ${
                name === 'Words'
                  ? 'font-semibold'
                  : 'text-foreground/50 font-normal'
              }`}
            >
              {decimal.format(value / divisor)}
              <span className="text-muted-foreground ml-1 text-sm font-normal">
                {unit}
              </span>
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

// Keeps each browser benchmark on the shared caption, controls, and graph rows.
function BrowserBenchmarkCard({
  id,
  title,
  description,
  controls,
  controlsClassName = '',
  words,
  streamdown,
  unit,
  divisor,
}: {
  id: string;
  title: string;
  description: string;
  controls: ReactNode;
  controlsClassName?: string;
  words: number;
  streamdown: number;
  unit: string;
  divisor?: number;
}) {
  return (
    <figure className={browserCardClass} aria-labelledby={id}>
      <figcaption className="mb-6 max-w-2xl">
        <h3 id={id} className="text-xl font-semibold tracking-tight">
          {title}
        </h3>
        <p className="text-muted-foreground text-sm text-pretty">
          {description}
        </p>
      </figcaption>
      <hr className="mb-7 border-neutral-800" />
      <div className={`mb-6 ${controlsClassName}`}>{controls}</div>
      <div aria-live="polite" aria-atomic="true">
        <Comparison
          words={words}
          streamdown={streamdown}
          unit={unit}
          divisor={divisor}
        />
      </div>
    </figure>
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

  return (
    <section
      id="benchmarks"
      aria-labelledby="words-benchmarks"
      className="scroll-mt-20 space-y-6 pb-16 md:pb-24"
    >
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="max-w-2xl">
          <h2
            id="words-benchmarks"
            className="text-2xl font-semibold tracking-tight"
          >
            Markdown rendering benchmarks
          </h2>
          <p className="text-muted-foreground text-sm text-pretty">
            From everyday AI replies to full specifications, compare rendering
            speed, streaming work, memory use, and download size from Markdown
            to HTML and React.
          </p>
        </div>
        <a
          href="#words-benchmark-method"
          className="styled-link inline-flex items-center gap-1 text-sm"
          onClick={() => setMethodOpen(true)}
        >
          How we measure
          <IconArrow
            aria-hidden="true"
            className="text-muted-foreground size-4 rotate-90"
          />
        </a>
      </div>

      <figure
        className={cardClass}
        aria-label="Markdown to HTML and React benchmarks"
      >
        <div className="mb-6 flex flex-wrap items-end gap-2">
          <ChartMenu
            label="Measures"
            value={String(metricIndex)}
            options={suite.metrics.map(({ label }, index) => ({
              value: String(index),
              label,
              description: measurements[index],
            }))}
            onValueChange={(value) => setMetricIndex(Number(value))}
          />
          <ChartMenu
            label="Document"
            value={fixture}
            options={metric.rows.map((row) => ({
              value: row.fixture,
              label: documents[row.fixture].label,
            }))}
            onValueChange={setFixture}
          />
        </div>
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
      <div className="grid min-w-0 gap-8 lg:grid-cols-3 lg:gap-y-0">
        <BrowserBenchmarkCard
          id="words-update-chart"
          title="Streaming updates"
          description="Time for incoming text to reach the DOM, before paint. 95% of updates finish within this time. Lower is better."
          controlsClassName="grid grid-cols-2 gap-2"
          words={browser.words.updateP95Ms}
          streamdown={browser.streamdown.updateP95Ms}
          unit="ms"
          controls={
            <>
              <ChartMenu
                label="Document"
                value={String(scale)}
                options={[
                  { value: '1', label: 'Long response · 8.5 KB' },
                  { value: '100', label: 'Repeated response · 853 KB' },
                ]}
                onValueChange={(value) => setScale(Number(value))}
              />
              <ChartMenu
                label="Rendering"
                value={mode}
                options={modes.map((option) => ({
                  value: option.id,
                  label: option.label,
                }))}
                onValueChange={setMode}
              />
            </>
          }
        />

        <BrowserBenchmarkCard
          id="words-memory-chart"
          title="Memory after streaming"
          description="JavaScript memory kept after the full document has rendered. Lower is better."
          words={memory.words.heapBytes}
          streamdown={memory.streamdown.heapBytes}
          divisor={1e6}
          unit="MB"
          controls={
            <ChartMenu
              label="Repeated response · 853 KB"
              value={memoryMode}
              options={modes.map((option) => ({
                value: option.id,
                label: option.label,
              }))}
              onValueChange={setMemoryMode}
            />
          }
        />

        <BrowserBenchmarkCard
          id="words-footprint-chart"
          title="Browser download"
          description="JavaScript transferred to load the renderer and selected languages, compressed with gzip. Lower is better."
          words={footprint.words}
          streamdown={footprint.streamdown}
          divisor={1000}
          unit="KB"
          controls={
            <ChartMenu
              label="React renderer · gzip"
              value={footprintId}
              options={[
                { value: 'base', label: 'Base renderer · initial load' },
                {
                  value: 'shared',
                  label: `With ${coverage.sharedLanguages.length} languages · total`,
                },
              ]}
              onValueChange={setFootprintId}
            />
          }
        />
      </div>

      <WordsDisclosure
        id="words-benchmark-method"
        open={methodOpen}
        onToggle={(event) => setMethodOpen(event.currentTarget.open)}
        className="scroll-mt-20 rounded-lg border px-5 py-4 sm:px-7"
        summary="How we measure"
        summaryClassName="text-sm font-medium"
        iconClassName="-ml-3"
      >
        <div className="text-muted-foreground mt-5 grid min-w-0 gap-6 p-2 text-sm leading-relaxed md:grid-cols-2">
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

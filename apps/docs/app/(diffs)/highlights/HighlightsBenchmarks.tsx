import Link from 'next/link';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

// Published string-I/O results from packages/highlights/benchmark/README.md,
// recorded September 18, 2026. Keep the reported ratios rather than deriving
// them from the table's independently rounded throughput values.
const largeFileResults = [
  {
    language: 'TypeScript',
    size: '517 KB',
    speedup: 279,
  },
  {
    language: 'HTML',
    size: '474 KB',
    speedup: 205,
  },
  {
    language: 'CSS',
    size: '379 KB',
    speedup: 230,
  },
  {
    language: 'JSONC',
    size: '292 KB',
    speedup: 153,
  },
];

const memoryResults = [
  { name: 'Highlights', peakRss: 49 },
  { name: 'Shiki JS', peakRss: 155 },
  { name: 'Shiki Wasm', peakRss: 346 },
];

const throughputMaximum = 300;
const memoryMaximum = 400;

// Renders different benchmark units against an explicit zero-based maximum.
function PerformanceBar({
  name,
  value,
  maximum,
  formatValue,
  highlights = false,
}: {
  name: ReactNode;
  value: number;
  maximum: number;
  formatValue: (value: number) => string;
  highlights?: boolean;
}) {
  const formattedValue = formatValue(value);

  return (
    <div className="text-md grid grid-cols-[minmax(0,1fr)_7.5rem] items-center gap-x-3 gap-y-1.5">
      <dt className="text-muted-foreground col-start-1 row-start-2">{name}</dt>
      <dd className="contents">
        <div
          aria-hidden="true"
          className={cn(
            'col-start-1 row-start-1 h-3 rounded-md transition-[width] duration-500 ease-out motion-reduce:transition-none',
            highlights
              ? 'bg-gradient-to-r from-cyan-500/80 to-blue-500/90 dark:from-cyan-400/80 dark:to-blue-400/90'
              : 'bg-foreground/50'
          )}
          style={{
            width: `${(value / maximum) * 100}%`,
          }}
        />
        <span
          className={cn(
            'col-start-2 row-span-2 row-start-1 mt-[-16px] w-full min-w-0 self-center whitespace-nowrap text-right text-2xl font-normal tabular-nums sm:text-3xl',
            highlights
              ? 'font-semibold text-blue-500 dark:text-blue-400'
              : 'text-foreground/50'
          )}
        >
          {formattedValue}
        </span>
      </dd>
    </div>
  );
}

export function HighlightsBenchmarks() {
  return (
    <section
      aria-labelledby="highlights-performance"
      className="space-y-6 pb-16 md:pb-24"
    >
      <div className="max-w-3xl">
        <h2
          id="highlights-performance"
          className="text-2xl font-semibold tracking-tight"
        >
          Fast output & lighter footprint
        </h2>
        <p className="text-muted-foreground text-pretty">
          Highlights generates HTML at hundreds of times Shiki’s throughput on
          large files, with substantially lower peak process memory.
        </p>
      </div>

      <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <figure
          aria-labelledby="highlights-language-performance"
          className="bg-muted/50 min-w-0 rounded-2xl p-5 sm:p-8 lg:p-10"
        >
          <figcaption className="mb-6 max-w-2xl">
            <h3
              id="highlights-language-performance"
              className="text-xl font-semibold tracking-tight"
            >
              Large-file HTML generation
            </h3>
            <p className="text-muted-foreground max-w-xl text-pretty">
              153–279× Shiki’s throughput across these fixtures. On the 517 KB
              TypeScript input, Tree-sitter reaches ≈8× Shiki.
            </p>
          </figcaption>
          <div className="space-y-5">
            {largeFileResults.map(({ language, size, speedup }) => (
              <dl key={language}>
                <PerformanceBar
                  name={
                    <span className="flex items-baseline gap-2 text-sm">
                      <span className="text-foreground font-medium">
                        {language}
                      </span>
                      <span>{size}</span>
                    </span>
                  }
                  value={speedup}
                  maximum={throughputMaximum}
                  formatValue={(value) => `${value}×`}
                  highlights
                />
              </dl>
            ))}
          </div>
        </figure>

        <figure
          aria-labelledby="highlights-memory-performance"
          className="bg-muted/50 min-w-0 rounded-2xl p-5 sm:p-8 lg:p-10"
        >
          <figcaption className="mb-8 max-w-3xl">
            <h3
              id="highlights-memory-performance"
              className="text-xl font-semibold tracking-tight"
            >
              Peak process memory
            </h3>
            <p className="text-muted-foreground max-w-xl text-pretty">
              Median peak process RSS while generating HTML from the 517 KB
              TypeScript fixture, shown on a shared 0–400 MB scale. Lower is
              better.
            </p>
          </figcaption>
          <dl className="space-y-6">
            {memoryResults.map(({ name, peakRss }) => (
              <PerformanceBar
                key={name}
                name={name}
                value={peakRss}
                maximum={memoryMaximum}
                formatValue={(value) => `${value} MB`}
                highlights={name === 'Highlights'}
              />
            ))}
          </dl>
        </figure>
      </div>

      <div className="grid min-w-0 gap-8 lg:grid-cols-3">
        <article className="bg-muted/50 min-w-0 rounded-2xl p-5 sm:p-8 lg:p-10">
          <h3 className="font-semibold">Complete themed tokens</h3>
          <p className="text-muted-foreground mt-2 text-sm text-pretty">
            Complete themed token generation reaches{' '}
            <strong className="text-foreground font-semibold tabular-nums">
              199 MB/s · 168× Shiki’s throughput
            </strong>{' '}
            on the 517 KB TypeScript fixture.
          </p>
        </article>
        <article className="bg-muted/50 min-w-0 rounded-2xl p-5 sm:p-8 lg:p-10">
          <h3 className="font-semibold">Streaming themed tokens</h3>
          <p className="text-muted-foreground mt-2 text-sm text-pretty">
            Streaming themed token generation reaches{' '}
            <strong className="text-foreground font-semibold tabular-nums">
              171 MB/s · 147× Shiki’s throughput
            </strong>{' '}
            on a large TypeScript fixture.
          </p>
        </article>
        <article className="bg-muted/50 min-w-0 rounded-2xl p-5 sm:p-8 lg:p-10">
          <h3 className="font-semibold">Live edits</h3>
          <p className="text-muted-foreground mt-2 text-sm text-pretty">
            For single-character edits and line insertion or deletion on the 517
            KB TypeScript fixture, the median synchronous response is{' '}
            <strong className="text-foreground font-semibold tabular-nums">
              under 1.4 µs
            </strong>
            , excluding deferred tokenization.
          </p>
        </article>
      </div>

      <div className="text-muted-foreground max-w-4xl space-y-2 text-xs leading-relaxed">
        <p>
          Measured September 18, 2026 on an Apple M4 Pro (14 cores, 48 GiB RAM)
          using Bun 1.4.0, Shiki 4.4.1, and tree-sitter-highlight 1.1.2. Median
          throughput after warmup. Memory measured September 16, 2026 as median
          peak process RSS from five fresh processes per engine. RSS includes
          the runtime, compiled code, Wasm, and allocator capacity; it is not
          live heap or bundle size. Results vary by input and environment.{' '}
          <Link
            href="https://github.com/pierrecomputer/pierre/tree/main/packages/highlights/benchmark#html-generation"
            className="hover:text-foreground underline underline-offset-4"
            target="_blank"
            rel="noopener noreferrer"
          >
            Explore the benchmarks and methodology
          </Link>
          .
        </p>
        <p>
          Throughput is relative to Shiki’s 1× baseline; higher is better. Each
          chart uses its own shared zero-based linear scale.
        </p>
      </div>
    </section>
  );
}

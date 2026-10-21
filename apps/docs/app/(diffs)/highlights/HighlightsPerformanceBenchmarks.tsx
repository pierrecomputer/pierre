import Link from 'next/link';
import type { ReactNode } from 'react';

import { BenchmarkBar } from './BenchmarkBar';
import styles from './HighlightsBenchmarkCard.module.css';
import {
  HIGHLIGHTS_LARGE_FILE_MAXIMUM_SPEEDUP,
  HIGHLIGHTS_LARGE_FILE_RESULTS,
  HIGHLIGHTS_THROUGHPUT_MAXIMUM,
} from './performanceBenchmarkData';
import { cn } from '@/lib/utils';

const memoryResults = [
  { name: 'Highlights', peakRss: 50 },
  { name: 'Shiki JS', peakRss: 155 },
  { name: 'Shiki Wasm', peakRss: 349 },
];

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
    <div className="text-md grid grid-cols-[minmax(0,1fr)_5.75rem] items-center gap-x-1.5 gap-y-1.5 sm:grid-cols-[minmax(0,1fr)_7.5rem] sm:gap-x-3">
      <dt className="text-muted-foreground col-start-1 row-start-2">{name}</dt>
      <dd className="contents">
        <div className="col-start-1 row-start-1">
          <BenchmarkBar
            value={value}
            maximum={maximum}
            highlighted={highlights}
          />
        </div>
        <span
          className={cn(
            'col-start-2 row-span-2 row-start-1 mt-[-16px] w-full min-w-0 self-center whitespace-nowrap text-left text-2xl font-normal tabular-nums sm:text-right sm:text-3xl',
            highlights ? 'font-semibold' : 'text-foreground/50'
          )}
        >
          {formattedValue}
        </span>
      </dd>
    </div>
  );
}

export function HighlightsPerformanceBenchmarks() {
  return (
    <section
      aria-labelledby="highlights-output-performance"
      className="space-y-6 pb-16 md:pb-24"
    >
      <div className="max-w-2xl">
        <h2
          id="highlights-output-performance"
          className="text-2xl font-semibold tracking-tight"
        >
          Faster output & lighter footprint
        </h2>
        <p className="text-muted-foreground text-pretty">
          Highlights generates HTML up to{' '}
          {HIGHLIGHTS_LARGE_FILE_MAXIMUM_SPEEDUP}× faster than Shiki and uses
          about a third of its memory.
        </p>
      </div>

      <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <figure
          aria-labelledby="highlights-language-performance"
          className={`${styles.card} dark text-foreground min-w-0 rounded-lg p-4 sm:p-8 lg:p-10`}
        >
          <figcaption className="mb-6 max-w-2xl">
            <h3
              id="highlights-language-performance"
              className="text-xl font-semibold tracking-tight"
            >
              Super-fast HTML generation
            </h3>
            <p className="text-muted-foreground max-w-xl text-pretty">
              Speedup over Shiki when generating HTML from large files.
            </p>
          </figcaption>
          <div className="space-y-5">
            {HIGHLIGHTS_LARGE_FILE_RESULTS.map(
              ({ language, size, speedup }) => (
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
                    maximum={HIGHLIGHTS_THROUGHPUT_MAXIMUM}
                    formatValue={(value) => `${value}×`}
                    highlights
                  />
                </dl>
              )
            )}
          </div>
        </figure>

        <figure
          aria-labelledby="highlights-memory-performance"
          className={`${styles.card} dark text-foreground min-w-0 rounded-lg p-4 sm:p-8 lg:p-10`}
        >
          <figcaption className="mb-8 max-w-3xl">
            <h3
              id="highlights-memory-performance"
              className="text-xl font-semibold tracking-tight"
            >
              Memory usage
            </h3>
            <p className="text-muted-foreground max-w-xl text-pretty">
              Peak memory when generating HTML from a 517 KiB TypeScript file.
            </p>
          </figcaption>
          <dl className="space-y-6">
            {memoryResults.map(({ name, peakRss }) => (
              <PerformanceBar
                key={name}
                name={name}
                value={peakRss}
                maximum={memoryMaximum}
                formatValue={(value) => `${value} MiB`}
                highlights={name === 'Highlights'}
              />
            ))}
          </dl>
        </figure>
      </div>

      <div className="text-muted-foreground max-w-4xl space-y-2 text-xs leading-relaxed">
        <p>
          Recorded October 5, 2026 · Shiki 4.4.1 · Apple M4 Pro. Speedup is
          median throughput relative to Shiki. Memory is median peak process RSS
          from five fresh processes, including the runtime.{' '}
          <Link
            href="https://github.com/pierrecomputer/pierre/tree/main/packages/highlights/benchmark#html-generation"
            className="styled-link"
            target="_blank"
            rel="noopener noreferrer"
          >
            See the HTML generation
          </Link>
          {' and '}
          <Link
            href="https://github.com/pierrecomputer/pierre/tree/main/packages/highlights/benchmark#memory-usage"
            className="styled-link"
            target="_blank"
            rel="noopener noreferrer"
          >
            memory usage
          </Link>{' '}
          benchmarks.
        </p>
      </div>
    </section>
  );
}

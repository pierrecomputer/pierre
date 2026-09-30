import { IconArrowUpRight } from '@pierre/icons';

import { BenchmarkBar } from './BenchmarkBar';
import { FeatureHeader } from '@/components/FeatureHeader';
import { Button } from '@/components/ui/button';

const maximumThroughput = 894;

const rows = [
  {
    language: 'CSS',
    size: '379 KiB',
    highlights: 309,
    shiki: 1.25,
  },
  {
    language: 'HTML',
    size: '474 KiB',
    highlights: 678,
    shiki: 2.86,
  },
  {
    language: 'JSONC',
    size: '292 KiB',
    highlights: 894,
    shiki: 6.04,
  },
  {
    language: 'TypeScript',
    size: '517 KiB',
    highlights: 321,
    shiki: 1.09,
  },
] as const;

export function HighlightsHtmlBenchmarks() {
  return (
    <section
      aria-labelledby="highlights-html-generation"
      className="scroll-mt-20 space-y-5 pb-16 md:pb-24"
    >
      <FeatureHeader
        id="highlights-html-generation"
        title="Super-fast HTML generation"
        description={
          <>
            Highlight a whole file in one pass. On the 517 KiB TypeScript
            fixture, Highlights delivers{' '}
            <strong>294× Shiki’s HTML throughput</strong>, including input
            encoding and output decoding.
          </>
        }
      />

      <figure className="bg-card overflow-hidden rounded-lg border">
        <figcaption className="text-muted-foreground border-b px-4 py-3 text-xs sm:text-sm">
          HTML throughput in MiB/s · longer is faster
        </figcaption>
        <ul className="divide-y">
          {rows.map(({ language, size, highlights, shiki }) => (
            <li
              key={language}
              className="grid gap-3 px-4 py-4 sm:grid-cols-[6rem_minmax(0,1fr)] sm:items-center sm:gap-5"
            >
              <h3 className="text-sm font-medium">
                {language}
                <span className="text-muted-foreground block text-xs font-normal">
                  {size}
                </span>
              </h3>
              <dl className="space-y-2 text-xs tabular-nums">
                <div className="grid grid-cols-[4.75rem_minmax(0,1fr)_3rem] items-center gap-2 sm:grid-cols-[5.5rem_minmax(0,1fr)_3.5rem] sm:gap-3">
                  <dt className="font-medium">Highlights</dt>
                  <dd>
                    <BenchmarkBar
                      value={highlights}
                      maximum={maximumThroughput}
                      highlighted
                    />
                  </dd>
                  <dd
                    aria-label={`${highlights} MiB per second`}
                    className="text-right font-medium"
                  >
                    {highlights}
                  </dd>
                </div>
                <div className="grid grid-cols-[4.75rem_minmax(0,1fr)_3rem] items-center gap-2 sm:grid-cols-[5.5rem_minmax(0,1fr)_3.5rem] sm:gap-3">
                  <dt className="text-muted-foreground">Shiki</dt>
                  <dd>
                    <BenchmarkBar value={shiki} maximum={maximumThroughput} />
                  </dd>
                  <dd
                    aria-label={`${shiki} MiB per second`}
                    className="text-muted-foreground text-right"
                  >
                    {shiki}
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      </figure>

      <div className="text-muted-foreground max-w-3xl space-y-2 text-xs leading-relaxed">
        <p>
          Recorded September 25, 2026 · Bun 1.4.0 · Apple M4 Pro · Shiki 4.4.1.
          Median throughput after a 200 ms warm-up, with at least 20 samples per
          case and a 1.5 s sampling budget, rotating contenders.
        </p>
        <p>
          DOM rendering is excluded and highlighting quality is not measured.
          Token boundaries and styles can differ between libraries.
        </p>
      </div>

      <Button asChild variant="outline">
        <a
          href="https://github.com/pierrecomputer/pierre/tree/main/packages/highlights/benchmark#html-generation"
          target="_blank"
          rel="noopener noreferrer"
        >
          Read the benchmark
          <IconArrowUpRight aria-hidden="true" />
        </a>
      </Button>
    </section>
  );
}

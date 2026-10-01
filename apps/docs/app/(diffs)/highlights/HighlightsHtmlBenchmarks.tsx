import { BenchmarkBar } from './BenchmarkBar';

const maximumThroughput = 894;

const rows = [
  {
    language: 'CSS',
    size: '379 KiB',
    highlights: 309,
    shiki: 1.25,
    speedup: 248,
  },
  {
    language: 'HTML',
    size: '474 KiB',
    highlights: 678,
    shiki: 2.86,
    speedup: 237,
  },
  {
    language: 'JSONC',
    size: '292 KiB',
    highlights: 894,
    shiki: 6.04,
    speedup: 148,
  },
  {
    language: 'TypeScript',
    size: '517 KiB',
    highlights: 321,
    shiki: 1.09,
    speedup: 294,
  },
] as const;

export function HighlightsHtmlBenchmarks() {
  return (
    <section
      aria-labelledby="highlights-html-generation"
      className="scroll-mt-20 space-y-6 pb-16 md:pb-24"
    >
      <div className="max-w-3xl">
        <h2
          id="highlights-html-generation"
          className="text-2xl font-semibold tracking-tight"
        >
          Super-fast HTML generation
        </h2>
        <p className="text-muted-foreground text-pretty">
          Highlight a whole file in one pass. On the 517 KiB TypeScript fixture,
          Highlights delivers{' '}
          <strong className="text-foreground font-semibold">
            294× Shiki’s HTML throughput
          </strong>
          , including input encoding and output decoding.
        </p>
      </div>

      <figure className="bg-muted/50 min-w-0 rounded-2xl p-4 sm:p-8 lg:p-10">
        <figcaption className="text-muted-foreground mb-4 text-sm">
          <strong>HTML throughput (MiB/s)</strong> · Linear scale, longer is
          faster
        </figcaption>
        <ul className="divide-foreground/10 divide-y">
          {rows.map(({ language, size, highlights, shiki, speedup }) => (
            <li
              key={language}
              className="grid gap-2 py-4 first:pt-0 last:pb-0 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-x-5 sm:gap-y-0"
            >
              <h3 className="text-sm font-medium sm:contents">
                <span className="sm:col-start-1 sm:row-start-1 sm:self-center">
                  {language}
                </span>
                <span className="text-muted-foreground ml-2 font-normal sm:col-start-1 sm:row-start-2 sm:ml-0 sm:self-center">
                  {size}
                </span>
              </h3>
              <dl className="text-sm tabular-nums sm:contents">
                <div className="grid grid-cols-[4.75rem_minmax(0,1fr)_3rem] items-center gap-1 sm:col-start-2 sm:row-start-1 sm:grid-cols-[5.5rem_minmax(0,1fr)_3.5rem] sm:gap-3">
                  <dt className="font-medium">Highlights</dt>
                  <dd>
                    <BenchmarkBar
                      value={highlights}
                      maximum={maximumThroughput}
                      highlighted
                    />
                  </dd>
                  <dd className="text-right text-lg font-semibold">
                    <span aria-hidden="true">{speedup}×</span>
                    <span className="sr-only">
                      {highlights} MiB per second; {speedup} times Shiki
                    </span>
                  </dd>
                </div>
                <div className="grid grid-cols-[4.75rem_minmax(0,1fr)_3rem] items-center gap-2 sm:col-start-2 sm:row-start-2 sm:grid-cols-[5.5rem_minmax(0,1fr)_3.5rem] sm:gap-3">
                  <dt className="text-muted-foreground">Shiki</dt>
                  <dd>
                    <BenchmarkBar value={shiki} maximum={maximumThroughput} />
                  </dd>
                  <dd className="text-foreground/50 text-md text-right">
                    <span aria-hidden="true">{shiki}</span>
                    <span className="sr-only">{shiki} MiB per second</span>
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
          case and a 1.5 s sampling budget, rotating contenders. DOM rendering
          is excluded and highlighting quality is not measured. Highlights
          labels show speedup over Shiki. Token boundaries and styles can differ
          between libraries.{' '}
          <a
            href="https://github.com/pierrecomputer/pierre/tree/main/packages/highlights/benchmark#html-generation"
            className="styled-link styled-link-muted"
            target="_blank"
            rel="noopener noreferrer"
          >
            Read the benchmark
          </a>
        </p>
      </div>
    </section>
  );
}

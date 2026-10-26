import { BenchmarkBar } from './BenchmarkBar';
import styles from './HighlightsBenchmarkCard.module.css';
import benchmark from '@/public/highlights/benchmark-browser.json';

// Keep the chart tied to the complete recorded browser run. Every engine
// processes the same source, so elapsed times can share one direct scale.
const rows = [...benchmark.rows].sort(
  (left, right) => left.milliseconds - right.milliseconds
);
const maximumMilliseconds = Math.max(
  ...rows.map(({ milliseconds }) => milliseconds)
);

const subTenSecondsFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const longerSecondsFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function formatDuration(milliseconds: number) {
  const seconds = milliseconds / 1000;
  const displayedSeconds = (
    seconds < 10 ? subTenSecondsFormatter : longerSecondsFormatter
  )
    .format(seconds)
    .replace(/^0/, '');

  return `${displayedSeconds}s`;
}

function formatOutput(output: string) {
  return output === 'tokens' ? 'Tokens' : output === 'spans' ? 'Spans' : output;
}

export function HighlightsBenchmarks() {
  return (
    <section
      id="performance"
      aria-labelledby="highlights-performance"
      className="scroll-mt-20 space-y-6 pb-16 md:pb-24"
    >
      <div className="max-w-2xl">
        <h2
          id="highlights-performance"
          className="text-2xl font-semibold tracking-tight"
        >
          Compared with other highlighters
        </h2>
        <p className="text-muted-foreground text-pretty">
          Highlights tokenizes 5.56 million characters of JavaScript in{' '}
          <strong className="text-foreground font-semibold">.08 s</strong> in
          the browser. Compare it with Shu Ding’s{' '}
          <a
            href="https://github.com/vercel-labs/gpu-lexer"
            target="_blank"
            rel="noopener noreferrer"
            className="styled-link"
          >
            gpu-lexer
          </a>{' '}
          and other highlighters on the same input.
        </p>
      </div>

      <figure
        className={`${styles.card} dark text-foreground min-w-0 rounded-lg p-4 pb-3 sm:p-8 sm:pb-5 lg:p-10 lg:pb-6`}
      >
        <figcaption
          id="highlights-benchmark-caption"
          className="text-muted-foreground mb-5 flex flex-col text-left text-sm md:flex-row md:items-baseline md:gap-1"
        >
          <strong>Processing three.min.js 10&times;</strong>
          <span aria-hidden="true" className="hidden md:inline">
            ·
          </span>
          <span>Elapsed time, shorter is faster</span>
        </figcaption>
        <dl
          aria-labelledby="highlights-benchmark-caption"
          className="space-y-5 tabular-nums sm:space-y-6"
        >
          {rows.map(({ name, version, milliseconds, output }) => {
            const isHighlights = name === 'Highlights';

            return (
              <div
                key={name}
                className="grid grid-cols-[minmax(0,1fr)_4.75rem] items-center gap-x-3 gap-y-1.5 sm:grid-cols-[minmax(0,1fr)_7.5rem]"
              >
                <dt className="text-muted-foreground col-start-1 row-start-2 flex min-w-0 flex-wrap items-baseline gap-x-1 text-xs leading-tight">
                  <span className="text-foreground text-sm font-medium">
                    {name}
                  </span>
                  <span>
                    {version} · {formatOutput(output)}
                  </span>
                </dt>
                <dd className="contents">
                  <div className="col-start-1 row-start-1">
                    <BenchmarkBar
                      value={milliseconds}
                      maximum={maximumMilliseconds}
                      highlighted={isHighlights}
                      scaleFloor={6}
                    />
                  </div>
                  <span
                    className={
                      isHighlights
                        ? 'col-start-2 row-span-2 row-start-1 self-center text-right text-2xl font-semibold whitespace-nowrap sm:text-3xl'
                        : 'text-foreground/50 col-start-2 row-span-2 row-start-1 self-center text-right text-2xl font-normal whitespace-nowrap sm:text-3xl'
                    }
                  >
                    <span className="sr-only">Elapsed time: </span>
                    {formatDuration(milliseconds)}
                  </span>
                </dd>
              </div>
            );
          })}
        </dl>
      </figure>

      <div className="text-muted-foreground max-w-3xl space-y-2 text-xs leading-relaxed">
        <p>
          Recorded October 21, 2026 · Chromium 153 · Apple M4 Pro. Median of
          three runs, each after one warm-up in a fresh worker. Highlights and
          Shiki return themed tokens, gpu-lexer returns spans, and the others
          return HTML or HAST. Measures speed only, not highlighting quality.{' '}
          <a
            href="/highlights/benchmark-browser.json"
            className="styled-link"
            target="_blank"
            rel="noopener noreferrer"
          >
            View raw results
          </a>
          .
        </p>
      </div>
    </section>
  );
}

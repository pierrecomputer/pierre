import { BenchmarkBar } from './BenchmarkBar';
import benchmark from '@/public/highlights/benchmark-browser.json';

// Keep the chart tied to the complete recorded browser run. Throughput is the
// reciprocal of elapsed time because every engine processes the same source.
const rows = [...benchmark.rows].sort(
  (left, right) => left.milliseconds - right.milliseconds
);
const maximumThroughput = Math.max(
  ...rows.map(({ milliseconds }) => 1 / milliseconds)
);

function formatDuration(milliseconds: number) {
  return milliseconds < 1000
    ? `${milliseconds.toFixed(1)} ms`
    : `${(milliseconds / 1000).toFixed(2)} s`;
}

function formatOutput(output: string) {
  return output === 'tokens' ? 'Tokens' : output === 'spans' ? 'Spans' : output;
}

export function HighlightsBenchmarks() {
  return (
    <section
      id="performance"
      aria-labelledby="highlights-performance"
      className="scroll-mt-20 space-y-5 pb-16 md:pb-24"
    >
      <div className="max-w-3xl">
        <h2
          id="highlights-performance"
          className="text-2xl font-semibold tracking-tight"
        >
          Compared with other highlighters
        </h2>
        <p className="text-muted-foreground text-pretty">
          Highlights processes 5.56 million characters of JavaScript in{' '}
          <strong className="text-foreground font-semibold">92.1 ms</strong>.
          Here’s how it compares with Shu Ding’s{' '}
          <a
            href="https://github.com/vercel-labs/gpu-lexer"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground underline underline-offset-4"
          >
            gpu-lexer
          </a>{' '}
          and other syntax highlighters in the same browser run.
        </p>
      </div>

      <div className="bg-card overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[42rem] table-fixed text-left text-sm tabular-nums">
          <caption className="text-muted-foreground border-b px-4 py-3 text-left text-xs sm:text-sm">
            10 copies of three.min.js · relative throughput · longer is faster
          </caption>
          <thead className="bg-muted/50 border-b">
            <tr>
              <th scope="col" className="px-3 py-3 font-medium sm:px-4">
                <div className="grid grid-cols-[10rem_minmax(0,1fr)] gap-3">
                  <span>Library</span>
                  <span className="text-muted-foreground font-normal">
                    Relative speed
                  </span>
                </div>
              </th>
              <th
                scope="col"
                className="w-28 px-3 py-3 text-right font-medium sm:px-4"
              >
                Time
              </th>
              <th scope="col" className="w-24 px-3 py-3 font-medium sm:px-4">
                Output
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map(({ name, version, milliseconds, output }) => {
              const isHighlights = name === 'Highlights';

              return (
                <tr
                  key={name}
                  className={isHighlights ? 'bg-muted/30' : undefined}
                >
                  <th scope="row" className="px-3 py-3 font-medium sm:px-4">
                    <div className="grid grid-cols-[10rem_minmax(0,1fr)] items-center gap-3">
                      <span className="whitespace-nowrap">
                        {name}
                        <span className="text-muted-foreground ml-2 text-xs font-normal">
                          {version}
                        </span>
                      </span>
                      <BenchmarkBar
                        value={1 / milliseconds}
                        maximum={maximumThroughput}
                        highlighted={isHighlights}
                      />
                    </div>
                  </th>
                  <td className="px-3 py-3 text-right font-medium whitespace-nowrap sm:px-4">
                    {formatDuration(milliseconds)}
                  </td>
                  <td className="text-muted-foreground px-3 py-3 sm:px-4">
                    {formatOutput(output)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="text-muted-foreground max-w-3xl space-y-2 text-xs leading-relaxed">
        <p>
          Recorded September 15, 2026 · Chromium 152 · Apple M4 Pro. Median of
          three samples, each with one warm-up in a fresh worker. Bars show
          relative throughput on a shared linear scale.
        </p>
        <p>
          Highlights and Shiki return themed tokens; gpu-lexer returns
          classified spans. The other libraries return HTML or a HAST tree.
          These results measure speed on this JavaScript workload, not
          highlighting quality.{' '}
          <a
            href="/highlights/benchmark-browser.json"
            className="hover:text-foreground underline underline-offset-4"
            target="_blank"
            rel="noopener noreferrer"
          >
            View versions, samples, and run conditions
          </a>
          .
        </p>
      </div>
    </section>
  );
}

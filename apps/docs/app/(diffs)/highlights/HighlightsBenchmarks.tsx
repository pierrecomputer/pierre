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

const preciseMilliseconds = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const roundedMilliseconds = new Intl.NumberFormat('en-US');

function formatDuration(milliseconds: number) {
  const displayedMilliseconds =
    milliseconds < 1000
      ? preciseMilliseconds.format(milliseconds)
      : roundedMilliseconds.format(Math.round(milliseconds / 10) * 10);

  return `${displayedMilliseconds} ms`;
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
            className="styled-link styled-link-muted"
          >
            gpu-lexer
          </a>{' '}
          and other syntax highlighters in the same browser run.
        </p>
      </div>

      <div className="bg-muted/50 min-w-0 overflow-x-auto rounded-2xl p-4 pb-3 sm:p-8 sm:pb-5 lg:p-10 lg:pb-6">
        <table className="w-full min-w-[42rem] table-fixed text-left tabular-nums">
          <caption className="text-muted-foreground mb-5 text-left text-sm">
            <strong>Processing three.min.js 10&times;</strong> · Elapsed time in
            ms, lower is better
          </caption>
          <thead className="text-muted-foreground border-foreground/10 border-b text-xs">
            <tr>
              <th scope="col" className="pb-3 font-medium">
                <div className="grid grid-cols-[10rem_minmax(0,1fr)] gap-3">
                  <span>Library</span>
                  <span className="font-normal">
                    Relative speed · longer is faster
                  </span>
                </div>
              </th>
              <th scope="col" className="w-28 pb-3 text-right font-medium">
                Time (ms)
              </th>
              <th scope="col" className="w-24 pb-3 pl-5 font-medium">
                Output
              </th>
            </tr>
          </thead>
          <tbody className="divide-foreground/10 divide-y">
            {rows.map(({ name, version, milliseconds, output }) => {
              const isHighlights = name === 'Highlights';

              return (
                <tr key={name}>
                  <th scope="row" className="py-5 font-medium">
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
                  <td className="py-5 text-right text-xl font-normal whitespace-nowrap">
                    {formatDuration(milliseconds)}
                  </td>
                  <td className="text-muted-foreground py-5 pl-5 text-sm">
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
          relative speed (1 / elapsed time) on a shared linear scale; longer is
          faster. Highlights and Shiki return themed tokens; gpu-lexer returns
          classified spans. The other libraries return HTML or a HAST tree.
          These results measure speed on this JavaScript workload, not
          highlighting quality.{' '}
          <a
            href="/highlights/benchmark-browser.json"
            className="styled-link styled-link-muted"
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

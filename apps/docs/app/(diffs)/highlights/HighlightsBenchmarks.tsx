import { BenchmarkBar } from './BenchmarkBar';
import { FeatureHeader } from '@/components/FeatureHeader';
import benchmark from '@/public/highlights/benchmark-browser.json';

// Keep the displayed timings tied to the recorded samples from the
// "On highlighting code" article, available below with versions and conditions.
const rows = [...benchmark.rows].sort(
  (left, right) => left.milliseconds - right.milliseconds
);
const maximumThroughput = Math.max(
  ...rows.map(({ milliseconds }) => 1 / milliseconds)
);

export function HighlightsBenchmarks() {
  return (
    <section
      id="performance"
      className="scroll-mt-20 space-y-5"
      aria-labelledby="highlights-performance"
    >
      <FeatureHeader
        id="highlights-performance"
        title="Compared with other highlighters"
        description={
          <>
            Highlights processes 5.56 million characters of JavaScript in{' '}
            <strong>92.1 ms</strong>. Here’s how it compares with Shu Ding’s{' '}
            <a
              href="https://github.com/vercel-labs/gpu-lexer"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground underline underline-offset-4"
            >
              gpu-lexer
            </a>
            , Shiki, and other syntax highlighters in the same browser run.
          </>
        }
      />
      <div className="bg-card overflow-x-auto rounded-lg border">
        <table className="w-full table-fixed text-left text-sm tabular-nums">
          <caption className="text-muted-foreground border-b px-4 py-3 text-left">
            10 copies of three.min.js · relative throughput · longer is faster
          </caption>
          <thead className="bg-muted/50 border-b">
            <tr>
              <th scope="col" className="px-3 py-3 font-medium sm:px-4">
                <div className="sm:grid sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-3">
                  <span>Library</span>
                  <span className="text-muted-foreground hidden font-normal sm:block">
                    Relative speed
                  </span>
                </div>
              </th>
              <th
                scope="col"
                className="w-24 px-3 py-3 text-right font-medium sm:w-28 sm:px-4"
              >
                Time
              </th>
              <th
                scope="col"
                className="w-18 px-3 py-3 font-medium sm:w-28 sm:px-4"
              >
                Output
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map(({ name, version, milliseconds, output }) => (
              <tr
                key={name}
                className={name === 'Highlights' ? 'bg-muted/30' : undefined}
              >
                <th scope="row" className="px-3 py-3 font-medium sm:px-4">
                  <div className="grid items-center gap-2 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-3">
                    <span>
                      {name}{' '}
                      <span className="text-muted-foreground ml-2 hidden text-xs font-normal sm:inline">
                        {version}
                      </span>
                    </span>
                    <BenchmarkBar
                      value={1 / milliseconds}
                      maximum={maximumThroughput}
                      highlighted={name === 'Highlights'}
                    />
                  </div>
                </th>
                <td className="px-3 py-3 text-right font-medium whitespace-nowrap sm:px-4">
                  {milliseconds < 1000
                    ? `${milliseconds.toFixed(1)} ms`
                    : `${(milliseconds / 1000).toFixed(2)} s`}
                </td>
                <td className="text-muted-foreground px-3 py-3 sm:px-4">
                  {output === 'tokens'
                    ? 'Tokens'
                    : output === 'spans'
                      ? 'Spans'
                      : output}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-muted-foreground max-w-3xl space-y-2 text-sm">
        <p>
          Recorded September 15, 2026 · Chromium 152 · Apple M4 Pro. Median of
          three samples, each with one warm-up in a fresh worker. Initialization
          and DOM rendering are excluded. Bars show relative throughput on a
          linear scale; rainbow bars represent Highlights.
        </p>
        <p>
          Highlights and Shiki return themed tokens via{' '}
          <code>codeToTokens()</code>; gpu-lexer returns classified spans. The
          other libraries return HTML or a HAST tree. These results measure
          speed on this JavaScript workload, not highlighting quality.{' '}
          <a
            href="/highlights/benchmark-browser.json"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground underline underline-offset-4"
          >
            View versions, samples, and run conditions
          </a>
          .
        </p>
      </div>
    </section>
  );
}

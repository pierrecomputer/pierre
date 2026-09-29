import { FeatureHeader } from '@/components/FeatureHeader';
import benchmark from '@/public/highlights/benchmark-browser.json';

// Keep the displayed timings tied to the recorded samples from the
// "On highlighting code" article, available below with versions and conditions.
const rows = [...benchmark.rows].sort(
  (left, right) => left.milliseconds - right.milliseconds
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
        <table className="w-full text-left text-sm tabular-nums">
          <caption className="text-muted-foreground border-b px-4 py-3 text-left">
            10 copies of three.min.js · median time · lower is better
          </caption>
          <thead className="bg-muted/50 border-b">
            <tr>
              <th scope="col" className="px-3 py-3 font-medium sm:px-4">
                Library
              </th>
              <th
                scope="col"
                className="px-3 py-3 text-right font-medium sm:px-4"
              >
                Time
              </th>
              <th scope="col" className="px-3 py-3 font-medium sm:px-4">
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
                  {name}{' '}
                  <span className="text-muted-foreground ml-2 hidden text-xs font-normal sm:inline">
                    {version}
                  </span>
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
          and DOM rendering are excluded.
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

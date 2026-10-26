import pierreLight from '@pierre/highlights/themes/pierre-light';
import { createHtmlSession, renderToHtml } from '@pierre/words';
import { createHighlightsPlugin } from '@pierre/words/highlights';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const results: Array<{
  name: string;
  sourceCharacters: number;
  updates: number;
  fullMilliseconds: number;
  incrementalMilliseconds: number;
  ratio: number;
}> = [];

/** Replay the same fixed append stream; report medians after one warmup. */
function compare(
  name: string,
  source: string,
  full: (input: string) => unknown,
  incremental: () => { render(input: string): unknown; dispose?(): void }
): void {
  const inputs: string[] = [];
  for (let end = 64; end < source.length; end += 64)
    inputs.push(source.slice(0, end));
  inputs.push(source);
  const measure = (run: (input: string) => unknown): number => {
    const start = performance.now();
    for (const input of inputs) run(input);
    return performance.now() - start;
  };
  const baseline: number[] = [];
  const live: number[] = [];
  for (let sample = 0; sample < 6; sample++) {
    const session = incremental();
    // Alternate ordering to reduce warmup and GC ordering bias.
    const a = sample % 2 === 0 ? measure(full) : measure(session.render);
    const b = sample % 2 === 0 ? measure(session.render) : measure(full);
    if (sample > 0) {
      baseline.push(sample % 2 === 0 ? a : b);
      live.push(sample % 2 === 0 ? b : a);
    }
    session.dispose?.();
  }
  baseline.sort((a, b) => a - b);
  live.sort((a, b) => a - b);
  results.push({
    name,
    sourceCharacters: source.length,
    updates: inputs.length,
    fullMilliseconds: baseline[2],
    incrementalMilliseconds: live[2],
    ratio: baseline[2] / live[2],
  });
  console.log(
    `${name}: ${source.length} UTF-16 units, ${inputs.length} appends; full ${baseline[2].toFixed(1)}ms, incremental ${live[2].toFixed(1)}ms, ${(baseline[2] / live[2]).toFixed(2)}×`
  );
}

const prose = Array.from(
  { length: 160 },
  (_, i) =>
    `## Section ${i}\n\nA paragraph with **bold**, *emphasis*, and [a link](/docs/${i}).\n\n- One\n- Two\n\n`
).join('');
const decoder = new TextDecoder();
const htmlOptions = { frontmatter: false, incomplete: true, skipHtml: true };
/** Decode direct Wasm output with the same repair and raw-HTML flags as sessions. */
const fullHtml = (input: string): string =>
  decoder.decode(renderToHtml(input, htmlOptions));
const incrementalHtml = (): { render(input: string): string } => {
  const session = createHtmlSession();
  return {
    render: (input) => session.render(input, { incomplete: true }).html,
  };
};
compare('Markdown HTML blocks', prose, fullHtml, incrementalHtml);
compare(
  'Markdown long open paragraph',
  'A paragraph with **bold** words. '.repeat(500),
  fullHtml,
  incrementalHtml
);
compare(
  'Markdown reference fallback',
  `${prose}\n[id]: /target\n\n${prose}`,
  fullHtml,
  incrementalHtml
);
const plugin = createHighlightsPlugin({ theme: pierreLight });
const code = Array.from(
  { length: 500 },
  (_, i) => `const value${i} = { name: "item ${i}", count: ${i} };\n`
).join('');
compare(
  'TypeScript highlighting',
  code,
  (input) =>
    plugin.highlight({ code: input, language: 'ts', isIncomplete: true }),
  () => {
    const session = plugin.createSession!();
    return {
      render: (input) =>
        session.highlight({ code: input, language: 'ts', isIncomplete: true }),
      dispose: session.dispose,
    };
  }
);
console.log(
  'Parser/tokenization only; excludes React, DOM, network, and Streamdown. 64-character chunks, one warmup plus five measured replays.'
);

const jsonArgument = process.argv.find((argument) =>
  argument.startsWith('--json=')
);
if (jsonArgument)
  writeFileSync(
    jsonArgument.slice('--json='.length),
    JSON.stringify(
      {
        date: new Date().toISOString(),
        runtime: process.version,
        chunkCharacters: 64,
        samples: 5,
        results,
      },
      null,
      2
    ) + '\n'
  );

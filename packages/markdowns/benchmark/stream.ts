import pierreLight from '@pierre/highlights/themes/pierre-light';
import { createMarkdownSession, renderToElements } from '@pierre/markdowns';
import { createHighlightsPlugin } from '@pierre/markdowns/highlights';
import { performance } from 'node:perf_hooks';

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
  console.log(
    `${name}: ${source.length} UTF-16 units, ${inputs.length} appends; full ${baseline[2].toFixed(1)}ms, incremental ${live[2].toFixed(1)}ms, ${(baseline[2] / live[2]).toFixed(2)}×`
  );
}

const prose = Array.from(
  { length: 160 },
  (_, i) =>
    `## Section ${i}\n\nA paragraph with **bold**, *emphasis*, and [a link](/docs/${i}).\n\n- One\n- Two\n\n`
).join('');
compare(
  'Markdown blocks',
  prose,
  (input) => renderToElements(input, { incomplete: true }),
  () => {
    const session = createMarkdownSession();
    return { render: (input) => session.render(input, { incomplete: true }) };
  }
);
compare(
  'Markdown long open paragraph',
  'A paragraph with **bold** words. '.repeat(500),
  renderToElements,
  createMarkdownSession
);
compare(
  'Markdown reference fallback',
  `${prose}\n[id]: /target\n\n${prose}`,
  renderToElements,
  createMarkdownSession
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

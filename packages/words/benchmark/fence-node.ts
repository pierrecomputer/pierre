import dark from '@pierre/highlights/themes/pierre-dark';
import light from '@pierre/highlights/themes/pierre-light';
import { createHighlightsPlugin } from '@pierre/words/highlights';
import { createHtmlRenderer } from '@pierre/words/html';
import { setImmediate } from 'node:timers/promises';

import {
  createFenceFixture,
  fenceHash,
  fencePercentile,
} from './fence-fixture';

/** Decode generated text entities once, preserving literal entity-looking code. */
function decodeText(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|#39);/g, (_entity, name: string) =>
    name === 'amp'
      ? '&'
      : name === 'lt'
        ? '<'
        : name === 'gt'
          ? '>'
          : name === 'quot'
            ? '"'
            : "'"
  );
}

/** Ignore equivalent CSS serialization, span splitting, and the color assigned to line breaks. */
function canonicalHtml(html: string): string {
  html = html
    .replace(/\n/g, '')
    .replace(
      / style="([^"]*)"/g,
      (_attribute, style: string) => ` style="${style.replace(/;\s*$/, '')}"`
    )
    .replace(
      />([^<]*)</g,
      (_match, text: string) =>
        '>' +
        decodeText(text).replace(/[&<>]/g, (character) =>
          character === '&' ? '&amp;' : character === '<' ? '&lt;' : '&gt;'
        ) +
        '<'
    );
  let previous: string;
  do {
    previous = html;
    html = html
      .replace(/<span\b[^>]*><\/span>/g, '')
      .replace(
        /<span([^>]*)>([^<]*)<\/span><span\1>([^<]*)<\/span>/g,
        '<span$1>$2$3</span>'
      );
  } while (html !== previous);
  return html;
}

/** Preserve exact code whitespace separately from the visible-text style comparison. */
function codeText(html: string): string {
  const code = /<code\b[^>]*>([\s\S]*?)<\/code>/.exec(html)?.[1];
  if (code === undefined)
    throw new Error('Completed formatter output has no code element');
  return decodeText(code.replace(/<span\b[^>]*>|<\/span>/g, ''));
}

/** Benchmark the same frozen production formatter that supplies the browser's DOM path. */
export function runNodeFence(
  lineCount: number,
  lineNumbers: boolean,
  runs: number
) {
  const fixture = createFenceFixture(lineCount);
  const code = createHighlightsPlugin({
    themes: { light, dark },
    defaultColor: 'light-dark()',
  });
  const options = { plugins: { code }, controls: false, lineNumbers };
  const warmup = createHtmlRenderer(options);
  warmup.render(
    '```typescript\nconst warmup: number = 1;\n```\n',
    false,
    false
  );
  warmup.dispose();
  const samples = [];
  for (let run = -1; run < runs; run++) {
    const renderer = createHtmlRenderer(options);
    const times: number[] = [];
    let deliveredHtmlCharacters = 0;
    let final: ReturnType<typeof renderer.render> | undefined;
    const start = performance.now();
    for (const end of fixture.ends) {
      const before = performance.now();
      final = renderer.render(
        fixture.source.slice(0, end),
        true,
        end < fixture.source.length
      );
      deliveredHtmlCharacters += final.addition.length + final.pending.length;
      times.push(performance.now() - before);
    }
    const elapsed = performance.now() - start;
    const finalHtml = final!.html;
    renderer.dispose();
    const independent = createHtmlRenderer(options);
    const expected = independent.render(fixture.source, true, false).html;
    independent.dispose();
    const finalCode = codeText(finalHtml);
    const freshCode = codeText(expected);
    if (finalCode !== fixture.code || freshCode !== fixture.code)
      throw new Error(
        'Streamed or fresh completed code text differs from the exact source, including newlines'
      );
    const expectedNumbers = Array.from({ length: lineCount }, (_, index) =>
      String(index + 1)
    ).join('\n');
    for (const html of [finalHtml, expected]) {
      const gutter =
        /<span data-markdown="line-numbers"[^>]*>([\s\S]*?)<\/span>/.exec(
          html
        )?.[1];
      if (lineNumbers ? gutter !== expectedNumbers : gutter !== undefined)
        throw new Error(
          'Streamed or fresh completed line-number gutter differs from expected numbers'
        );
    }
    const canonical = canonicalHtml(finalHtml);
    const canonicalExpected = canonicalHtml(expected);
    if (canonical !== canonicalExpected) {
      let at = 0;
      while (canonical[at] === canonicalExpected[at]) at++;
      throw new Error(
        'Canonical streamed formatter HTML differs from fresh completed render: ' +
          JSON.stringify({
            at,
            streamed: canonical.slice(Math.max(0, at - 80), at + 160),
            fresh: canonicalExpected.slice(Math.max(0, at - 80), at + 160),
          })
      );
    }
    if (run >= 0)
      samples.push({
        elapsed,
        updates: times.length,
        updateP50: fencePercentile(times, 0.5),
        updateP95: fencePercentile(times, 0.95),
        maxUpdate: Math.max(...times),
        updateTotal: times.reduce((sum, value) => sum + value, 0),
        deliveredHtmlCharacters,
        finalHtmlCharacters: finalHtml.length,
        finalHtmlHash: fenceHash(finalHtml),
        freshHtmlCharacters: expected.length,
        freshHtmlHash: fenceHash(expected),
        canonicalHtmlHash: fenceHash(canonical),
        finalCodeHash: fenceHash(finalCode),
        finalCodeParity: true,
        finalLineNumberParity: true,
        exactByteParity: finalHtml === expected,
        finalParity: true,
      });
  }
  return {
    lineCount,
    lineNumbers,
    characters: fixture.source.length,
    linesPerDelivery: fixture.linesPerDelivery,
    samples,
  };
}

/** Consume the HTML a DOM client needs without retaining prior results or forcing full lazy output. */
function consumeFenceUpdate(
  renderer: ReturnType<typeof createHtmlRenderer>,
  source: string,
  end: number
): number {
  const update = renderer.render(
    source.slice(0, end),
    true,
    end < source.length
  );
  return update.addition.length + (update.code?.html ?? update.pending).length;
}

/** Measure independent sessions in one warmed process, excluding DOM, external memory, and Wasm commitment. */
export async function runFenceMemory(
  lineCount: number,
  lineNumbers: boolean,
  runs = 3
) {
  const gc = globalThis.gc;
  if (typeof gc !== 'function')
    throw new Error('Fence memory diagnostics require Node --expose-gc');
  const fixture = createFenceFixture(lineCount);
  fixture.source = Buffer.from(fixture.source, 'utf8').toString('utf8');
  const code = createHighlightsPlugin({
    themes: { light, dark },
    defaultColor: 'light-dark()',
  });
  const options = { plugins: { code }, controls: false, lineNumbers };
  // Exercise live edits and release a complete session before measuring retained caches.
  const warm = (): number => {
    const renderer = createHtmlRenderer(options);
    renderer.render('', true, false);
    let consumed = 0;
    for (const end of fixture.ends)
      consumed ^= consumeFenceUpdate(renderer, fixture.source, end);
    consumed ^= renderer.render('', true, false).pending.length;
    renderer.dispose();
    return consumed;
  };
  let sink = warm();
  const heap = async (): Promise<number> => {
    await setImmediate();
    gc();
    await setImmediate();
    gc();
    return process.memoryUsage().heapUsed;
  };
  const samples = [];
  for (let run = 0; run < runs; run++) {
    let renderer: ReturnType<typeof createHtmlRenderer> | undefined =
      createHtmlRenderer(options);
    renderer.render('', true, false);
    const baseline = await heap();
    for (const end of fixture.ends) {
      if (end === fixture.source.length) break;
      sink ^= consumeFenceUpdate(renderer, fixture.source, end);
    }
    const active = await heap();
    sink ^= consumeFenceUpdate(renderer, fixture.source, fixture.source.length);
    const closed = await heap();
    sink ^= renderer.render('', true, false).pending.length;
    const emptyReset = await heap();
    renderer.dispose();
    renderer = undefined;
    const released = await heap();
    samples.push({
      run,
      heapUsedBytes: { baseline, active, closed, emptyReset, released },
      additionalHeapBytes: {
        active: active - baseline,
        closed: closed - baseline,
        emptyReset: emptyReset - baseline,
        released: released - baseline,
      },
    });
  }
  return {
    lineCount,
    lineNumbers,
    characters: fixture.source.length,
    updates: fixture.ends.length,
    samples,
    sink,
    notes: [
      'Independent formatter sessions in one warmed Node process; samples are not fresh-process trials.',
      'The full source is materialized as a new flat UTF-8 round-trip string before any baseline, avoiding later rope-flattening allocation in session deltas. No source-prefix arrays or previous result objects are retained by the harness.',
      'One complete replay through live edits, fence closure, empty-source reset, and disposal is discarded before sampling, warming the same session path and shared grammar.',
      'Active means every delivery before the closing fence; code HTML suffixes are consumed when available, otherwise full pending HTML, matching the applicable DOM delivery contract.',
      'Each heap sample follows two explicit garbage collections separated by event-loop turns. Collection is outside performance timing.',
      'Only process.memoryUsage().heapUsed is reported. Native DOM, Wasm commitment, external allocations, graphics, and total process memory are excluded.',
      'Closure, empty-source reset, and disposal plus renderer release are separate stages. Remaining caches or reset deltas do not establish a leak.',
    ],
  };
}

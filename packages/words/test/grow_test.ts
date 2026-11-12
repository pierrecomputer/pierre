import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { init } from '../dist/core.js';

const wasm = new WebAssembly.Module(
  readFileSync(new URL('../dist/md.wasm', import.meta.url))
);
const dec = new TextDecoder();

// enough to hold anything below without growing again
const warm = init(wasm);
warm.render('x'.repeat(8 << 20), 0, {});

const q = '"';
const docs = {
  // escape-dense text: six output bytes per input byte through $outText
  quotes: Array.from({ length: 399 }, () => q.repeat(16)).join('\n\n'),
  longQuotes: Array.from(
    { length: 43 },
    (_, i) => q.repeat(200) + `Z${i}Z`
  ).join('\n\n'),
  // percent-encoded link destinations, written a byte at a time
  hrefs: Array.from(
    { length: 183 },
    (_, i) => `[t${i}](http://x/${'é'.repeat(800)}#Z${i}Z)`
  ).join('\n\n'),
  titles: Array.from(
    { length: 200 },
    (_, i) => `[t](/u "${q.repeat(300)} T${i}T")`
  ).join('\n\n'),
  images: Array.from(
    { length: 4000 },
    (_, i) => `![alt *text* ${i}](/img/${i}.png "t")`
  ).join('\n\n'),
  autolinks: Array.from(
    { length: 4000 },
    (_, i) => `See https://example.com/${i} and me${i}@example.com.`
  ).join('\n\n'),
  rawhtml: Array.from(
    { length: 4000 },
    (_, i) => `<span data-i="${i}">x</span> and <script>y</script>`
  ).join('\n\n'),
  code: Array.from(
    { length: 3000 },
    (_, i) => '`' + `<${i}> & "${i}"`.repeat(6) + '`'
  ).join('\n\n'),
  definitionChain: Array.from(
    { length: 1000 },
    (_, i) =>
      `[label ${i}]: /target/${i}\n\n[^note ${i}]: note ${i}\n\n` +
      `# Block ${i}\n\n[label ${i}] and [^note ${i}]\n\n`
  ).join(''),
  plainParagraphs: Array.from(
    { length: 3000 },
    (_, i) => 'ordinary 界é. '.repeat(20) + `P${i}.\nnext.\nthird.\nlast.`
  ).join('\n\n'),
  plainEOFTail: 'ordinary 界é. '.repeat(30000) + '\t ',
  fencedCode: '```\n' + '<&"\n'.repeat(30000) + '```\n',
  openFencedCode: '~~~\n' + '<&"\n'.repeat(30000),
  entities: Array.from({ length: 3000 }, (_, i) =>
    `&amp;&#${i};&nbsp;&lt;`.repeat(4)
  ).join('\n\n'),
  tables: Array.from(
    { length: 800 },
    (_, i) => `| a${i} | b |\n| --- | --: |\n| ${i} | *v* |`
  ).join('\n\n'),
  // Alternate input aliases and escaped-pipe copies while table output grows.
  tableWidthOverflow:
    '| a | b |\n| --- | --- |\n' +
    Array.from({ length: 3200 }, (_, i) => `| \\*${i} | \`<&"\\|é\` |\n`).join(
      ''
    ),
  // A wrap writes the line prefix inside a text run; when that grows memory,
  // the run must reread its moved content
  quotedRun:
    '> '.repeat(25) +
    Array.from({ length: 10500 }, (_, i) =>
      i % 13 === 0 ? '**b** ' : i % 7 === 0 ? '`c` ' : 'word '
    )
      .join('')
      .replace(/(.{60}) /g, '$1\n' + '> '.repeat(25)) +
    '\n',
  // ANSI re-emits the line prefix at every wrap, so deep quotes write far more
  // than they read
  quoted: Array.from(
    { length: 60 },
    (_, i) =>
      '> '.repeat(50) +
      Array.from({ length: 480 }, (_, j) => `w${j}_xxxx`).join(' ') +
      ` P${i}P`
  ).join('\n\n'),
};

void test('string encoding survives growth between multibyte characters', () => {
  for (const length of [16000, 26023, 65536, 262144]) {
    for (const tail of ['é中', '😀', '\ud800x\udc00', '\0']) {
      const source = 'é'.repeat(length) + tail.repeat(10000) + ' finished';
      const cold = init(wasm);
      assert.equal(
        dec.decode(cold.render(source, 0, {}).output),
        dec.decode(warm.render(new TextEncoder().encode(source), 0, {}).output)
      );
    }
  }
});

void test(
  'growth past 2.5 GiB clamps to the wasm32 limit instead of trapping',
  {
    skip:
      process.env.WORDS_HUGE !== '1' &&
      'set WORDS_HUGE=1 to render 1 GiB of code into 4 GiB of memory',
  },
  () => {
    // An open fence keeps the source as one span and `&` makes the output
    // 1.8x the input: 3 GB in all, so 40000 pages cannot simply double.
    const input = new Uint8Array(2 ** 30 - 2 ** 20);
    const line = new TextEncoder().encode('a&&aaaaaa\n');
    for (let i = 4; i < 4 + line.length * 64; i += line.length)
      input.set(line, i);
    for (let n = line.length * 64; 4 + n < input.length; n *= 2)
      input.copyWithin(4 + n, 4, 4 + Math.min(n, input.length - 4 - n));
    input.set(new TextEncoder().encode('```\n'));
    input[input.length - 1] = 10;
    const renderer = init(wasm);
    renderer.memory.grow(40000 - renderer.pages);
    renderer.bindMemory();
    const output = renderer.render(input, 0, {}).output;
    assert.ok(output.length > 1.7 * input.length, `${output.length} bytes`);
  }
);

void test('a large code block reserves output as it goes, not six times its size', () => {
  // escaped text can take six bytes per byte, but this text takes one
  const input = new TextEncoder().encode(
    '```\n' + 'code line\n'.repeat(800_000)
  );
  const renderer = init(wasm);
  const output = renderer.render(input, 0, {}).output;
  assert.equal(output.length, input.length + 21);
  assert.ok(
    renderer.pages * 65536 < 4.5 * input.length,
    `${renderer.pages} pages for ${input.length} bytes`
  );
});

void test(
  'a code block past 715 MB does not overflow its output reservation',
  {
    skip:
      process.env.WORDS_HUGE !== '1' &&
      'set WORDS_HUGE=1 to render 716 MB of code into 2.7 GiB of memory',
  },
  () => {
    // six times this length is 704 modulo 2 ** 32
    const input = new Uint8Array(715_828_000).fill(97);
    for (let i = 99; i < input.length; i += 100) input[i] = 10;
    input.set(new TextEncoder().encode('```\n'));
    const output = init(wasm).render(input, 0, {}).output;
    assert.equal(output.length, input.length + 21);
  }
);

for (const [name, doc] of Object.entries(docs)) {
  for (const [label, mode] of [
    ['html', 0],
    ['ansi', 1],
  ] as const) {
    void test(`${name} renders identically whether or not memory grows (${label})`, () => {
      // a brand new instance starts at two pages, so this render has to grow
      const cold = init(wasm);
      const grown = dec.decode(cold.render(doc, mode, { width: 80 }).output);
      const flat = dec.decode(warm.render(doc, mode, { width: 80 }).output);
      if (grown !== flat) {
        let i = 0;
        while (i < grown.length && grown[i] === flat[i]) i++;
        assert.fail(
          `differs at byte ${i} of ${flat.length}\n` +
            `  grown: ${JSON.stringify(grown.slice(i - 40, i + 60))}\n` +
            `  flat:  ${JSON.stringify(flat.slice(i - 40, i + 60))}`
        );
      }
    });
  }
}

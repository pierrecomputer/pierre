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
  // More cells than the ANSI width cache holds; exercise remeasurement while
  // alternating input aliases and escaped-pipe copies in the same table.
  tableWidthOverflow:
    '| a | b |\n| --- | --- |\n' +
    Array.from({ length: 2400 }, (_, i) => `| \\*${i} | \`<&"\\|é\` |\n`).join(
      ''
    ),
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

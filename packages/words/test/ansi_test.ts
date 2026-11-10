/* oxlint-disable no-control-regex -- ANSI output is escape sequences, and these tests match them */
import assert from 'node:assert';
import test from 'node:test';

import { renderToAnsi } from '../dist/index.js';
import { loadSpec } from './spec_test.ts';

const dec = new TextDecoder();
const ansi = (
  md: string | Uint8Array | ArrayBuffer,
  options?: { width?: number }
) => dec.decode(renderToAnsi(md, options));

/** the visible text of an ANSI rendering, with the escape sequences removed */
const plain = (md: string, options?: { width?: number }) =>
  ansi(md, options).replace(/\x1b\[[0-9;]*m/g, '');

void test('headings, emphasis and code carry SGR', () => {
  assert.match(ansi('# Title'), /\x1b\[1m/, 'a heading is bold');
  assert.match(ansi('**b**'), /\x1b\[1m/);
  assert.match(ansi('*i*'), /\x1b\[3m/);
  assert.match(ansi('~~s~~'), /\x1b\[9m/);
  assert.match(ansi('`c`'), /\x1b\[38;5;203m/);
  assert.equal(plain('**bold** and *italic*'), 'bold and italic\n');
});

void test('styles never leak past the end of the output', () => {
  const out = ansi('# T\n\n*i* **b** `c`\n');
  assert.ok(out.endsWith('\n'), 'output ends with a newline');
  assert.match(out, /\x1b\[0m[^\x1b]*\n$/, 'the last line is reset');
});

void test('block quotes get a bar on every line', () => {
  const out = plain('> one\n>\n> two');
  assert.equal(out, '│ one\n│ \n│ two\n');
});

void test('quotes past the prefix limit keep every bar they can show', () => {
  const q = (n: number) => '>'.repeat(n);
  const md = `${q(36)} a\n${q(37)} b\n${q(36)}\n${q(36)} c\n`;
  const bars = plain(md)
    .trimEnd()
    .split('\n')
    .map((l) => (l.match(/│/g) ?? []).length);
  assert.deepEqual(bars, [36, 36, 36, 36, 36]);
  let items = '';
  for (let i = 0; i < 10; i++)
    items += `${q(36)} ${' '.repeat(2 * i)}- i${i}\n`;
  const out = ansi(`${items}${q(36)}\n${q(36)} after\n`);
  assert.doesNotMatch(out, /\x1b(?!\[[0-9;]*m)/, 'no escape is cut');
  for (const line of out
    .replace(/\x1b\[[0-9;]*m/g, '')
    .trimEnd()
    .split('\n')) {
    assert.equal(line.match(/│/g)?.length, 36, line);
  }
});

void test('lists indent their continuation and cycle bullets', () => {
  assert.equal(plain('- a\n- b'), '• a\n• b\n');
  assert.equal(plain('- a\n  - b'), '• a\n  ◦ b\n');
  assert.equal(plain('1. a\n2. b'), '1. a\n2. b\n');
  assert.equal(plain('- [x] yes\n- [ ] no'), '• [✓] yes\n• [ ] no\n');
  assert.equal(plain('- [x]\n- no'), '• [x]\n• no\n', 'a bare marker is text');
});

void test('a loose list keeps a blank line between items', () => {
  assert.equal(ansi('- a\n\n- b'), '\x1b[1m• \x1b[0ma\n\n\x1b[1m• \x1b[0mb\n');
  assert.equal(plain('1. a\n\n2. b\n   - c\n'), '1. a\n\n2. b\n   ◦ c\n');
});

void test('an empty list item keeps its marker, and only its own', () => {
  assert.equal(plain('1. a\n2.\n3. c'), '1. a\n2.\n3. c\n');
  assert.equal(plain('-\n\n  foo'), '•\n\nfoo\n');
});

void test('an item that opens inside another keeps both markers', () => {
  assert.equal(plain('- - a'), '• ◦ a\n');
  assert.equal(plain('1. - a\n   - b\n2. c'), '1. ◦ a\n   ◦ b\n2. c\n');
  assert.equal(plain('1. 2. 3. a'), '1. 2. 3. a\n');
  assert.equal(plain('- > - a'), '• │ ◦ a\n');
  assert.equal(plain('- -\n- b'), '• ◦\n• b\n');
  assert.equal(
    plain('- - a b c d', { width: 7 }),
    '• ◦ a b\n    c d\n',
    'the text wraps under the inner item'
  );
  assert.equal(ansi('- - a'), '\x1b[1m• ◦ \x1b[0ma\n', 'one style for both');
  // the outer marker is not bold: its style ends before the inner one
  assert.equal(ansi('1. - a'), '1. \x1b[1m◦ \x1b[0ma\n');
});

void test('a block that writes nothing leaves no blank line', () => {
  assert.equal(plain('- >\n\n  text'), '• text\n', 'an empty quote in an item');
  assert.equal(plain('- >\n  - a'), '• ◦ a\n');
  // inline content that renders nothing, such as dropped raw HTML
  assert.equal(plain('<a name="x"></a>\n\ntext'), 'text\n');
  assert.equal(plain('a\n\n<b></b>\n\nb'), 'a\n\nb\n');
  assert.equal(plain('a\n\n#\n\nb'), 'a\n\nb\n');
  assert.equal(plain('- <b></b>\n- x'), '•\n• x\n');
});

void test('a task box goes to its item’s first paragraph only', () => {
  assert.equal(plain('- [ ] foo\n  ---\n\nlater'), '• [ ] foo\n\nlater\n');
  for (const item of [
    '- [x] a | b\n  - | -',
    '- [x] \n\n  ***',
    '1. [x]\n   ***',
  ]) {
    assert.ok(plain(`${item}\n\nlater`).endsWith('\n\nlater\n'), item);
  }
});

void test('tables align to the widest cell', () => {
  const out = plain('| name | n |\n| :--- | --: |\n| alpha | 1 |');
  const lines = out.trimEnd().split('\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[0], 'name  │ n');
  assert.equal(lines[1], '──────┼──');
  assert.equal(lines[2], 'alpha │ 1');
  // plain cells are measured by length, the others by rendering them
  assert.equal(
    plain('| a  b | *c* | d&amp;e | f |\n|-|-|-|-|\n| xxx | xx | xxx | x |'),
    'a b │ c  │ d&e │ f\n────┼────┼─────┼──\nxxx │ xx │ xxx │ x\n'
  );
});

void test('wide tables align every column and cell', () => {
  const long = 'y'.repeat(300);
  const lines = plain(`| a | b |\n|-|-|\n| ${long} | 1 |\n| x | 2 |\n`)
    .trimEnd()
    .split('\n');
  const at = (l: string, c: string) => Array.from(l).indexOf(c);
  assert.deepEqual(
    [
      at(lines[0], '│'),
      at(lines[1], '┼'),
      at(lines[2], '│'),
      at(lines[3], '│'),
    ],
    [301, 301, 301, 301]
  );
  const cols = 300;
  const md = `|${'h|'.repeat(cols)}\n|${'-|'.repeat(cols)}\n|${'x|'.repeat(cols)}\n`;
  const [head, , row] = plain(md).split('\n');
  assert.equal(head.split('│').length, cols);
  assert.equal(row, Array(cols).fill('x').join(' │ '));
});

void test('a cell renders the same when measured and when written', () => {
  // the space before a link target must not depend on the cell's column
  assert.equal(
    plain('> | a | b |\n> |-|-|\n> | [l](/u) | x |\n> | y | z |'),
    '│ a      │ b\n│ ───────┼──\n│ l (/u) │ x\n│ y      │ z\n'
  );
  assert.equal(
    plain('- | a | b |\n  |-|-|\n  | [l](/u) | []() |\n  | y | zzz |'),
    '• a      │ b\n  ───────┼────\n  l (/u) │ ()\n  y      │ zzz\n'
  );
  assert.equal(
    plain('| a | b |\n|-|-:|\n| x | []() |\n| y | zzz |'),
    'a │   b\n──┼────\nx │  ()\ny │ zzz\n'
  );
});

void test('links show their target', () => {
  assert.equal(plain('[text](/url)'), 'text (/url)\n');
  assert.equal(plain('<https://x.test/>'), 'https://x.test/\n');
});

void test('alt text line breaks are spaces that wrap like any other', () => {
  assert.equal(plain('![a\nb](/i)'), 'a b (/i)\n');
  assert.equal(plain('![a\\\nb](/i)'), 'a b (/i)\n');
  assert.equal(plain('> ![\n> b](/i)'), '│ b (/i)\n', 'none at the line start');
  assert.equal(
    plain('![aaa\nbbb  \nccc](/i)', { width: 7 }),
    'aaa bbb\nccc\n(/i)\n'
  );
  assert.equal(plain('![a\n](/i) b', { width: 1 }), 'a\n(/i)\nb\n');
  // the space is a column: the target no longer fits behind it
  assert.equal(plain('![a\nb](/i)', { width: 7 }), 'a b\n(/i)\n');
});

void test('wrapping respects the requested width', () => {
  const words = Array.from({ length: 40 }, (_, i) => `w${i}`).join(' ');
  for (const line of plain(words, { width: 20 }).trimEnd().split('\n')) {
    assert.ok(line.length <= 20, `"${line}" is ${line.length} columns`);
  }
  assert.ok(
    plain(words).trimEnd().split('\n').length === 1,
    'no wrapping without a width'
  );
});

void test('a thematic break shows at any width', () => {
  assert.equal(plain('---', { width: 10 }), `${'─'.repeat(10)}\n`);
  assert.equal(plain('> ---', { width: 5 }), '│ ───\n');
  assert.equal(plain('> ---', { width: 2 }), '│ ─\n');
  assert.equal(plain('---', { width: 1 }), '─\n');
});

void test('a line wraps only at a break opportunity', () => {
  // marks, entities and escapes split text, not words
  assert.equal(
    ansi('aaaaaaaa*bbb* x', { width: 10 }),
    'aaaaaaaa\x1b[3mbbb\x1b[0m\nx\n'
  );
  assert.equal(
    plain('aaaaaaaa **bold**, cc', { width: 13 }),
    'aaaaaaaa\nbold, cc\n'
  );
  assert.equal(plain('abc&amp;defghij', { width: 6 }), 'abc&defghij\n');
  assert.equal(
    ansi('x **aaa**bbbbbb', { width: 8 }),
    'x\n\x1b[1maaa\x1b[0mbbbbbb\n',
    'glued text moves to the next line with its style'
  );
  assert.equal(
    plain('你好世界你好世界你好世界', { width: 10 }),
    '你好世界你\n好世界你好\n世界\n'
  );
});

void test('words of non-ASCII letters wrap like any other', () => {
  assert.equal(
    plain('Привет мир ещё раз', { width: 10 }),
    'Привет мир\nещё раз\n'
  );
  assert.equal(
    plain('naïve café déjà vu', { width: 10 }),
    'naïve café\ndéjà vu\n'
  );
  assert.equal(
    plain('да **нет**да ещё', { width: 8 }),
    'да нетда\nещё\n',
    'a styled part stays glued'
  );
  assert.equal(
    plain('日本語のテキスト', { width: 7 }),
    '日本語\nのテキ\nスト\n'
  );
  assert.equal(plain('한국어 텍스트', { width: 6 }), '한국어\n텍스트\n');
});

void test('a word wider than the line stays after its marker', () => {
  assert.equal(
    plain('- verylongwordthatdoesnotfit', { width: 10 }),
    '• verylongwordthatdoesnotfit\n'
  );
  assert.equal(
    plain('> verylongwordthatdoesnotfit', { width: 10 }),
    '│ verylongwordthatdoesnotfit\n'
  );
  assert.equal(
    plain('https://example.com/a/very/long/url', { width: 10 }),
    'https://example.com/a/very/long/url\n'
  );
});

void test('soft breaks, link targets and footnote references fit the width', () => {
  assert.equal(plain('aaa bbb\nccc', { width: 7 }), 'aaa bbb\nccc\n');
  assert.equal(
    plain('xxxxxxxxxxxxxxxxx [b](/u) z', { width: 22 }),
    'xxxxxxxxxxxxxxxxx b\n(/u) z\n'
  );
  assert.equal(
    plain('[aaa bbb ccc](http://example.com/very/long/url/path)', {
      width: 20,
    }),
    'aaa bbb ccc\n(http://example.com/very/long/url/path)\n'
  );
  const refs = plain(`x${'[^1]'.repeat(8)}\n\n[^1]: n`, { width: 12 });
  assert.equal(refs.split('\n\n')[0], 'x[1][1][1]\n[1][1][1][1]\n[1]');
  let notes = '';
  for (let i = 1; i <= 100; i++)
    notes += `[^${i}]\n\n[^${i}]: note ${i} and more words\n\n`;
  const lines = plain(notes, { width: 20 }).split('\n');
  const at = lines.indexOf('[100] note 100 and');
  assert.equal(
    lines[at + 1],
    '      more words',
    'the hanging indent fits [100]'
  );
});

void test('footnotes are collected at the end', () => {
  const out = plain('see[^1]\n\n[^1]: the note');
  assert.match(out, /see\[1\]/);
  assert.match(out, /\[1\] the note/);
  // `![^1]` that is no image is `!` and a reference
  assert.match(plain('wow![^1]\n\n[^1]: the note'), /^wow!\[1\]\n/);
});

void test('wide characters count as two columns', () => {
  const out = plain('| a | b |\n| - | - |\n| 你好 | x |');
  const lines = out.trimEnd().split('\n');
  assert.equal(lines[0], 'a    │ b');
  assert.equal(lines[2], '你好 │ x');
});

void test('a combining mark stays with its wide base character', () => {
  assert.equal(plain('かかか\u3099かか', { width: 6 }), 'かかか\u3099\nかか\n');
  assert.equal(plain('a 你\u0301好', { width: 3 }), 'a\n你\u0301\n好\n');
});

void test('a list marker stays in its own column when a quote follows it', () => {
  assert.equal(
    plain('> 1. > Blockquote\ncontinued here.\n'),
    '│ 1. │ Blockquote\n│    │ continued here.\n'
  );
  assert.equal(plain('1. > q\n2. b'), '1. │ q\n2. b\n');
  assert.equal(plain('- > q'), '• │ q\n');
});

void test('input controls never reach the terminal', () => {
  const inputs = [
    'hi \x1b]0;pwned\x07 there',
    'clear \x1b[2J\x1b[H screen',
    '```\n\x1b]8;;http://evil\x07click\x1b]8;;\x07\n```',
    '<div>\x1b[2J</div>',
    'a\x00b\x7fc \u0085 \u009b',
    '[x](<a\x1bb>) ![i\x1b](/s) <http://a\u009bb>',
    '# h\x1b\n\n| a\x1b |\n|-|\n| \x07 |',
    'n[^1]\n\n[^1]: \x1b note',
    '&#27; &#155; &#127;',
  ];
  for (const md of inputs) {
    for (const width of [undefined, 8]) {
      const out = ansi(md, { width });
      assert.doesNotMatch(
        out,
        /\x1b(?!\[[0-9;]*m)/,
        `${JSON.stringify(md)}: escape`
      );
      assert.doesNotMatch(
        out,
        /[\x00-\x09\x0b-\x1a\x1c-\x1f\x7f\u0080-\u009f]/u,
        `${JSON.stringify(md)}: control`
      );
    }
  }
  assert.equal(plain('a\x00b\u0085c'), 'a�b�c\n');
  // a replacement is one column
  assert.equal(
    plain('| \x1b | b |\n|-|-|\n| xx | y |'),
    '�  │ b\n───┼──\nxx │ y\n'
  );
});

void test('code blocks keep the virtual spaces of a partial tab', () => {
  assert.equal(ansi('>\t\tfoo'), ansi('>       foo'));
  assert.equal(ansi('- foo\n\n\t\tbar'), ansi('- foo\n\n        bar'));
});

void test('every escape sequence is needed and none is left open', () => {
  // over the whole conformance corpus, so a new construct cannot regress it
  for (const { markdown, example } of loadSpec()) {
    let live = false;
    for (const code of ansi(markdown, { width: 72 }).match(/\x1b\[[0-9;]*m/g) ??
      []) {
      const reset = code === '\x1b[0m';
      assert.ok(!reset || live, `#${example}: reset with nothing to reset`);
      live = !reset;
    }
    assert.ok(!live, `#${example}: output ends with a style still on`);
  }
});

void test('a style starts on the word, not on the space before it', () => {
  // the space belongs to the text around the construct, so it stays unstyled
  assert.match(
    ansi('see [text](/url)'),
    /see \x1b\[4m/,
    'a link does not underline it'
  );
  assert.match(
    ansi('see ![alt](/img)'),
    /see \x1b\[2m/,
    'an image does not dim it'
  );
  assert.equal(
    plain('see [^1] after\n\n[^1]: n').split('\n')[0],
    'see [1] after'
  );
  assert.equal(plain('a *b* c'), 'a b c\n');
});

void test('a held-back space never ends a wrapped line', () => {
  const md = `${'w '.repeat(12)}[link](/url) ${'x '.repeat(12)}`;
  for (const line of plain(md, { width: 20 }).split('\n')) {
    assert.ok(!line.endsWith(' '), `"${line}" ends in a space`);
  }
});

void test('a line does not start with a space', () => {
  // the space follows raw HTML that is dropped, or opens a styled span
  assert.equal(ansi('# <b> e'), '\x1b[1m\x1b[4m\x1b[38;5;39me\x1b[0m\n');
  assert.equal(ansi('~~<b> d~~'), '\x1b[9md\x1b[0m\n');
  assert.equal(plain('[ x](/u)'), 'x (/u)\n');
  assert.equal(plain('<b> x'), 'x\n');
  assert.equal(plain('- [ ] <b> x'), '• [ ] x\n');
});

void test('quoted content is dim', () => {
  assert.match(ansi('> quoted'), /\x1b\[2mquoted/);
  assert.equal(plain('> quoted\n'), '│ quoted\n');
});

void test('a line that starts with a style change opens with one sequence', () => {
  const bar = '\x1b[38;5;240m│\x1b[0m ';
  assert.equal(
    ansi('> # h'),
    `${bar}\x1b[1m\x1b[4m\x1b[2m\x1b[38;5;39mh\x1b[0m\n`
  );
  assert.equal(
    ansi('> **a** b'),
    `${bar}\x1b[1m\x1b[2ma\x1b[0m\x1b[2m b\x1b[0m\n`
  );
});

void test('a table cell that holds back a space keeps its style', () => {
  // a code span's trailing space is cell content, so it must not poison $sgrLive
  const md = '| a | b |\n| - | - |\n| `foo ` | x |';
  const out = ansi(md);
  assert.match(
    out,
    /\x1b\[38;5;203mfoo /,
    'the span stays coloured, space included'
  );
  const lines = plain(md).trimEnd().split('\n');
  assert.equal(lines[0], 'a    │ b');
  assert.equal(lines[2], 'foo  │ x');
  let live = false;
  for (const code of out.match(/\x1b\[[0-9;]*m/g) ?? []) {
    const reset = code === '\x1b[0m';
    assert.ok(!reset || live, 'reset with nothing to reset');
    live = !reset;
  }
  assert.ok(!live, 'output ends with a style still on');
});

void test('a list marker takes the style it sits in', () => {
  assert.equal(
    ansi('- a').split('a')[0],
    '\x1b[1m• \x1b[0m',
    'bold at the top level'
  );
  assert.equal(plain('1. a'), '1. a\n');
  assert.match(
    ansi('> - a'),
    /\x1b\[1m\x1b\[2m• /,
    'dim inside a quote, like its item'
  );
  assert.match(ansi('> 1. a'), /\x1b\[2m1\. /);
  // the quote opens inside the item, so its bar follows a marker it must not dim
  assert.match(ansi('1. > q'), /^1\. \x1b\[38;5;240m/);
});

void test('invalid UTF-8 from bytes input cannot reach the terminal', () => {
  const bytes = (...parts: (string | number)[]) =>
    Uint8Array.from(
      parts.flatMap((part) =>
        typeof part === 'number' ? [part] : [...Buffer.from(part)]
      )
    );
  const raw = (input: Uint8Array, options?: { width?: number }) =>
    Buffer.from(renderToAnsi(input, options)).toString('latin1');
  const fffd = '\xef\xbf\xbd';
  // A stray C1 control in text, wrapped text, code and an autolink.
  for (const options of [undefined, { width: 80 }])
    assert.equal(raw(bytes('a', 0x9b, '31mb'), options), `a${fffd}31mb\n`);
  assert.ok(raw(bytes('```\n', 0x9b, '31m\n```')).includes(`${fffd}31m`));
  assert.ok(!raw(bytes('```\n', 0x9b, '31m\n```')).includes('\x9b'));
  // Overlong forms, surrogates, bytes above U+10FFFF and truncated sequences.
  for (const invalid of [
    [0xc0, 0x9b],
    [0xc1, 0x9b],
    [0xe0, 0x80, 0x9b],
    [0xed, 0xa0, 0x9b],
    [0xf0, 0x80, 0x80, 0x9b],
    [0xf4, 0x90, 0x80, 0x9b],
    [0xf5, 0x9b],
    [0xe2, 0x82],
    [0xf0, 0x9f, 0x98],
  ]) {
    const output = raw(bytes('a', ...invalid, 'b'));
    assert.ok(output.includes(fffd), invalid.join());
    assert.ok(!output.includes('\x9b'), invalid.join());
  }
  // The scan skips ASCII eight bytes at a time: every offset in a block.
  for (let i = 0; i < 20; i++) {
    const pad = 'a'.repeat(i);
    assert.equal(raw(bytes(pad, 0x9b, 'b', 0xc2)), `${pad}${fffd}b${fffd}\n`);
    assert.equal(ansi(Buffer.from(`${pad}é€😀`)), `${pad}é€😀\n`);
  }
  // Valid sequences hold bytes in the same range, and stay as they are.
  const valid = 'é € ’ 😀 \u{10ffff} \ud7ff \ue000';
  assert.equal(ansi(Buffer.from(valid)), ansi(valid));
  assert.equal(
    ansi(new TextEncoder().encode(`\`\`\`\n${valid}\n\`\`\``)),
    ansi(`\`\`\`\n${valid}\n\`\`\``)
  );
});

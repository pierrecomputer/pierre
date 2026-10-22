import assert from 'node:assert';
import test from 'node:test';

import { renderToAnsi } from '../dist/node.mjs';
import { loadSpec } from './spec_test.mjs';

const dec = new TextDecoder();
const ansi = (md, options) => dec.decode(renderToAnsi(md, options));

/** the visible text of an ANSI rendering, with the escape sequences removed */
const plain = (md, options) => ansi(md, options).replace(/\x1b\[[0-9;]*m/g, '');

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

void test('lists indent their continuation and cycle bullets', () => {
  assert.equal(plain('- a\n- b'), '• a\n• b\n');
  assert.equal(plain('- a\n  - b'), '• a\n  ◦ b\n');
  assert.equal(plain('1. a\n2. b'), '1. a\n2. b\n');
  assert.equal(plain('- [x] yes\n- [ ] no'), '• [✓] yes\n• [ ] no\n');
});

void test('tables align to the widest cell', () => {
  const out = plain('| name | n |\n| :--- | --: |\n| alpha | 1 |');
  const lines = out.trimEnd().split('\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[0], 'name  │ n');
  assert.equal(lines[1], '──────┼──');
  assert.equal(lines[2], 'alpha │ 1');
});

void test('links show their target', () => {
  assert.equal(plain('[text](/url)'), 'text (/url)\n');
  assert.equal(plain('<https://x.test/>'), 'https://x.test/\n');
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

void test('footnotes are collected at the end', () => {
  const out = plain('see[^1]\n\n[^1]: the note');
  assert.match(out, /see\[1\]/);
  assert.match(out, /\[1\] the note/);
});

void test('wide characters count as two columns', () => {
  const out = plain('| a | b |\n| - | - |\n| 你好 | x |');
  const lines = out.trimEnd().split('\n');
  assert.equal(lines[0], 'a    │ b');
  assert.equal(lines[2], '你好 │ x');
});

void test('a list marker stays in its own column when a quote follows it', () => {
  assert.equal(
    plain('> 1. > Blockquote\ncontinued here.\n'),
    '│ 1. │ Blockquote\n│    │ continued here.\n'
  );
  assert.equal(plain('1. > q\n2. b'), '1. │ q\n2. b\n');
  assert.equal(plain('- > q'), '• │ q\n');
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

void test('quoted content is dim', () => {
  assert.match(ansi('> quoted'), /\x1b\[2mquoted/);
  assert.equal(plain('> quoted\n'), '│ quoted\n');
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

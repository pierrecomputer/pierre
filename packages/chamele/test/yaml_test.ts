import assert from 'node:assert';
import t from 'node:test';

import type { Lang, ThemedToken } from '../lib/index';
import { codeToTokens, init, StreamTokenizer } from '../lib/index';
import { transformWat, wat2wasm } from '../scripts/build';
import pierreDark from '../themes/pierre-dark.json' with { type: 'json' };
import {
  checkInvariants,
  colorOf,
  loadLang,
  spansOf,
  type TestLang,
  themeColor,
} from './util';

let yaml: TestLang;
t.before(() => {
  yaml = loadLang('yaml', '$hlYaml');
  // the streaming tests below need the whole module: yaml is also embedded
  // as markdown front matter, and StreamTokenizer runs the shared driver
  const url = new URL('../src/chamele.wat', import.meta.url);
  const { code } = transformWat(url);
  init(new WebAssembly.Module(wat2wasm(url.pathname, code)));
});

/** Tokens for `code` fed one line per chunk - the LiveTokenizer's shape. */
function lineFed(lang: Lang, code: string): ThemedToken[][] {
  const stream = new StreamTokenizer({ lang, theme: pierreDark });
  const lines: ThemedToken[][] = [];
  for (const line of code.split(/(?<=\n)/)) {
    lines.push(...stream.pushCode(line));
  }
  lines.push(...stream.end());
  return lines;
}

/** Whole-buffer tokens for `code`, the reference the line-fed run must match. */
function wholeTokens(lang: Lang, code: string): ThemedToken[][] {
  return codeToTokens(code, { lang, theme: pierreDark }).tokens;
}

/** The color of the first streamed token whose text contains `text`. */
function streamedColor(
  lines: ThemedToken[][],
  text: string
): string | undefined {
  return lines.flat().find((tk) => tk.content.includes(text))?.color;
}

const PROPERTY = themeColor('property');
const STRING = themeColor('string');
const ESCAPE = themeColor('string.escape');
const NUMBER = themeColor('number');
const BOOLEAN = themeColor('boolean');
const CONSTANT = themeColor('constant.builtin');
const COMMENT = themeColor('comment');
const TYPE = themeColor('type');
const BRACKET = themeColor('punctuation.bracket');
const DELIMITER = themeColor('punctuation.delimiter');

void t.test('yaml: mappings, sequences, scalars, and comments', () => {
  const src =
    'name: chamele\nenabled: true\ncount: 12\nnothing: null\nitems:\n  - one\n  - two # tail\n';
  const html = checkInvariants(yaml.hl, src);
  assert.equal(colorOf(html, 'name'), PROPERTY);
  assert.equal(colorOf(html, 'chamele'), STRING);
  assert.equal(colorOf(html, 'true'), BOOLEAN);
  assert.equal(colorOf(html, '12'), NUMBER);
  assert.equal(colorOf(html, 'null'), CONSTANT);
  assert.equal(colorOf(html, '# tail'), COMMENT);
});

void t.test('yaml: quoted keys, escapes, anchors, aliases, and tags', () => {
  const src =
    '"quoted": "a\\nb"\nbase: &base value\ncopy: *base\ntagged: !thing x\n';
  const html = checkInvariants(yaml.hl, src);
  assert.equal(colorOf(html, '"quoted"'), PROPERTY);
  assert.equal(colorOf(html, '\\n'), ESCAPE);
  assert.equal(colorOf(html, '&base'), TYPE);
  assert.equal(colorOf(html, '*base'), TYPE);
  assert.equal(colorOf(html, '!thing'), TYPE);
});

void t.test('yaml: document markers and flow collections', () => {
  const html = checkInvariants(
    yaml.hl,
    '---\nmap: {a: 1, b: [yes, no, off]}\nempty: ~\n...\n'
  );
  assert.equal(colorOf(html, 'off'), BOOLEAN);
  assert.equal(colorOf(html, '~'), CONSTANT);
});

void t.test(
  'yaml: hashes in plain scalars and key lookahead stay on their line',
  () => {
    const html = checkInvariants(
      yaml.hl,
      'value: foo#bar\nlonely\n: invalid\n# real\n'
    );
    assert.equal(colorOf(html, 'foo#bar'), STRING);
    assert.equal(colorOf(html, 'lonely'), STRING);
    assert.equal(colorOf(html, '# real'), COMMENT);
  }
);

void t.test('yaml: malformed and split ranges stay lossless', () => {
  for (const src of [
    '',
    "'unterminated",
    '"\\é',
    'a:',
    '#',
    '---',
    '[a, {b:',
    'é: 日本語',
  ]) {
    checkInvariants(yaml.hl, src);
  }
  const splitSrc = 'a: "\\é"\n';
  for (
    let split = 0;
    split <= new TextEncoder().encode(splitSrc).length;
    split++
  ) {
    checkInvariants(loadLang('yaml', '$hlYaml', split).hl, splitSrc);
  }
});

void t.test('yaml: a column-0 comment stays a comment on every chunk', () => {
  // the "line start" that lets `#` open a comment without a blank before it
  // must hold for chunk 2+ of a stream, inside markdown front matter, and on
  // the line right after a block scalar body, which consumes its own LF
  for (const [lang, src] of [
    ['yaml', 'a: 1\n#comment\nb: 2\n'],
    ['yaml', '#top\na: 1\n  #indented\nb: 2 # trailing\n'],
    ['yaml', 'a: |\n  body\n#after\nb: 1\n'],
    ['yaml', 'a: "x\\\n  y" #c\nb: 1\n'],
    ['markdown', '---\na: 1\n#comment\nb: 2\n---\n# T\n'],
    ['markdown', '---\na: |\n  x\n  y\nb: 1\n---\n# T\n'],
  ] as [Lang, string][]) {
    assert.deepEqual(lineFed(lang, src), wholeTokens(lang, src), src);
  }
  const streamed = lineFed('yaml', 'a: 1\n#comment\nb: 2\n');
  assert.equal(streamedColor(streamed, '#comment'), COMMENT);
  const html = checkInvariants(yaml.hl, 'a: |\n  body\n#after\nb: 1\n');
  assert.equal(colorOf(html, '#after'), COMMENT);
});

void t.test(
  'yaml: a colon ends a key only before a blank or a line end',
  () => {
    const html = checkInvariants(
      yaml.hl,
      'url: http://example.com\nimage: nginx:latest\ntime: 12:30:00\nkey:value\n- :x\nport: 8080\n'
    );
    const spans = spansOf(html);
    // adjacent string scalars merge into one span across the line break, so
    // check membership in the string-colored text rather than span equality
    const stringText = spans
      .filter((s) => s.color === STRING)
      .map((s) => s.text)
      .join('');
    for (const scalar of [
      'http://example.com',
      'nginx:latest',
      '12:30:00',
      'key:value',
      ':x',
    ]) {
      assert.ok(stringText.includes(scalar), scalar);
    }
    assert.ok(
      !spans.some((s) => s.text.trim() === 'http'),
      'http is not a key'
    );
    for (const key of ['url', 'image', 'time', 'port']) {
      assert.equal(
        spans.find((s) => s.text.trim() === key)?.color,
        PROPERTY,
        key
      );
    }
    assert.equal(colorOf(html, '8080'), NUMBER);
    // flow context: `,` `]` `}` end a key too, and a quoted key keeps its
    // glued `:` as the delimiter, JSON style
    const flow = checkInvariants(
      yaml.hl,
      'm: {a: 1, "b":2, c:3}\nl: [x:1, y]\n'
    );
    const flowSpans = spansOf(flow);
    assert.equal(flowSpans.find((s) => s.text === 'a')?.color, PROPERTY);
    assert.equal(flowSpans.find((s) => s.text === '"b"')?.color, PROPERTY);
    assert.equal(flowSpans.find((s) => s.text === '2')?.color, NUMBER);
    assert.equal(flowSpans.find((s) => s.text.trim() === 'c:3')?.color, STRING);
    assert.equal(flowSpans.find((s) => s.text.trim() === 'x:1')?.color, STRING);
    assert.ok(flowSpans.some((s) => s.text === ':' && s.color === DELIMITER));
    const src = 'url: http://example.com\ntime: 12:30:00\nm: {a: 1, "b":2}\n';
    assert.deepEqual(lineFed('yaml', src), wholeTokens('yaml', src));
  }
);

void t.test('yaml: a backslash is a plain scalar byte, not a bracket', () => {
  const html = checkInvariants(
    yaml.hl,
    'path: \\\\server\\share\n- \\foo\n- [a]\n'
  );
  const spans = spansOf(html);
  assert.equal(
    spans.find((s) => s.text.trim() === '\\\\server\\share')?.color,
    STRING
  );
  assert.equal(spans.find((s) => s.text.trim() === '\\foo')?.color, STRING);
  assert.ok(spans.some((s) => s.text.includes('[') && s.color === BRACKET));
  assert.ok(!spans.some((s) => s.text.includes('\\') && s.color === BRACKET));
});

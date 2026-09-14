import assert from 'node:assert';
import t from 'node:test';

import type { Lang, ThemedToken } from '../lib/index';
import { codeToTokens, init, StreamTokenizer } from '../lib/index';
import { transformWat, wat2wasm } from '../scripts/build';
import pierreDark from '../themes/pierre-dark.json' with { type: 'json' };
import {
  assertLineFedParity,
  checkInvariants,
  colorOf,
  distinctColor,
  distinctTheme,
  exactColor,
  loadLang,
  spansOf,
  type TestLang,
  themeColor,
  tokenKinds,
  wordColor,
} from './_util';

let yaml: TestLang;
t.before(() => {
  yaml = loadLang('yaml', '$hlYaml');
  // the streaming tests below need the whole module: yaml is also embedded
  // as markdown front matter, and StreamTokenizer runs the shared driver
  const url = new URL('../src/highlights.wat', import.meta.url);
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
    'name: highlights\nenabled: true\ncount: 12\nnothing: null\nitems:\n  - one\n  - two # tail\n';
  const html = checkInvariants(yaml.hl, src);
  assert.equal(colorOf(html, 'name'), PROPERTY);
  assert.equal(colorOf(html, 'highlights'), STRING);
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

/** Highlight under the distinct theme after checking the lexer invariants. */
const distinctHl = (src: string) =>
  checkInvariants(yaml.hl, src, { theme: distinctTheme });

void t.test(
  'yaml: document markers, key styles, nesting, and flow collections',
  () => {
    const html = distinctHl(
      '---\nkey: value\n"quoted key": 1\n\'single\': 2\n? complex\n: 3\nnested:\n  a: 1\n  b:\n    - x\n    - y: 1\n      z: 2\nlist: [1, "a", \'b\', true, null, ~, 1.5, -2, 0x1F, 0o17, 1e3]\nmap: {a: 1, b: [2], c: {d: 3}}\n...'
    );
    for (const m of ['---', '...']) {
      assert.equal(
        exactColor(html, m),
        distinctColor('punctuation.special'),
        m
      );
    }
    for (const key of [
      'key',
      "'single'",
      'nested',
      'a',
      'b',
      'y',
      'z',
      'list',
      'map',
      'c',
      'd',
    ]) {
      assert.equal(wordColor(html, key), distinctColor('property'), key);
    }
    assert.equal(exactColor(html, '"quoted key"'), distinctColor('property'));
    for (const s of ['value', 'complex', 'x', '"a"', "'b'"]) {
      assert.equal(wordColor(html, s), distinctColor('string'), s);
    }
    for (const n of ['1', '2', '3', '1.5', '-2', '0x1F', '0o17', '1e3']) {
      assert.equal(wordColor(html, n), distinctColor('number'), n);
    }
    assert.equal(exactColor(html, 'true'), distinctColor('boolean'));
    for (const c of ['null', '~']) {
      assert.equal(exactColor(html, c), distinctColor('constant.builtin'), c);
    }
    for (const b of ['[', '{']) {
      assert.equal(wordColor(html, b), distinctColor('punctuation.bracket'), b);
    }
    assert.equal(wordColor(html, '-'), distinctColor('punctuation.delimiter'));
    assert.equal(wordColor(html, '?'), distinctColor('punctuation.delimiter'));
  }
);

void t.test(
  'yaml: anchors, aliases, merge keys, tags, and block scalars',
  () => {
    const html = distinctHl(
      'anchors: &a\n  x: 1\nref: *a\nmerge:\n  <<: *a\n  y: 2\ntags: !!str 123\ncustom: !mytag value\nliteral: |\n  line one\n  line two\nliteral_keep: |+\n  keep\n\nliteral_strip: |-\n  strip\nfolded: >\n  folded\n  text\nfolded_strip: >-\n  x\nindented: |2\n    two'
    );
    for (const tag of ['&a', '*a', '!!str', '!mytag']) {
      assert.equal(wordColor(html, tag), distinctColor('type'), tag);
    }
    assert.equal(exactColor(html, '<<'), distinctColor('property'));
    assert.equal(exactColor(html, '123'), distinctColor('number'));
    assert.equal(exactColor(html, 'value'), distinctColor('string'));
    // consecutive body lines merge into one span, so check them per line
    const kinds = tokenKinds(
      'yaml',
      'literal: |\n  line one\n  line two\nliteral_keep: |+\n  keep\n\nliteral_strip: |-\n  strip\nfolded: >\n  folded\n  text\nindented: |2\n    two'
    );
    for (const body of [
      'line one',
      'line two',
      'keep',
      'strip',
      'folded',
      'text',
      'two',
    ]) {
      assert.ok(
        kinds.some(([text, kind]) => text === body && kind === 'string'),
        body
      );
    }
    for (const key of [
      'literal',
      'literal_keep',
      'literal_strip',
      'folded_strip',
      'indented',
    ]) {
      assert.equal(exactColor(html, key), distinctColor('property'), key);
    }
  }
);

void t.test(
  'yaml: scalar forms: quoted with escapes, booleans, nulls, urls, times, and colons',
  () => {
    const html = distinctHl(
      'quoted: "a\\n\\"b\\" \\u00e9"\nsingle: \'it\'\'s\'\nempty:\nnull_val: null\ntrue_val: yes\nfalse_val: off\nnum_str: "123"\n"key: colon": v\nurl: http://x.com/a?b=1#c\ntime: 12:30\ncolon_in_value: a:b\ndash-key: -1'
    );
    assert.equal(exactColor(html, '"a'), distinctColor('string'));
    assert.equal(colorOf(html, '\\n'), distinctColor('string.escape'));
    assert.equal(exactColor(html, "'it''s'"), distinctColor('string'));
    assert.equal(exactColor(html, 'null'), distinctColor('constant.builtin'));
    for (const b of ['yes', 'off']) {
      assert.equal(exactColor(html, b), distinctColor('boolean'), b);
    }
    assert.equal(exactColor(html, '"123"'), distinctColor('string'));
    assert.equal(exactColor(html, '"key: colon"'), distinctColor('property'));
    for (const s of ['http://x.com/a?b=1#c', '12:30', 'a:b']) {
      assert.equal(exactColor(html, s), distinctColor('string'), s);
    }
    assert.equal(exactColor(html, '-1'), distinctColor('number'));
    for (const key of ['empty', 'dash-key', 'colon_in_value']) {
      assert.equal(exactColor(html, key), distinctColor('property'), key);
    }
  }
);

void t.test('yaml: comment forms', () => {
  assert.deepEqual(
    tokenKinds('yaml', '# comment\nkey2: value # trailing\n#not-comment: x'),
    [
      ['# comment', 'comment'],
      ['key2', 'property'],
      [':', 'punctuation.delimiter'],
      ['value', 'string'],
      ['# trailing', 'comment'],
      ['#not-comment: x', 'comment'],
    ]
  );
});

void t.test(
  'yaml: block scalars and flow collections spanning lines stream line-fed',
  () => {
    assertLineFedParity(
      'yaml',
      'a: |\n  x\n  y\nb: >-\n  z\nc: [\n  1,\n  2\n]\nd: "multi\n  line"\n'
    );
  }
);

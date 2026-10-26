import assert from 'node:assert';
import t from 'node:test';

import type { TestLang } from './_util';
import {
  assertLineFedParity,
  checkInvariants,
  colorOf,
  distinctColor,
  distinctTheme,
  exactColor,
  loadLang,
  loadSplitLang,
  makeRand,
  spansOf,
  textOf,
  wordColor,
} from './_util';

let lexer: TestLang;
t.before(() => {
  lexer = loadLang('odin', '$hlOdin');
});

/** Highlight under the distinct theme after checking the lexer invariants. */
const hl = (src: string) =>
  checkInvariants(lexer.hl, src, { theme: distinctTheme });

/** Assert that every word has the distinct color of `kind`. */
function expectWords(html: string, words: string[], kind: string) {
  for (const word of words) {
    assert.equal(wordColor(html, word), distinctColor(kind), word);
  }
}

void t.test('odin: declarations, types, and contextual keywords', () => {
  const html = hl(
    'package demo\n' +
      'import "core:fmt"\n' +
      'import str "core:strings"\n' +
      'foreign import "lib"\n' +
      'MAX :: 10\n' +
      'Port :: u16le\n' +
      'ID :: int\n' +
      'Callback :: #type proc(x: int)\n' +
      'Point :: struct { x, y: f32, le: i32le, be: f64be }\n' +
      'Color :: enum { Red, Green }\n' +
      'Meters :: distinct f64\n' +
      'Inline :: #force_inline proc() {}\n' +
      'add :: proc(T: typeid) where T == int { }\n' +
      'Handler :: proc "c" (#no_alias ctx: ^Context, args: ..any) -> (ok: bool) {\n' +
      '  using Point\n' +
      '  cast(int)ctx\n' +
      '  transmute(f32)ctx\n' +
      '  auto_cast args\n' +
      '  asm { }\n' +
      '  fmt./* keep */println("x")\n' +
      '  p.value = context\n' +
      '  return true\n' +
      '}\n'
  );

  expectWords(
    html,
    [
      'package',
      'foreign',
      'struct',
      'enum',
      'distinct',
      'proc',
      'where',
      'using',
    ],
    'keyword.declaration'
  );
  expectWords(html, ['import'], 'keyword.import');
  expectWords(
    html,
    ['cast', 'transmute', 'auto_cast', 'asm', 'context'],
    'keyword'
  );
  assert.equal(exactColor(html, 'demo'), distinctColor('namespace'));
  assert.equal(exactColor(html, 'str'), distinctColor('namespace'));
  assert.equal(exactColor(html, 'MAX'), distinctColor('constant'));
  for (const name of [
    'Point',
    'Color',
    'Meters',
    'Port',
    'ID',
    'Callback',
    'Context',
    'T',
  ]) {
    assert.equal(exactColor(html, name), distinctColor('type'), name);
  }
  for (const name of ['add', 'Inline', 'Handler']) {
    assert.equal(
      exactColor(html, name),
      distinctColor('function.definition'),
      name
    );
  }
  for (const name of [
    'f32',
    'f64',
    'int',
    'bool',
    'typeid',
    'any',
    'u16le',
    'i32le',
    'f64be',
  ]) {
    assert.equal(exactColor(html, name), distinctColor('type.builtin'), name);
  }
  assert.equal(exactColor(html, 'println'), distinctColor('function.method'));
  assert.equal(exactColor(html, 'value'), distinctColor('property'));
  assert.equal(exactColor(html, 'ctx'), distinctColor('variable'));
  assert.equal(exactColor(html, 'ok'), distinctColor('variable'));
  assert.equal(exactColor(html, '#force_inline'), distinctColor('attribute'));
  assert.equal(exactColor(html, '#type'), distinctColor('attribute'));
  expectWords(html, ['..', '->', '^', '=='], 'operator');
  assert.equal(exactColor(html, '::'), distinctColor('punctuation.delimiter'));
  assert.equal(exactColor(html, ':'), distinctColor('punctuation.delimiter'));
});

void t.test('odin: control flow and operators', () => {
  const html = hl(
    'f :: proc() {\n' +
      '  if a && b || !c { } else when d { }\n' +
      '  for i in 0..<10 { continue }\n' +
      '  for j in 0..=10 { break }\n' +
      '  switch v { case 1: fallthrough; case 2: return }\n' +
      '  defer g(); or_return; or_else; or_break; or_continue; not_in\n' +
      '  x := a %% b &~ c\n' +
      '  a <<= d\n' +
      '  a ~= b\n' +
      '  a &~= c\n' +
      '  e := q->r()\n' +
      '  f := **e\n' +
      '  cond ? x : y\n' +
      '}\n'
  );

  expectWords(
    html,
    [
      'if',
      'else',
      'when',
      'for',
      'in',
      'switch',
      'case',
      'fallthrough',
      'continue',
      'break',
      'return',
      'defer',
      'or_return',
      'or_else',
      'or_break',
      'or_continue',
      'not_in',
    ],
    'keyword.control'
  );
  expectWords(
    html,
    [
      '&&',
      '||',
      '!',
      '..<',
      '..=',
      '%%',
      '&~',
      '<<=',
      '~=',
      '&~=',
      ':=',
      '->',
      '**',
      '?',
    ],
    'operator'
  );
  assert.equal(exactColor(html, ';'), distinctColor('punctuation.delimiter'));
  assert.equal(exactColor(html, ':'), distinctColor('punctuation.delimiter'));
  assert.equal(exactColor(html, 'g'), distinctColor('function'));
});

void t.test('odin: literals, comments, attributes, and directives', () => {
  const html = hl(
    '#! /usr/bin/odin run\n' +
      '// line comment\n' +
      '/* outer /* inner */ still */\n' +
      '@(private="file", require_results)\n' +
      '@cold\n' +
      '#partial\n' +
      '#force_inline\n' +
      '#+build linux, windows // note\n' +
      's := "a\\tb"\n' +
      'r := `one\ntwo`\n' +
      "c := '\\n'\n" +
      'n := 0x1F + 0b101 + 0o17 + 0z1A + 0d123 +\n' +
      '  0h3c00 + 0h3f80_0000 + 1_000 + 1.5e-3 + 2i + 2j + 2k + 1.5i\n' +
      'm := 0h3ff0_0000_0000_0000 + .5 + 1. + 1.e-3\n' +
      't := """\nfirst\\tline\nsecond\n"""\n' +
      'q := ```\nraw \\n line\n```\n' +
      'b := true; f := false; p := nil; u := ---\n'
  );

  for (const word of ['#!', '//', '/*', 'outer', 'inner', 'still', 'note']) {
    assert.equal(wordColor(html, word), distinctColor('comment'), word);
  }
  for (const word of [
    'private',
    'require_results',
    '@cold',
    '#partial',
    '#force_inline',
    '#+build',
  ]) {
    assert.equal(wordColor(html, word), distinctColor('attribute'), word);
  }

  assert.equal(colorOf(html, '"a'), distinctColor('string'));
  assert.equal(colorOf(html, '\\t'), distinctColor('string.escape'));
  assert.equal(colorOf(html, 'one'), distinctColor('string'));
  assert.equal(colorOf(html, 'first'), distinctColor('string'));
  assert.equal(colorOf(html, 'second'), distinctColor('string'));
  assert.equal(colorOf(html, 'raw'), distinctColor('string'));
  assert.equal(colorOf(html, '\\n'), distinctColor('string.escape'));

  for (const number of [
    '0x1F',
    '0b101',
    '0o17',
    '0z1A',
    '0d123',
    '0h3c00',
    '0h3f80_0000',
    '1_000',
    '1.5e-3',
    '2i',
    '2j',
    '2k',
    '1.5i',
    '0h3ff0_0000_0000_0000',
    '.5',
    '1.',
    '1.e-3',
  ]) {
    assert.equal(exactColor(html, number), distinctColor('number'), number);
  }
  assert.equal(exactColor(html, 'true'), distinctColor('boolean'));
  assert.equal(exactColor(html, 'false'), distinctColor('boolean'));
  assert.equal(exactColor(html, 'nil'), distinctColor('constant.builtin'));
  assert.equal(exactColor(html, '---'), distinctColor('keyword'));
});

void t.test('odin: malformed and split input stays lossless', () => {
  for (const src of [
    '',
    '/',
    '/*',
    '// tail',
    '#!',
    '"unterminated',
    "'\\",
    '`raw',
    '0x_',
    '0h',
    '\u00e9 \u65e5\u672c\u8a9e',
    '#',
    '#+',
    '@',
    '@(',
    '@(private',
    '$',
    '::',
    '---',
    '..',
    '..<',
    '%%=',
    '&~=',
    '.',
    '1.e',
  ]) {
    checkInvariants(lexer.hl, src);
  }

  const split = loadSplitLang('odin');
  const src =
    'package p\n' +
    'import s "x"\n' +
    'A :: #force_inline proc() {}\n' +
    'B :: struct {}\n' +
    'C :: 1\n' +
    'Port :: u16le\n' +
    's := """a\nb"""\n' +
    '@(private="x")\n' +
    '#+build linux\n';
  for (let at = 0; at <= new TextEncoder().encode(src).length; at++) {
    const html = split(src, at);
    assert.equal(textOf(html), src, JSON.stringify(at));
    spansOf(html);
  }

  const rand = makeRand(0x0d1a);
  const alphabet = 'abcXYZ09_ /\\"\'`\n\t{}[]().,:;+-*=!<>&|#@$%~?^';
  for (let n = 0; n < 160; n++) {
    let src = '';
    for (let i = 0, len = rand() & 63; i < len; i++) {
      src += alphabet[rand() % alphabet.length];
    }
    checkInvariants(lexer.hl, src);
  }
});

void t.test('odin: multi-line constructs resume line-fed', () => {
  for (const code of [
    's := `one\ntwo`\n',
    's := """\none\ntwo\n"""\n',
    'q := ```\nraw\ntext\n```\n',
    '@(private="x")\n#+build linux\nx := 1\n',
  ]) {
    assertLineFedParity('odin', code);
  }
});

import { expect, test } from 'bun:test';

import { codeToTokens } from '../lib/index';
import { samples } from './_samples';
import {
  assertLineFedParity,
  checkInvariants,
  distinctTheme,
  initFullModule,
  loadLang,
  makeRand,
  tokenKinds,
} from './_util';

test('moonbit: declarations name functions, methods, and types', () => {
  const tokens = tokenKinds('moonbit', samples.moonbit.code);
  for (const [text, kind] of [
    ['///| A point on a grid.', 'comment.doc'],
    ['all', 'keyword'],
    ['struct', 'keyword.declaration'],
    ['Point', 'type'],
    ['Int', 'type.builtin'],
    ['#deprecated', 'attribute'],
    ['dist', 'function.definition'],
    ['describe', 'function.definition'],
    ['self', 'variable.special'],
    ['raise', 'keyword.control'],
    ['Error', 'type.builtin'],
    ['to_double', 'function.method'],
    ['@strconv', 'namespace'],
    ['parse_int', 'function'],
    ['Some', 'constructor'],
    ['None', 'constructor'],
    ['true', 'boolean'],
  ]) {
    expect(tokens).toContainEqual([text, kind]);
  }
  expect(tokenKinds('moonbit', 'fn Array::sum(self : Array[Int])')).toEqual([
    ['fn', 'keyword.declaration'],
    ['Array', 'type.builtin'],
    ['::', 'punctuation.delimiter'],
    ['sum', 'function.definition'],
    ['(', 'punctuation.bracket'],
    ['self', 'variable.special'],
    [':', 'punctuation.delimiter'],
    ['Array', 'type.builtin'],
    ['[', 'punctuation.bracket'],
    ['Int', 'type.builtin'],
    ['])', 'punctuation.bracket'],
  ]);
  for (const code of [
    'fn[K : Hash + Eq, V] lookup(m : Map[K, V], k : K) -> V?',
    'fn lookup[K : Hash + Eq, V](m : Map[K, V], k : K) -> V?',
  ]) {
    const tokens = tokenKinds('moonbit', code);
    expect(tokens).toContainEqual(['lookup', 'function.definition']);
    expect(tokens).toContainEqual(['m', 'variable.parameter']);
    expect(tokens).toContainEqual(['k', 'variable.parameter']);
    expect(tokens).toContainEqual(['K', 'type']);
  }
  expect(
    tokenKinds('moonbit', 'impl Show for Point with output(self, logger) {}')
  ).toContainEqual(['output', 'function.definition']);
  for (const word of ['enum', 'type', 'trait', 'suberror', 'typealias']) {
    expect(tokenKinds('moonbit', `${word} item`)).toEqual([
      [word, 'keyword.declaration'],
      ['item', 'type'],
    ]);
  }
  // a declaration keyword names only the next name
  expect(tokenKinds('moonbit', 'fn main {\n  run()\n}')).toEqual([
    ['fn', 'keyword.declaration'],
    ['main', 'function.definition'],
    ['{', 'punctuation.bracket'],
    ['run', 'function'],
    ['()', 'punctuation.bracket'],
    ['}', 'punctuation.bracket'],
  ]);
});

test('moonbit: parameters, labels, lambdas, and calls', () => {
  expect(
    tokenKinds('moonbit', 'fn f(x : Int, label~ : Int = 1, opt? : Int)')
  ).toEqual([
    ['fn', 'keyword.declaration'],
    ['f', 'function.definition'],
    ['(', 'punctuation.bracket'],
    ['x', 'variable.parameter'],
    [':', 'punctuation.delimiter'],
    ['Int', 'type.builtin'],
    [',', 'punctuation.delimiter'],
    ['label', 'variable.parameter'],
    ['~', 'operator'],
    [':', 'punctuation.delimiter'],
    ['Int', 'type.builtin'],
    ['=', 'operator'],
    ['1', 'number'],
    [',', 'punctuation.delimiter'],
    ['opt', 'variable.parameter'],
    ['?', 'operator'],
    [':', 'punctuation.delimiter'],
    ['Int', 'type.builtin'],
    [')', 'punctuation.bracket'],
  ]);
  expect(tokenKinds('moonbit', 'xs.map(fn(a, b) { a + b })')).toEqual([
    ['xs', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['map', 'function.method'],
    ['(', 'punctuation.bracket'],
    ['fn', 'keyword.declaration'],
    ['(', 'punctuation.bracket'],
    ['a', 'variable.parameter'],
    [',', 'punctuation.delimiter'],
    ['b', 'variable.parameter'],
    [') {', 'punctuation.bracket'],
    ['a', 'variable'],
    ['+', 'operator'],
    ['b', 'variable'],
    ['})', 'punctuation.bracket'],
  ]);
  // call arguments are not parameters; `label~` passes a label
  expect(tokenKinds('moonbit', 'f(x, y~)')).toEqual([
    ['f', 'function'],
    ['(', 'punctuation.bracket'],
    ['x', 'variable'],
    [',', 'punctuation.delimiter'],
    ['y', 'variable.parameter'],
    ['~', 'operator'],
    [')', 'punctuation.bracket'],
  ]);
  expect(tokenKinds('moonbit', 'load!(path) |> parse?(x)')).toEqual([
    ['load', 'function'],
    ['!', 'operator'],
    ['(', 'punctuation.bracket'],
    ['path', 'variable'],
    [')', 'punctuation.bracket'],
    ['|>', 'operator'],
    ['parse', 'function'],
    ['?', 'operator'],
    ['(', 'punctuation.bracket'],
    ['x', 'variable'],
    [')', 'punctuation.bracket'],
  ]);
});

test('moonbit: strings, escapes, interpolation, bytes, and chars', () => {
  expect(
    tokenKinds('moonbit', '"a\\n\\x41\\o101\\u5154\\u{1F600}\\"b"')
  ).toEqual([
    ['"a', 'string'],
    ['\\n\\x41\\o101\\u5154\\u{1F600}\\"', 'string.escape'],
    ['b"', 'string'],
  ]);
  expect(tokenKinds('moonbit', '"sum: \\{a + b}, \\{f(x)}!"')).toEqual([
    ['"sum:', 'string'],
    ['\\{', 'punctuation.special'],
    ['a', 'variable'],
    ['+', 'operator'],
    ['b', 'variable'],
    ['}', 'punctuation.special'],
    [',', 'string'],
    ['\\{', 'punctuation.special'],
    ['f', 'function'],
    ['(', 'punctuation.bracket'],
    ['x', 'variable'],
    [')', 'punctuation.bracket'],
    ['}', 'punctuation.special'],
    ['!"', 'string'],
  ]);
  // a string inside an interpolation keeps `\{` as an escape
  expect(tokenKinds('moonbit', '"\\{g("\\{y}")}"')).toEqual([
    ['"', 'string'],
    ['\\{', 'punctuation.special'],
    ['g', 'function'],
    ['(', 'punctuation.bracket'],
    ['"', 'string'],
    ['\\{', 'string.escape'],
    ['y}"', 'string'],
    [')', 'punctuation.bracket'],
    ['}', 'punctuation.special'],
    ['"', 'string'],
  ]);
  expect(tokenKinds('moonbit', "b\"\\xFF\" b'a' '\\'' '😀'")).toEqual([
    ['b"', 'string'],
    ['\\xFF', 'string.escape'],
    ["\" b'a' '", 'string'],
    ["\\'", 'string.escape'],
    ["' '😀'", 'string'],
  ]);
  // strings and interpolations end at the line
  expect(tokenKinds('moonbit', 'let s = "open \\{x\nlet t = }')).toEqual([
    ['let', 'keyword.declaration'],
    ['s', 'variable'],
    ['=', 'operator'],
    ['"open', 'string'],
    ['\\{', 'punctuation.special'],
    ['x', 'variable'],
    ['let', 'keyword.declaration'],
    ['t', 'variable'],
    ['=', 'operator'],
    ['}', 'punctuation.bracket'],
  ]);
});

test('moonbit: multi-line strings are raw or interpolated per line', () => {
  const code =
    'let s =\n  #|raw \\{x} // text\n  $|n = \\{n}\\t\n  #|"\nlet t = 1\n';
  expect(tokenKinds('moonbit', code)).toEqual([
    ['let', 'keyword.declaration'],
    ['s', 'variable'],
    ['=', 'operator'],
    ['#|raw \\{x} // text', 'string'],
    ['$|n =', 'string'],
    ['\\{', 'punctuation.special'],
    ['n', 'variable'],
    ['}', 'punctuation.special'],
    ['\\t', 'string.escape'],
    ['#|"', 'string'],
    ['let', 'keyword.declaration'],
    ['t', 'variable'],
    ['=', 'operator'],
    ['1', 'number'],
  ]);
  assertLineFedParity('moonbit', code);
});

test('moonbit: numbers, tuple indexes, ranges, cascades, and spreads', () => {
  for (const number of ['42', '1_000_000', '0xFF', '0o17', '0b1010', '7L']) {
    expect(tokenKinds('moonbit', number)).toEqual([[number, 'number']]);
  }
  for (const number of ['3UL', '10N', '1.5e-3', '0x1.8p3', '2.0']) {
    expect(tokenKinds('moonbit', number)).toEqual([[number, 'number']]);
  }
  expect(tokenKinds('moonbit', 't.0.1 0..<n 1..=9')).toEqual([
    ['t', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['0', 'number'],
    ['.', 'punctuation.delimiter'],
    ['1 0', 'number'],
    ['..<', 'operator'],
    ['n', 'variable'],
    ['1', 'number'],
    ['..=', 'operator'],
    ['9', 'number'],
  ]);
  expect(tokenKinds('moonbit', 'buf\n  ..write(1)\n[..rest]')).toEqual([
    ['buf', 'variable'],
    ['..', 'operator'],
    ['write', 'function.method'],
    ['(', 'punctuation.bracket'],
    ['1', 'number'],
    [')', 'punctuation.bracket'],
    ['[', 'punctuation.bracket'],
    ['..', 'operator'],
    ['rest', 'variable'],
    [']', 'punctuation.bracket'],
  ]);
});

test('moonbit: comments, attributes, packages, and visibility', () => {
  expect(
    tokenKinds('moonbit', '// note\n/// doc\n///|\n#borrow(x)\n#coverage.skip')
  ).toEqual([
    ['// note', 'comment'],
    ['/// doc', 'comment.doc'],
    ['///|', 'comment.doc'],
    ['#borrow', 'attribute'],
    ['(', 'punctuation.bracket'],
    ['x', 'variable'],
    [')', 'punctuation.bracket'],
    ['#coverage.skip', 'attribute'],
  ]);
  expect(
    tokenKinds('moonbit', '@immut/list.T::empty() @json.JsonValue a/b')
  ).toEqual([
    ['@immut/list', 'namespace'],
    ['.', 'punctuation.delimiter'],
    ['T', 'type'],
    ['::', 'punctuation.delimiter'],
    ['empty', 'function'],
    ['()', 'punctuation.bracket'],
    ['@json', 'namespace'],
    ['.', 'punctuation.delimiter'],
    ['JsonValue', 'type'],
    ['a', 'variable'],
    ['/', 'operator'],
    ['b', 'variable'],
  ]);
  expect(tokenKinds('moonbit', 'pub(readonly) priv pub fn')).toEqual([
    ['pub', 'keyword'],
    ['(', 'punctuation.bracket'],
    ['readonly', 'keyword'],
    [')', 'punctuation.bracket'],
    ['priv pub', 'keyword'],
    ['fn', 'keyword.declaration'],
  ]);
  // members are never keywords
  expect(tokenKinds('moonbit', 'x.type MAX_SIZE')).toEqual([
    ['x', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['type', 'property'],
    ['MAX_SIZE', 'constant'],
  ]);
});

test('moonbit: the sample and line-crossing context resume line-fed', () => {
  for (const code of [
    samples.moonbit.code,
    'fn\n  name(x : Int) {}\n',
    'fn[T]\nname(x : T) {}\n',
    'obj.\n  field\n',
    'let s = "\\{x\n}"\n',
    'let s = $|a \\{\n  b}\n',
  ]) {
    assertLineFedParity('moonbit', code);
  }
  for (const code of [
    'let s = "a\\{x}b"\r\nlet t = #|raw\r\n',
    '$|\\{a}\r\n',
  ]) {
    assertLineFedParity('moonbit', code);
  }
});

test('moonbit: malformed and random input remains total, balanced and lossless', () => {
  const lexer = loadLang('moonbit', '$hlMoonbit');
  const rand = makeRand(0x3b17);
  const alphabet = Array.from(
    'abfnFTxu019_~!? /\\"\'`\n\r\t{}[]().,:;+-*=<>&|#$@λ😀'
  );
  for (const code of [
    '',
    '"',
    '"\\',
    '"\\{',
    '"\\u{',
    "'",
    "b'",
    'b"',
    '#',
    '#|',
    '$',
    '$|\\{',
    '@',
    '@a/',
    'pub(',
    'fn[',
    '..',
  ]) {
    checkInvariants(lexer.hl, code);
  }
  for (let n = 0; n < 160; n++) {
    const code = Array.from(
      { length: rand() & 63 },
      () => alphabet[rand() % alphabet.length]
    ).join('');
    checkInvariants(lexer.hl, code);
  }
});

test('mbt alias highlights the same code as moonbit', () => {
  initFullModule();
  expect(
    codeToTokens(samples.moonbit.code, { lang: 'mbt', theme: distinctTheme })
  ).toEqual(
    codeToTokens(samples.moonbit.code, {
      lang: 'moonbit',
      theme: distinctTheme,
    })
  );
});
